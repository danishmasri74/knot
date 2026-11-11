import { createNotebook } from "./create-notebook.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("test-results/ai-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9287",
      KNOT_TEST_SHELL_ARGS: "--remote-debugging-port=9287",
    },
  });
  for (let i = 0; i < 100; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9287");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  assert.ok(browser);
  page = browser.contexts()[0].pages()[0];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForSelector("affine-editor-container", { timeout: 60000 });
  await page.waitForFunction(
    () => !document.querySelector(".primary").disabled,
  );
  await page.evaluate(() => {
    const original = window.fetch;
    window.aiRequests = [];
    window.aiCalls = [];
    window.aiOutcomes = [];
    window.aiMock = "normal";
    const mockInvoke = async (command, args) => {
      if (command.startsWith("ai_")) window.aiCalls.push(command);
      if (command === "ai_diagnostics_outcome") {
        window.aiOutcomes.push(args);
        return;
      }
      if (command === "ai_connected") return true;
      if (command === "ai_models") return ["gpt-5.4-mini", "gpt-5.4"];
      if (command === "ai_cancel") {
        window.aiCancelled = true;
        return;
      }
      if (command === "ai_respond") {
        window.aiRequests.push(args);
        const context = JSON.parse(args.context);
        if (window.aiMock === "failure") throw "Simulated network failure";
        if (window.aiMock === "slow")
          await new Promise((r) => setTimeout(r, 1500));
        const output =
          args.mode === "ask"
            ? "A streamed answer about your note.\n\n### Key ideas\n\n- **Keep it clear.** Start with the main point.\n- Turn the next step into a checklist."
            : JSON.stringify(
                args.mode === "rewrite"
                  ? {
                      replacements: context.runs.map((r) =>
                        r.protected
                          ? r.text
                          : r.text.replace("Hello", "Welcome"),
                      ),
                      blocks: [],
                    }
                  : {
                      replacements: [],
                      blocks: [
                        { type: "h2", text: "Next steps" },
                        { type: "paragraph", text: "A useful paragraph." },
                        { type: "bulleted", text: "First idea" },
                        { type: "numbered", text: "First step" },
                        { type: "todo", text: "Review the draft" },
                      ],
                    },
              );
        const channel = Number(args.onEvent.split(":")[1]);
        let index = 0;
        for (let i = 0; i < output.length; i += 12) {
          window.__TAURI_INTERNALS__.runCallback(channel, {
            index: index++,
            message: { delta: output.slice(i, i + 12) },
          });
          await new Promise((r) => setTimeout(r, 8));
        }
        window.__TAURI_INTERNALS__.runCallback(channel, { index, end: true });
        return null;
      }
      throw Error("Unexpected AI command " + command);
    };
    window.fetch = async (url, options) => {
      const command = String(url).split("/").at(-1);
      if (!command.startsWith("ai_")) return original(url, options);
      try {
        const result = await mockInvoke(command, JSON.parse(options.body));
        return new Response(JSON.stringify(result ?? null), {
          headers: {
            "Content-Type": "application/json",
            "Tauri-Response": "ok",
          },
        });
      } catch (e) {
        return new Response(JSON.stringify(String(e)), {
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
  if (child?.pid && child.exitCode === null) {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$p=Get-Process -Id ${child.pid}; if(-not $p.CloseMainWindow()){throw 'Close failed'}; if(-not $p.WaitForExit(30000)){throw 'Save/close did not finish'}`,
      ],
      { windowsHide: true },
    );
  }
  await browser?.close();
  browser = null;
  child = null;
}
async function save() {
  await page
    .getByRole("button", { name: "Save now / retry", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector(".save-status")?.textContent.includes("Saved"),
  );
}
async function selectText() {
  await page.evaluate(() => {
    const e = document.querySelector("affine-editor-container");
    const m = e.doc.getBlocksByFlavour("affine:paragraph")[0].model;
    e.std.selection.setGroup("note", [
      e.std.selection.create("text", {
        from: { blockId: m.id, index: 0, length: m.text.length },
        to: null,
      }),
    ]);
  });
}
async function text() {
  return page.evaluate(() =>
    document
      .querySelector("affine-editor-container")
      .doc.getBlocksByFlavour("affine:paragraph")[0]
      .model.text.toString(),
  );
}
async function send(prompt) {
  await page.getByLabel("Ask Knot message").fill(prompt);
  await page.getByRole("button", { name: "Send to Knot", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "detached" });
}
try {
  await launch();
  await createNotebook(page);
  await page.waitForFunction(
    () => !document.querySelector(".primary").disabled,
  );
  await page
    .getByLabel("Document title", { exact: true })
    .fill("Ask Knot acceptance");
  await page.getByLabel("Document title", { exact: true }).press("Enter");
  const editable = page
    .locator("affine-paragraph [contenteditable=true]")
    .first();
  await editable.click();
  await page.keyboard.type("Hello world");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+b");
  await selectText();
  await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
  assert.equal(
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Ask Knot", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page
      .locator(".document-quick-actions")
      .getByRole("button", { name: "Ask Knot", exact: true })
      .count(),
    0,
  );
  assert.equal(await page.locator(".ask-knot h2").count(), 1);
  await page.screenshot({ path: path.join(root, "ask-empty.png") });
  await page.getByLabel("Writing actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Rewrite selection", exact: true })
    .click();
  await send("Make this more welcoming");
  assert.equal(await text(), "Hello world");
  assert.match(await page.locator(".ask-context").textContent(), /Selection/);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  assert.equal(await text(), "Welcome world");
  assert.ok(
    await page.evaluate(() =>
      document
        .querySelector("affine-editor-container")
        .doc.getBlocksByFlavour("affine:paragraph")[0]
        .model.text.toDelta()
        .every((d) => d.attributes?.bold),
    ),
  );
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  assert.equal(await text(), "Hello world");
  await save();
  await page.screenshot({ path: path.join(root, "ask-preview.png") });
  console.log("PASS native selection, preview, apply, formatting, undo, save");
  await page
    .getByRole("button", { name: "Close Ask Knot tab", exact: true })
    .click();
  await selectText();
  await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
  await page.getByLabel("Writing actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Rewrite selection", exact: true })
    .click();
  await send("Rewrite again");
  await page.evaluate(() =>
    document
      .querySelector("affine-editor-container")
      .doc.getBlocksByFlavour("affine:paragraph")[0]
      .model.text.delete(0, 1),
  );
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  assert.match(await page.locator(".ask-error").textContent(), /stale/);
  assert.equal(await text(), "ello world");
  await page
    .getByRole("button", { name: "Dismiss", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Close Ask Knot tab", exact: true })
    .click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await save();
  await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
  await page.getByLabel("Writing actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Insert content", exact: true })
    .click();
  await send(
    "Insert a heading, paragraph, bullet, numbered item and checklist",
  );
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  assert.ok(
    await page.evaluate(() =>
      document
        .querySelector("affine-editor-container")
        .doc.getBlocksByFlavour("affine:list")
        .some((b) => b.model.type === "todo"),
    ),
  );
  await save();
  await page.getByLabel("Writing actions", { exact: true }).click();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await send("Summarize this");
  assert.match(
    await page.locator(".ask-messages").textContent(),
    /A streamed answer/,
  );
  assert.equal(
    await page.locator(".ask-prose h4").last().textContent(),
    "Key ideas",
  );
  assert.equal(
    await page.locator(".ask-prose strong").last().textContent(),
    "Keep it clear.",
  );
  await page.screenshot({ path: path.join(root, "ask-answer.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  const resize = page.getByRole("separator", {
    name: "Resize supporting pane",
  });
  await resize.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  assert.ok(
    await page
      .locator(".ask-composer-box")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  );
  await page.screenshot({ path: path.join(root, "ask-dark-narrow.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await resize.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
  await page.evaluate(() => (window.aiMock = "failure"));
  await send("Explain this");
  assert.match(
    await page.locator(".ask-error").textContent(),
    /network failure/,
  );
  await page.evaluate(() => (window.aiMock = "slow"));
  await page.getByLabel("Ask Knot message").fill("Slow request");
  await page.getByRole("button", { name: "Send to Knot", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForTimeout(1800);
  assert.ok(await page.evaluate(() => window.aiCancelled));
  assert.ok(
    await page.evaluate(() =>
      ["proposal_valid", "apply", "undo", "answer_displayed"].every((kind) =>
        window.aiOutcomes.some((o) => o.outcome === kind),
      ),
    ),
  );
  console.log(
    "PASS stale deletion rejection, native block insertions, streaming, network failure, cancellation",
  );
  await page.screenshot({ path: path.join(root, "ask-chat.png") });
  await page.evaluate(() => (window.aiMock = "normal"));
  await page
    .getByRole("button", { name: "Add attachment", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Add attachment", exact: true })
    .getByRole("button", { name: "Welcome to Knot", exact: true })
    .click();
  await send("Use this additional context");
  assert.ok(
    await page.evaluate(() => {
      // The added note's blocks live once, in the frozen citation table.
      const context = JSON.parse(window.aiRequests.at(-1).context);
      const added = context.addedNotes[0];
      return (
        added.structure === undefined &&
        context.citationSources.some(
          (block) => block.document === added.document && block.text.length > 0,
        )
      );
    }),
  );
  const originalId = await page.evaluate(
    () => document.querySelector("affine-editor-container").doc.id,
  );
  const count = await page.locator(".ask-turn").count();
  await createNotebook(page);
  await page.waitForFunction(
    () => !document.querySelector(".primary").disabled,
  );
  await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
  assert.equal(await page.locator(".ask-turn").count(), 0);
  await page
    .getByRole("button", { name: "Ask Knot acceptance", exact: true })
    .click();
  await page.waitForFunction(
    (id) => document.querySelector("affine-editor-container").doc.id === id,
    originalId,
  );
  await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
  assert.equal(await page.locator(".ask-turn").count(), count);
  console.log(
    "PASS explicit note context and per-document session conversations",
  );
  await stop();
  await launch();
  await page
    .getByRole("button", { name: "Ask Knot acceptance", exact: true })
    .click();
  await page.waitForFunction(
    (id) => document.querySelector("affine-editor-container").doc.id === id,
    originalId,
  );
  assert.equal(await text(), "Hello world");
  assert.ok(
    await page.evaluate(() =>
      document
        .querySelector("affine-editor-container")
        .doc.getBlocksByFlavour("affine:list")
        .some((b) => b.model.type === "todo"),
    ),
  );
  await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
  assert.equal(await page.locator(".ask-turn").count(), count);
  await page
    .getByRole("button", { name: "Copy message", exact: true })
    .last()
    .click();
  await page
    .locator(".ask-message-actions")
    .last()
    .getByText("Copied", { exact: true })
    .waitFor();
  const oldRequest = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("knot.ai.chats.v1:"),
    );
    return JSON.parse(localStorage.getItem(key)).turns.at(-1).request;
  });
  await page
    .getByRole("button", { name: "Regenerate response", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => window.aiRequests.at(-1).context),
    oldRequest.context,
  );
  await page.getByRole("button", { name: "Chat history", exact: true }).click();
  assert.equal(await page.locator(".ask-history-item").count(), 2);
  assert.equal(await page.locator(".ask-messages, .ask-compose").count(), 0);
  await page.screenshot({ path: path.join(root, "saved-history.png") });
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  assert.equal(await page.locator(".ask-turn").count(), 0);
  await page.getByRole("button", { name: "Chat history", exact: true }).click();
  await page.locator(".ask-history-item").last().click();
  assert.equal(await page.locator(".ask-turn").count(), count);
  await page.getByRole("button", { name: "Chat history", exact: true }).click();
  await page
    .getByRole("button", { name: /^Delete chat:/ })
    .last()
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.locator(".ask-history-item").count(), 2);
  assert.equal(await page.locator(".ask-messages, .ask-compose").count(), 0);
  await page
    .getByRole("button", { name: /^Delete chat:/ })
    .last()
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await stop();
  await launch();
  await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
  await page.getByRole("button", { name: "Chat history", exact: true }).click();
  assert.equal(await page.locator(".ask-history-item").count(), 1);
  await page.locator(".ask-history-item").click();
  const beforeEdit = await page.locator(".ask-turn").count();
  await page
    .getByRole("button", { name: "Edit message", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Edit message", exact: true })
    .fill("Changed prompt");
  await page.getByRole("button", { name: "Cancel edit", exact: true }).click();
  assert.equal(await page.locator(".ask-turn").count(), beforeEdit);
  await page
    .getByRole("button", { name: "Edit message", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Edit message", exact: true })
    .fill("Edited first prompt");
  await page.getByRole("button", { name: "Save & send", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(await page.locator(".ask-turn").count(), 2);
  assert.equal(
    await page.locator(".ask-user .ask-message-text").textContent(),
    "Edited first prompt",
  );
  assert.deepEqual(
    await page.evaluate(() => window.aiRequests.at(-1).messages),
    [{ role: "user", content: "Edited first prompt" }],
  );
  await page.screenshot({ path: path.join(root, "edited-message.png") });
  await page.getByRole("button", { name: "Chat history", exact: true }).click();
  assert.equal(await page.locator(".ask-history-item").count(), 1);
  await page.screenshot({ path: path.join(root, "full-history.png") });
  await page.getByRole("button", { name: "Back to chat", exact: true }).click();
  assert.equal(await page.locator(".ask-compose").count(), 1);
  await stop();
  await launch();
  await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
  await page.getByRole("button", { name: "Chat history", exact: true }).click();
  await page.locator(".ask-history-item").click();
  assert.equal(await page.locator(".ask-turn").count(), 2);
  assert.equal(
    await page.locator(".ask-user .ask-message-text").textContent(),
    "Edited first prompt",
  );
  console.log(
    "PASS exclusive history view, back navigation, cancel edit, edit truncation and persistence without a new branch",
  );
  console.log(
    "PASS saved chats survive restart, copy, regeneration with original context, new chat, reopen, confirmed deletion survives restart",
  );
  console.log("Artifacts: " + root);
} finally {
  await stop();
}
