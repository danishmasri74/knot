import { createNotebook } from "./create-notebook.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("test-results/ai-settings-" + Date.now());
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
    window.aiMock = "normal";
    const mockInvoke = async (command, args) => {
      if (command.startsWith("ai_")) window.aiCalls.push(command);
      if (command === "ai_connected") return true;
      if (command === "ai_open_api_keys" || command === "ai_disconnect")
        return null;
      if (command === "ai_connect") {
        if (args.apiKey === "invalid-test-key")
          throw "The API key was rejected.";
        return [
          "gpt-6-luna",
          "gpt-6.1-terra",
          "gpt-6.1-sol",
          "gpt-6-astra",
          "gpt-5.4-mini",
          "gpt-5.4",
        ];
      }
      if (command === "ai_models") {
        if (window.holdAiModels)
          await new Promise((resolve) => {
            window.releaseAiModels = resolve;
          });
        if (window.failAiModels) throw "Model lookup failed";
        if (window.emptyAiModels) return [];
        return [
          "gpt-6-luna",
          "gpt-6.1-terra",
          "gpt-6.1-sol",
          "gpt-6-astra",
          "gpt-5.4-mini",
          "gpt-5.4",
        ];
      }
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
async function text() {
  return page.evaluate(() =>
    document
      .querySelector("affine-editor-container")
      .doc.getBlocksByFlavour("affine:paragraph")[0]
      .model.text.toString(),
  );
}
try {
  await launch();
  await createNotebook(page);
  await page.waitForFunction(
    () => !document.querySelector(".primary").disabled,
  );
  await page
    .getByLabel("Document title", { exact: true })
    .fill("AI toggle verification");
  await page.getByLabel("Document title", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  for (const name of [
    "GPT-6 Luna Fast",
    "GPT-6.1 Terra Writing",
    "GPT-6.1 Sol Reasoning",
    "GPT-6 Astra Premium",
  ]) {
    const modelToggle = page.getByRole("switch", { name, exact: true });
    assert.equal(await modelToggle.getAttribute("aria-checked"), "true");
    await modelToggle.click();
  }
  const mini = page.getByRole("switch", {
    name: "GPT-5.4 mini Everyday",
    exact: true,
  });
  const advanced = page.getByRole("switch", {
    name: "GPT-5.4 Advanced",
    exact: true,
  });
  await mini.click();
  assert.equal(await mini.getAttribute("aria-checked"), "false");
  assert.equal(await advanced.isDisabled(), true);
  await page.getByRole("button", { name: "General", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  assert.equal(await mini.getAttribute("aria-checked"), "false");
  await page.screenshot({ path: path.join(root, "ai-models.png") });
  await page
    .getByRole("button", { name: "Close AI panel", exact: true })
    .click();
  await page.evaluate(() => {
    window.holdAiModels = true;
  });
  await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
  await page.waitForFunction(() => !!window.releaseAiModels);
  assert.equal(
    await page.getByLabel("AI model", { exact: true }).textContent(),
    "Loading models…",
  );
  assert.equal(await page.locator(".ask-model-notice").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Send to Knot", exact: true })
      .isDisabled(),
    true,
  );
  await page.screenshot({ path: path.join(root, "models-loading.png") });
  await page.evaluate(() => {
    window.holdAiModels = false;
    window.releaseAiModels();
  });

  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="AI model"]')?.value === "gpt-5.4",
  );
  assert.deepEqual(
    await page
      .getByLabel("AI model", { exact: true })
      .locator("option")
      .evaluateAll((options) => options.map((option) => option.value)),
    ["auto", "gpt-5.4"],
  );
  for (const state of ["empty", "failure", "normal"]) {
    await page
      .getByRole("button", { name: "Close Ask Knot tab", exact: true })
      .click();
    await page.evaluate((state) => {
      window.emptyAiModels = state === "empty";
      window.failAiModels = state === "failure";
    }, state);
    await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
    if (state === "empty") {
      await page.locator(".ask-model-notice").waitFor();
      assert.equal(
        await page.locator(".ask-compose-actions .ask-model-notice").count(),
        0,
      );
    } else if (state === "failure") {
      await page
        .getByRole("alert")
        .filter({ hasText: "Model lookup failed" })
        .waitFor();
      assert.equal(await page.locator(".ask-model-notice").count(), 0);
    } else {
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="AI model"]')?.value ===
          "gpt-5.4",
      );
      assert.equal(await page.locator(".ask-model-notice").count(), 0);
    }
  }
  assert.equal(
    await page
      .getByText("Chats are saved on this device", { exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Connection", exact: true }).click();
  const connection = page.getByRole("region", { name: "OpenAI connection" });
  assert.equal(
    await connection.getByText("Connected", { exact: true }).count(),
    1,
  );
  assert.equal(await connection.getByLabel("OpenAI API key").count(), 0);
  const keyLink = connection.getByRole("link", { name: "Get an API key" });
  assert.equal(
    await keyLink.getAttribute("href"),
    "https://platform.openai.com/api-keys",
  );
  await keyLink.click();
  assert.ok(
    await page.evaluate(() => window.aiCalls.includes("ai_open_api_keys")),
  );
  await page.screenshot({ path: path.join(root, "connection-connected.png") });
  await connection
    .getByRole("button", { name: "Change key", exact: true })
    .click();
  await connection.getByLabel("OpenAI API key").fill("temporary-test-key");
  await connection.getByRole("button", { name: "Cancel", exact: true }).click();
  await connection
    .getByRole("button", { name: "Change key", exact: true })
    .click();
  assert.equal(await connection.getByLabel("OpenAI API key").inputValue(), "");
  await connection.getByRole("button", { name: "Cancel", exact: true }).click();
  await connection
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await connection.getByText("Not connected", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(root, "connection-disconnected.png"),
  });
  await connection.getByLabel("OpenAI API key").fill("invalid-test-key");
  await connection.getByLabel("OpenAI API key").press("Enter");
  await page
    .getByRole("alert")
    .filter({ hasText: "The API key was rejected." })
    .waitFor();
  await connection.getByLabel("OpenAI API key").fill("valid-test-key");
  await connection.getByLabel("OpenAI API key").press("Enter");
  await connection.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await mini.click();
  await page
    .getByRole("switch", { name: "GPT-6.1 Terra Writing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close AI panel", exact: true })
    .click();
  await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="AI model"]')?.value ===
      "gpt-6.1-terra",
  );
  assert.equal(
    await page
      .getByLabel("AI model", { exact: true })
      .locator("option:checked")
      .textContent(),
    "GPT-6.1 Terra",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.screenshot({ path: path.join(root, "openai-models.png") });
  const toggle = page.getByRole("switch", { name: "AI features", exact: true });
  assert.equal(await toggle.getAttribute("aria-checked"), "true");
  await toggle.click();
  await page
    .getByRole("dialog", { name: "Disable AI features?", exact: true })
    .waitFor();
  await page.screenshot({ path: path.join(root, "ai-confirmation.png") });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await toggle.getAttribute("aria-checked"), "true");
  await toggle.click();
  await page.keyboard.press("Escape");
  assert.equal(await toggle.getAttribute("aria-checked"), "true");
  await page.evaluate(() => {
    const e = document.querySelector("affine-editor-container");
    const text = e.doc.getBlocksByFlavour("affine:paragraph")[0].model.text;
    text.insert(" Saved before AI reload", text.length);
    localStorage.setItem(
      "knot.ai.chats.v1:preserved:test",
      JSON.stringify({ title: "Keep me" }),
    );
  });
  await toggle.click();
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    page.getByRole("button", { name: "Apply & reload", exact: true }).click(),
  ]);
  await page.waitForSelector("affine-paragraph");
  await page.waitForFunction(
    () => !document.querySelector(".primary").disabled,
  );
  assert.equal(
    await page.getByRole("button", { name: "Ask Knot", exact: true }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "AI toggle verification", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector(".primary").disabled,
  );
  assert.ok((await text()).includes("Saved before AI reload"));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  assert.equal(await toggle.getAttribute("aria-checked"), "false");
  await page.screenshot({ path: path.join(root, "ai-disabled.png") });
  await toggle.click();
  await page
    .getByRole("dialog", { name: "Enable AI features?", exact: true })
    .waitFor();
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    page.getByRole("button", { name: "Apply & reload", exact: true }).click(),
  ]);
  await page.waitForSelector("affine-paragraph");
  await page.getByRole("button", { name: "Ask Knot", exact: true }).waitFor();
  assert.ok(
    await page.evaluate(() =>
      localStorage.getItem("knot.ai.chats.v1:preserved:test"),
    ),
  );
  console.log(
    "PASS AI toggle cancel/Escape, disable/reload, saved edits and chats retained, enable/reload",
  );
  console.log("Artifacts: " + root);
} finally {
  await stop();
}
