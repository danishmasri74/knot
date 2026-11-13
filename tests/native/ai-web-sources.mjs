import { createNotebook } from "./create-notebook.mjs";
import { clickShellButton } from "./shell-navigation.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("test-results/ai-web-sources-" + Date.now());
await mkdir(root, { recursive: true });
let child, browser, page;
let checkedNativeBoundary = false;
async function launch() {
  child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      KNOT_TEST_DATA_DIR: root,
      KNOT_TEST_SHELL_ARGS: "--remote-debugging-port=9297",
    },
  });
  for (let i = 0; i < 150; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9297");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  assert.ok(browser, "Native app did not start");
  page = browser.contexts()[0].pages()[0];
  page.on("dialog", (dialog) => dialog.accept());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForSelector("affine-editor-container", { timeout: 90000 });
  await page.waitForFunction(
    () => !document.querySelector(".primary").disabled,
  );
  if (!checkedNativeBoundary) {
    const states = await page.evaluate(async () => {
      const { WebSourceCoordinator } =
        await import("/src/services/web-sources.ts");
      const coordinator = new WebSourceCoordinator();
      const updates = [];
      await coordinator.capture(
        "native-boundary-test",
        [{ id: "private", url: "http://127.0.0.1/", state: "queued" }],
        (attempt) => updates.push(attempt),
      );
      return updates.map(({ state }) => state);
    });
    assert.deepEqual(states, ["queued", "fetching", "failed"]);
    checkedNativeBoundary = true;
    console.log(
      "PASS actual native IPC rejects loopback and completes the ordered batch",
    );
  }
  await page.evaluate(() => {
    const original = window.fetch;
    window.webCalls = [];
    window.aiRequests = [];
    window.recoverWeb = false;
    window.slowWeb = false;
    window.invalidRef = false;
    const channel = (args, messages) => {
      const id = Number(args.onEvent.split(":")[1]);
      messages.forEach((message, index) =>
        window.__TAURI_INTERNALS__.runCallback(id, { index, message }),
      );
      window.__TAURI_INTERNALS__.runCallback(id, {
        index: messages.length,
        end: true,
      });
    };
    const mocked = async (command, args) => {
      if (command === "ai_connected") return true;
      if (command === "ai_models") return ["gpt-5.4-mini"];
      if (
        command === "ai_cancel" ||
        command === "web_sources_cancel" ||
        command === "ai_diagnostics_outcome"
      )
        return;
      if (command === "web_sources_fetch") {
        window.webCalls.push(args.urls);
        const events = [];
        for (const url of args.urls) {
          events.push({ url, status: "fetching" });
          const fail = url.includes("missing") && !window.recoverWeb;
          events.push({
            url,
            status: "finished",
            result: fail
              ? {
                  url,
                  code: "http",
                  message:
                    "The website returned HTTP 403. Retry or open it externally.",
                }
              : {
                  url,
                  finalUrl: url,
                  fetchedAt: String(Date.now()),
                  contentType: "text/html",
                  body: `<html><head><title>Captured guide</title></head><body><main><h1>Learning guide</h1><p>Spaced retrieval improves long-term retention.</p><pre>review(day + 1)</pre><table><tr><th>Method</th><th>Interval</th></tr><tr><td>Review</td><td>1 day</td></tr></table></main></body></html>`,
                },
          });
        }
        if (window.slowWeb)
          await new Promise((resolve) => setTimeout(resolve, 1800));
        channel(args, [...events, { url: "", status: "complete" }]);
        return;
      }
      if (command === "ai_respond") {
        window.aiRequests.push(args);
        const context = JSON.parse(args.context),
          web = context.citationSources.filter((s) => s.kind === "web");
        const refs = web.length
          ? [window.invalidRef ? "invented/ref" : web[0].ref]
          : [];
        const output =
          args.mode === "ask"
            ? `From captured evidence, spaced retrieval helps retention ${web[0]?.citation ?? ""}.`
            : JSON.stringify({
                replacements: [],
                blocks: [
                  {
                    type: "paragraph",
                    text: "Spaced retrieval helps retention",
                    sourceRefs: refs,
                  },
                  ...(args.mode === "canvas"
                    ? [
                        {
                          type: "paragraph",
                          text: "Schedule another review",
                          sourceRefs: refs,
                        },
                      ]
                    : []),
                ],
                ...(args.mode === "canvas"
                  ? {
                      connections: [
                        { from: 0, to: 1, label: "supports", sourceRefs: refs },
                      ],
                      mindmap: [],
                    }
                  : {}),
              });
        channel(args, [{ delta: output }]);
        return;
      }
      throw Error("Unexpected mock: " + command);
    };
    window.fetch = async (url, options) => {
      const command = String(url).split("/").at(-1);
      if (!command.startsWith("ai_") && !command.startsWith("web_sources_"))
        return original(url, options);
      try {
        const result = await mocked(command, JSON.parse(options.body));
        return new Response(JSON.stringify(result ?? null), {
          headers: {
            "Content-Type": "application/json",
            "Tauri-Response": "ok",
          },
        });
      } catch (error) {
        return new Response(JSON.stringify(String(error)), {
          headers: {
            "Content-Type": "application/json",
            "Tauri-Response": "error",
          },
        });
      }
    };
  });
}
async function stop() {
  if (child?.pid && child.exitCode === null)
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$p=Get-Process -Id ${child.pid}; if(-not $p.CloseMainWindow()){throw 'Close failed'}; if(-not $p.WaitForExit(30000)){throw 'Normal save/close did not finish'}`,
      ],
      { windowsHide: true },
    );
  await browser?.close();
  browser = null;
  child = null;
}
async function send(text) {
  await page.getByLabel("Ask Knot message").fill(text);
  await page.getByRole("button", { name: "Send to Knot", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "detached", timeout: 20000 });
}
async function newChat() {
  await page.getByRole("button", { name: "New chat", exact: true }).click();
}
async function sourceCount() {
  return page.evaluate(
    () =>
      document
        .querySelector("affine-editor-container")
        .doc.getBlocksByFlavour("knot:web-source").length,
  );
}
try {
  await launch();
  await createNotebook(page);
  await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
  const exclude = page.getByRole("button", {
    name: "Exclude note context",
    exact: true,
  });
  if (await exclude.count()) await exclude.click();
  await send(
    "Summarize [guide](https://example.com/guide) and https://example.com/missing.",
  );
  assert.equal(await page.locator(".web-source-item").count(), 2);
  assert.match(
    await page.locator(".web-coverage").last().textContent(),
    /1 of 2.*Excluded/s,
  );
  const frozen = await page.evaluate(() => window.aiRequests.at(-1).context);
  assert.equal((JSON.parse(frozen).structure ?? []).length, 0);
  assert.ok(JSON.parse(frozen).citationSources.some((s) => s.kind === "web"));
  await page.evaluate(() => (window.recoverWeb = true));
  const failed = page
    .locator(".web-source-item")
    .filter({ hasText: "example.com/missing" });
  await failed.getByRole("button", { name: /Website details:/ }).click();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".web-source-item").length === 2 &&
      !document
        .querySelector(".web-source-item summary")
        ?.textContent.includes("fetching") &&
      !document.querySelector(".ask-compose")?.textContent.includes("Stop"),
  );
  assert.deepEqual(await page.evaluate(() => window.webCalls.at(-1)), [
    "https://example.com/missing",
  ]);
  assert.equal(await page.evaluate(() => window.aiRequests[0].context), frozen);
  console.log(
    "PASS multiple/Markdown URLs, No notes + web, mixed failures, failed-only retry, frozen evidence",
  );

  await page.getByLabel("Writing actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Insert content", exact: true })
    .click();
  await send("Turn these captured websites into study notes");
  const firstProposalContext = await page.evaluate(
    () => window.aiRequests.at(-1).context,
  );
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  assert.ok(await sourceCount());
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  assert.equal(await sourceCount(), 0);
  await send("Write the study note again");
  const readySource = page.locator(".web-source-item").first();
  await readySource.getByRole("button", { name: /Website details:/ }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(
    await page.getByRole("button", { name: "Apply", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.evaluate(() => window.aiRequests[1].context),
    firstProposalContext,
  );
  await send("Write with the refreshed evidence");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  assert.ok(await sourceCount());
  await page
    .getByRole("button", { name: "Save now / retry", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent.includes("Saved"),
  );
  const durable = await page.evaluate(() =>
    document
      .querySelector("affine-editor-container")
      .doc.getBlocksByFlavour("knot:web-source")
      .map(({ model }) => model.evidence),
  );
  await page.screenshot({ path: path.join(root, "web-applied-light.png") });
  console.log(
    "PASS insert preview/Apply, one Undo, refresh invalidates proposal, durable source serialization and save",
  );

  await newChat();
  await page
    .getByRole("button", { name: "Add attachment", exact: true })
    .click();
  await page
    .getByLabel("Search attachments or paste a website URL", { exact: true })
    .fill("example.com/guide example.com/missing");
  await page
    .getByRole("button", { name: "Attach 2 websites", exact: true })
    .click();
  await page
    .getByLabel("Ask Knot message")
    .fill("Read https://example.com/guide and https://example.com/missing");
  await page
    .locator(".web-source-item")
    .last()
    .getByRole("button", { name: /^Remove website:/ })
    .click();
  await send("Read https://example.com/guide and https://example.com/missing");
  assert.equal(
    JSON.parse(await page.evaluate(() => window.aiRequests.at(-1).context))
      .webOutcomes.length,
    1,
  );
  console.log(
    "PASS + Context bare addresses and removed detected URL stays excluded from submission",
  );

  await newChat();
  await page.evaluate(() => (window.recoverWeb = false));
  const calls = await page.evaluate(() => window.aiRequests.length);
  await send("Read https://example.com/missing");
  assert.equal(await page.evaluate(() => window.aiRequests.length), calls);
  assert.match(
    await page.locator(".ask-knot").textContent(),
    /None of the websites could be read/,
  );
  await newChat();
  await page.evaluate(() => (window.slowWeb = true));
  await page
    .getByLabel("Ask Knot message")
    .fill("Read https://example.com/slow");
  await page.getByRole("button", { name: "Send to Knot", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForTimeout(2100);
  assert.equal(await page.evaluate(() => window.aiRequests.length), calls);
  assert.match(
    await page.locator(".web-source-item").textContent(),
    /cancelled/,
  );
  console.log(
    "PASS all-failed generation skipped, Stop and late callback isolation",
  );

  await stop();
  await launch();
  const reopened = await page.evaluate(() =>
    document
      .querySelector("affine-editor-container")
      .doc.getBlocksByFlavour("knot:web-source")
      .map(({ model }) => model.evidence),
  );
  assert.deepEqual(reopened, durable);
  // Native backup/restore uses real storage, with normal close/reopen around changes.
  const backup = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("create_backup"),
  );
  assert.ok(backup);
  await page.evaluate(async () => {
    const doc = document.querySelector("affine-editor-container").doc;
    doc
      .getBlocksByFlavour("knot:web-source")
      .forEach(({ model }) => doc.deleteBlock(model));
    // Chats are workspace data now; delete them so evidence is proven
    // independent of chats (the backup still holds its own copy).
    const tauri = window.__TAURI_INTERNALS__;
    const { active } = await tauri.invoke("workspace_catalog");
    for (const data of await tauri.invoke("ai_chats_list", { workspace: active }))
      await tauri.invoke("ai_chat_delete", {
        workspace: active,
        id: JSON.parse(data).id,
      });
  });
  await stop();
  await launch();
  assert.equal(await sourceCount(), 0);
  await clickShellButton(page, "Manage backups");
  await page
    .locator(".backup-row")
    .filter({ hasText: backup })
    .getByRole("button", { name: "Restore archive", exact: true })
    .click();
  await page.waitForSelector("affine-editor-container");
  await page.waitForFunction(
    () =>
      document
        .querySelector("affine-editor-container")
        ?.doc.getBlocksByFlavour("knot:web-source").length > 0,
  );
  assert.deepEqual(
    await page.evaluate(() =>
      document
        .querySelector("affine-editor-container")
        .doc.getBlocksByFlavour("knot:web-source")
        .map(({ model }) => model.evidence),
    ),
    durable,
  );
  console.log(
    "PASS native restart and backup/restore retain evidence independently of chats",
    root,
  );
  await stop();
  await launch();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  if (!(await page.locator(".ask-knot").count()))
    await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
  await newChat();
  await page.getByLabel("Writing actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Create on canvas", exact: true })
    .click();
  await send(
    "Connect study ideas from https://example.com/guide and https://example.com/other",
  );
  const beforeCanvas = await sourceCount();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  assert.equal(await sourceCount(), beforeCanvas + 3);
  assert.ok(
    await page.evaluate(() =>
      document
        .querySelector("affine-editor-container")
        .doc.getBlocksByFlavour("affine:surface")[0]
        .model.elementModels.some(
          (e) => e.type === "connector" && String(e.text) === "supports",
        ),
    ),
  );
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  assert.equal(await sourceCount(), beforeCanvas);
  await page.evaluate(() => (window.invalidRef = true));
  await send("Make another sourced canvas");
  assert.match(
    await page.locator(".ask-knot").textContent(),
    /unknown web evidence/,
  );
  assert.equal(
    await page.getByRole("button", { name: "Apply", exact: true }).count(),
    0,
  );
  await page.evaluate(() => {
    window.invalidRef = false;
    // Fail chat saves at the IPC boundary to exercise Retry save.
    const tauri = window.__TAURI_INTERNALS__;
    window.originalInvoke = tauri.invoke;
    tauri.invoke = (cmd, ...rest) =>
      cmd === "ai_chat_save"
        ? Promise.reject("disk full")
        : window.originalInvoke(cmd, ...rest);
  });
  await page.getByLabel("Writing actions", { exact: true }).click();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await send("Explain the captured guide");
  assert.match(
    await page.locator(".ask-assistant .ask-message-text").last().textContent(),
    /From captured evidence/,
  );
  await page.getByRole("button", { name: "Retry save", exact: true }).waitFor();
  await page.evaluate(
    () => (window.__TAURI_INTERNALS__.invoke = window.originalInvoke),
  );
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Retry save", exact: true }).count(),
    0,
  );
  console.log(
    "PASS native sourced canvas cards/connectors, grouped Undo, invalid refs, quota failure/retry",
  );
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      async (theme) =>
        (await import("/src/services/appearance.ts")).setAppearance(theme),
      theme,
    );
    await page
      .getByRole("button", { name: "Add attachment", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page
      .getByLabel("Search attachments or paste a website URL", { exact: true })
      .waitFor();
    const menu = page.locator(".collection-popover.knot-dropdown");
    assert.equal(
      await menu.evaluate((e) => getComputedStyle(e).borderRadius),
      "6px",
    );
    const bounds = await menu.boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= 1440 &&
        bounds.y + bounds.height <= 1000,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .getByRole("button", { name: "Add attachment", exact: true })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.screenshot({ path: path.join(root, `web-${theme}.png`) });
  }
  await page.setViewportSize({ width: 760, height: 540 });
  await page
    .getByRole("button", { name: "Add attachment", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  const narrowBounds = await page
    .locator(".collection-popover.knot-dropdown")
    .boundingBox();
  assert.ok(
    narrowBounds.x >= 0 &&
      narrowBounds.y >= 0 &&
      narrowBounds.x + narrowBounds.width <= 760 &&
      narrowBounds.y + narrowBounds.height <= 540,
  );
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(root, "web-narrow.png") });
  console.log(
    "PASS light/dark shared menu tokens, keyboard/focus dismissal, viewport bounds and responsive source list",
  );
} catch (error) {
  console.log("WEB FAILURE STATE", await page.locator(".ask-knot").innerText());
  await page.screenshot({ path: path.join(root, "failure.png") });
  throw error;
} finally {
  await stop();
}
