// Prototype for the tabbed layout plan (docs/TABBED-LAYOUT-PLAN.md, step 4).
// Question: can the native browser page stay visible while a menu is open in
// another column, and hide quickly when a menu overlaps it?
// Runs the debug build against the Vite dev server with a disposable data dir.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve("test-results/prototype-menu-overlap-" + Date.now());
await mkdir(root, { recursive: true });
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(`<title>Fixture</title><h1>Fixture ${req.url}</h1>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const env = {
  ...process.env,
  KNOT_TEST_DATA_DIR: root,
  KNOT_TEST_EXTERNAL_LOG: path.join(root, "external-opens.txt"),
  KNOT_TEST_SHELL_ARGS: "--remote-debugging-port=9294",
  KNOT_TEST_REMOTE_ARGS: "--remote-debugging-port=9295",
};
delete env.WEBVIEW2_USER_DATA_FOLDER;
delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
const child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  env,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect(port) {
  for (let i = 0; i < 150; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 700 });
    } catch {
      await wait(200);
    }
  }
  throw new Error(`No CDP endpoint ${port}`);
}
let browser, remoteBrowser, shell;
const invoke = (cmd, args) =>
  shell.evaluate(({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args), { cmd, args });
const visible = async () => (await invoke("browser_test_window", { action: "inspect" })).browser?.visible;
// Time until the native page reaches the wanted state, sampled every 10 ms.
async function timeUntil(want, limit = 3000) {
  const start = Date.now();
  while (Date.now() - start < limit) {
    if ((await visible()) === want) return Date.now() - start;
    await wait(10);
  }
  return null;
}
// Confirms the state holds for a while (no flicker to the other state).
async function holds(want, ms = 800) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if ((await visible()) !== want) return false;
    await wait(25);
  }
  return true;
}
const results = {};
try {
  browser = await connect(9294);
  shell = browser.contexts()[0].pages()[0];
  // A fresh data dir may start on the Library rather than a notebook.
  await shell
    .getByRole("button", { name: "New notebook…", exact: true })
    .first()
    .waitFor({ timeout: 90000 });
  await shell.waitForFunction(
    () => document.querySelector(".app-shell")?.getAttribute("aria-busy") === "false",
  );
  await shell.getByRole("button", { name: "New notebook…", exact: true }).first().click();
  await shell.getByLabel("Notebook name", { exact: true }).fill("Prototype");
  await shell.getByLabel("Notebook name", { exact: true }).press("Enter");
  await shell.waitForSelector("affine-editor-container", { timeout: 60000 });
  await shell.getByRole("button", { name: "Page", exact: true }).click();
  await shell.waitForFunction(
    () => document.querySelector(".app-shell")?.getAttribute("aria-busy") === "false",
  );
  await shell.evaluate((url) => {
    const doc = document.querySelector("affine-editor-container").doc;
    const note = doc.getBlocksByFlavour("affine:note")[0].model;
    doc.addBlock("affine:bookmark", { url, title: "Fixture" }, note.id);
  }, origin + "/first");
  await shell.locator(".affine-bookmark-content-url").click();
  await shell.getByLabel("Mini browser", { exact: true }).waitFor();
  remoteBrowser = await connect(9295);
  results.initiallyVisible = (await timeUntil(true, 15000)) !== null;
  if (!results.initiallyVisible) {
    results.debug = {
      probe: await invoke("browser_test_window", { action: "inspect" }),
      status: await invoke("browser_status").catch((e) => String(e)),
      dom: await shell.evaluate(() => {
        const sel = 'dialog[open], select:open, .global-search, .error-banner, .notice-banner, affine-link-popup, [role="dialog"], .shell-menu[open] > :not(summary), :popover-open, [role="menu"], .knot-dropdown';
        return [...document.querySelectorAll(sel)]
          .filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden")
          .map((n) => ({ tag: n.tagName, cls: n.className, role: n.getAttribute("role"), rect: JSON.stringify(n.getBoundingClientRect()) }));
      }),
      gesture: await shell.evaluate(() => document.documentElement.hasAttribute("data-pane-gesture")),
      inertOrHidden: await shell.evaluate(() => !!document.querySelector(".browser-viewport")?.closest("[hidden], [inert]")),
    };
    console.log(JSON.stringify(results.debug, null, 2));
  }

  const page = await shell.locator(".browser-viewport").evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  results.browserRect = page;

  // A menu far from the browser (over the sidebar).
  await shell.evaluate(() => {
    const m = document.createElement("div");
    m.id = "proto-menu";
    m.className = "knot-dropdown";
    m.setAttribute("role", "menu");
    Object.assign(m.style, {
      position: "fixed", left: "8px", top: "120px", width: "180px",
      height: "200px", background: "#fff", border: "1px solid #ccc", zIndex: 9999,
    });
    document.body.append(m);
  });
  results.menuElsewhereKeepsPageVisible = await holds(true);
  results.liveCode = await shell.evaluate(async () => (await (await fetch("/src/app/BrowserPanel.tsx")).text()).includes("overlaps("));
  results.afterMenuElsewhere = {
    probe: (await invoke("browser_test_window", { action: "inspect" })).browser,
    obscuredText: await shell.evaluate(() => document.querySelector(".browser-empty")?.textContent ?? null),
    focus: await shell.evaluate(() => document.hasFocus()),
    docHidden: await shell.evaluate(() => document.hidden),
  };

  // Move the same menu over the browser.
  await shell.evaluate((p) => {
    Object.assign(document.querySelector("#proto-menu").style, {
      left: `${p.left + 40}px`, top: `${p.top + 40}px`,
    });
  }, page);
  results.msToHideWhenOverlapping = await timeUntil(false);
  results.staysHiddenWhileOverlapping = await holds(false, 500);

  await shell.evaluate(() => document.querySelector("#proto-menu").remove());
  results.msToShowAfterClose = await timeUntil(true);
  results.afterClose = {
    probe: (await invoke("browser_test_window", { action: "inspect" })).browser,
    obscuredText: await shell.evaluate(() => document.querySelector(".browser-empty")?.textContent ?? null),
    docHidden: await shell.evaluate(() => document.hidden),
  };

  // A menu that only touches the browser's edge by a few pixels.
  await shell.evaluate((p) => {
    const m = document.createElement("div");
    m.id = "proto-edge";
    m.setAttribute("role", "menu");
    Object.assign(m.style, {
      position: "fixed", left: `${p.left - 176}px`, top: `${p.top + 20}px`,
      width: "180px", height: "120px", background: "#fff", zIndex: 9999,
    });
    document.body.append(m);
  }, page);
  results.msToHideWhenOverlappingByFourPx = await timeUntil(false);
  await shell.evaluate(() => document.querySelector("#proto-edge").remove());
  await timeUntil(true);

  // A real ShellMenu: the header's Document actions menu.
  const actions = shell.locator('summary[aria-label="Document actions"]');
  if (await actions.count()) {
    await actions.first().click();
    await wait(150);
    results.realShellMenu = await shell.evaluate((p) => {
      const c = document.querySelector(".shell-menu[open] .shell-menu-content");
      if (!c) return { open: false };
      const r = c.getBoundingClientRect();
      return {
        open: true,
        overlapsBrowser:
          r.left < p.left + p.width && r.right > p.left &&
          r.top < p.top + p.height && r.bottom > p.top,
      };
    }, page);
    results.realShellMenu.pageVisible = await visible();
    await shell.keyboard.press("Escape");
    results.realShellMenu.msToShowAfterEscape = await timeUntil(true);
  }

  // A modal dialog always hides the page, wherever it sits.
  await shell.evaluate(() => {
    const d = document.createElement("dialog");
    d.id = "proto-dialog";
    d.textContent = "Modal";
    document.body.append(d);
    d.showModal();
  });
  results.msToHideForModalDialog = await timeUntil(false);
  await shell.evaluate(() => document.querySelector("#proto-dialog").remove());
  results.msToShowAfterDialog = await timeUntil(true);

  console.log(JSON.stringify(results, null, 2));
} finally {
  if (shell) await invoke("plugin:window|close").catch(() => {});
  await browser?.close().catch(() => {});
  await remoteBrowser?.close().catch(() => {});
  server.close();
  setTimeout(() => {
    if (child.exitCode === null) child.kill();
    process.exit(0);
  }, 3000);
}
