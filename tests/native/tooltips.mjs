import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(`test-results/tooltips-${Date.now()}`);
await mkdir(root, { recursive: true });
let child, browser, page;
const errors = [];
async function launch() {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: path.join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9295",
    },
  });
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9295", {
        timeout: 1000,
      });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser);
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
  await access(path.join(root, "Workspace", "knot.db"));
  await ready();
}
async function ready() {
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
      "false",
  );
}
async function click(name) {
  await page.getByRole("button", { name, exact: true }).click();
  await ready();
}
async function stop() {
  await browser?.close();
  browser = null;
  if (child && child.exitCode === null) {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$testApp = Get-Process -Id ${child.pid}; if (-not $testApp.CloseMainWindow()) { throw 'Cannot close test app' }; if (-not $testApp.WaitForExit(30000)) { throw 'Test app did not close' }`,
      ],
      { windowsHide: true },
    );
  }
  child = null;
}

try {
  await launch();
  const tip = page.locator("#knot-shell-tooltip");
  const star = page.getByRole("button", {
    name: "Add notebook to favorites",
    exact: true,
  });
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    await star.hover();
    await tip.waitFor({ state: "visible" });
    assert.equal(await tip.textContent(), "Add notebook to favorites");
    assert.equal(await star.getAttribute("title"), null);
    assert.equal(
      await star.getAttribute("aria-describedby"),
      "knot-shell-tooltip",
    );
    const colors = await tip.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        background: s.backgroundColor,
        color: s.color,
        token: s.getPropertyValue("--affine-tooltip").trim(),
      };
    });
    assert.notEqual(colors.background, "rgba(0, 0, 0, 0)");
    await page.screenshot({ path: path.join(root, `tooltip-${theme}.png`) });
    await page.keyboard.press("Escape");
    await tip.waitFor({ state: "hidden" });
    assert.equal(await star.getAttribute("aria-describedby"), null);
    await page.mouse.move(400, 300);
  }
  await star.focus();
  await tip.waitFor({ state: "visible" });
  await star.click();
  await ready();
  await tip.waitFor({ state: "hidden" });
  await page.mouse.move(400, 300);
  await page
    .getByRole("button", { name: "Remove notebook from favorites", exact: true })
    .hover();
  await tip.waitFor({ state: "visible" });
  assert.equal(await tip.textContent(), "Remove notebook from favorites");
  await click("Trash");
  const close = page.getByRole("button", {
    name: "Close Trash & recovery panel",
    exact: true,
  });
  await close.hover();
  await tip.waitFor({ state: "visible" });
  assert.equal(await tip.textContent(), "Close Trash & recovery panel");
  const bounds = await tip.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 1280);
  await close.click();
  await tip.waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS light/dark tooltips, keyboard focus, Escape, dynamic labels, modal controls and no native titles",
    root,
  );
} finally {
  await stop();
}
