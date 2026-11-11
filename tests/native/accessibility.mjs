import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("test-results/accessibility-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9273",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9273", {
        timeout: 1000,
      });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser, "Native application did not start");
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? (await context.waitForEvent("page"));
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  page.on("dialog", (d) => d.accept());
  await page.waitForSelector("affine-paragraph", { timeout: 60000 });
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
  if (child?.pid)
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  child = null;
}
async function menu(label, action) {
  await page.getByLabel(label, { exact: true }).click();
  await click(action);
}
async function geometry(label) {
  const result = await page.evaluate(() => {
    const rect = (s) =>
      document.querySelector(s).getBoundingClientRect().toJSON();
    return {
      header: rect(".topbar"),
      editor: rect(".editor-area"),
      footer: rect(".sidebar-footer"),
      overflow: document.documentElement.scrollWidth > innerWidth,
      sidebar:
        document.querySelector(".sidebar").scrollHeight >
        document.querySelector(".sidebar").clientHeight,
    };
  });
  assert.equal(result.editor.y, result.header.bottom, label);
  assert.equal(result.overflow, false);
  assert.equal(result.sidebar, false);
  assert.ok(result.footer.bottom <= page.viewportSize().height);
  await page.screenshot({ path: path.join(root, label + ".png") });
}
try {
  await launch();
  // WCAG relative luminance for the shared shell palette (normal text 4.5:1,
  // control boundaries/focus 3:1). User-authored canvas colors are not changed.
  const luminance = (hex) => {
    if (hex.length === 4)
      hex = "#" + [...hex.slice(1)].map((c) => c + c).join("");
    const c = hex
      .match(/[a-f\d]{2}/gi)
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  const palette = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      ["text", "muted", "accent", "control-border", "nav", "selected"].map(
        (key) => {
          const sample = document.createElement("span");
          sample.style.color = style.getPropertyValue("--shell-" + key).trim();
          document.body.append(sample);
          const rgb = getComputedStyle(sample)
            .color.match(/[0-9.]+/g)
            .slice(0, 3)
            .map(Number);
          sample.remove();
          return [
            key,
            "#" +
              rgb
                .map((n) => Math.round(n).toString(16).padStart(2, "0"))
                .join(""),
          ];
        },
      ),
    );
  });
  for (const fg of ["text", "muted", "accent", "control-border"]) {
    for (const bg of ["#ffffff", palette.nav, palette.selected]) {
      const ratio = (luminance(bg) + 0.05) / (luminance(palette[fg]) + 0.05);
      assert.ok(
        ratio >= (fg === "control-border" ? 3 : 4.5),
        `${fg} on ${bg}: ${ratio}`,
      );
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  const docMenu = page.locator(".document-menu summary");
  await docMenu.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page
      .getByRole("button", { name: "Backlinks", exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  await page.getByLabel("Close Links tab").waitFor();
  await ready();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "tab");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.matches(".document-menu summary"));
  assert.equal(
    await docMenu.evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".shell-menu[open]").count(), 0);
  await menu("Document actions", "Backlinks");
  await docMenu.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator('.workspace-panes[data-collapsed="false"]').count(),
    1,
    "Escape closes only menu",
  );
  await click("Close Links tab");
  for (const [width, height] of [
    [1920, 1080],
    [1280, 720],
    [850, 640],
    [760, 540],
  ]) {
    await page.setViewportSize({ width, height });
    await geometry(`page-${width}`);
    await menu("Document actions", "Backlinks");
    const bounds = await page.evaluate(() => ({
      panel: document
        .querySelector(".workspace-panes")
        .getBoundingClientRect()
        .toJSON(),
      editor: document
        .querySelector(".editor-area")
        .getBoundingClientRect()
        .toJSON(),
      hidden:
        getComputedStyle(document.querySelector(".editor-area")).visibility ===
        "hidden",
    }));
    assert.ok(
      bounds.panel.right <= width + 1 && bounds.panel.x >= 0,
      JSON.stringify({ width, bounds }),
    );
    assert.ok(
      bounds.hidden || bounds.editor.right <= bounds.panel.x + 1,
      "Tool never covers usable editor",
    );
    await page.screenshot({ path: path.join(root, `inspector-${width}.png`) });
    await click("Close Links tab");
  }
  console.log(
    "PASS keyboard disclosure, topmost Escape, narrow non-overlapping tools",
  );
  console.log("TEST WORKSPACE " + root);
} finally {
  await stop();
}
