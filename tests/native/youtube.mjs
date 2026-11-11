import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import assert from "node:assert/strict";
const root = path.resolve("test-results/youtube-" + Date.now());
await mkdir(root, { recursive: true });
let child, browser, page;
async function launch() {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9297",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9297");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser, "Native application did not start");
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  page.on("dialog", (d) => d.accept());
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  await ready();
}
async function ready() {
  await page.waitForFunction(
    () => document.querySelector(".primary")?.disabled === false,
  );
}
async function stop() {
  await browser?.close();
  browser = null;
  if (child?.pid)
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  child = null;
}

try {
  await launch();
  // Deterministic player response: verifies native CSP without depending on
  // video availability, regional restrictions or the network.
  await page.route("https://www.youtube.com/embed/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>YouTube player loaded</h1>",
    }),
  );
  await page.evaluate(() => {
    window.embedViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.embedViolations.push({
        directive: event.effectiveDirective,
        uri: event.blockedURI,
      });
    });
    const doc = document.querySelector("affine-editor-container").doc;
    const note = doc.getBlocksByFlavour("affine:note")[0].model;
    doc.addBlock(
      "affine:embed-youtube",
      {
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        videoId: "jNQXAC9IVRw",
        title: "YouTube policy check",
        style: "video",
      },
      note.id,
    );
  });
  await page
    .frameLocator('iframe[src^="https://www.youtube.com/embed/"]')
    .getByText("YouTube player loaded")
    .waitFor();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await page
    .frameLocator('iframe[src^="https://www.youtube.com/embed/"]')
    .getByText("YouTube player loaded")
    .waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.embedViolations.some(
        (v) =>
          v.directive === "frame-src" &&
          v.uri.startsWith("https://www.youtube.com/embed/"),
      ),
    ),
    false,
  );
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.src = "https://example.com/disallowed-embed";
    document.body.append(frame);
  });
  await page.waitForFunction(() =>
    window.embedViolations.some(
      (v) =>
        v.directive === "frame-src" && v.uri.startsWith("https://example.com"),
    ),
  );
  console.log(
    "PASS YouTube embeds load in Page and Canvas; unrelated external frames remain blocked",
  );
} finally {
  await stop();
}
