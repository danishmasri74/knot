// A website card selected on the canvas has no text of its own: Ask Knot must
// read its page through the website-source flow, as for a pasted URL.
// Run after `pnpm tauri build --debug --no-bundle` with `pnpm dev` running.
import { createNotebook } from "./create-notebook.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve("test-results/ai-website-card-" + Date.now());
await mkdir(root, { recursive: true });
const child = spawn(path.resolve("src-tauri/target/debug/knot.exe"), [], {
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    KNOT_TEST_DATA_DIR: root,
    KNOT_TEST_SHELL_ARGS: "--remote-debugging-port=9298",
  },
});
let browser, page;
try {
  for (let i = 0; i < 150 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9298");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  assert.ok(browser, "Native app did not start");
  page = browser.contexts()[0].pages()[0];
  page.on("dialog", (dialog) => dialog.accept());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForSelector(".app-shell", { timeout: 90000 });
  // Mock the AI and website fetch at the WebView's IPC boundary.
  await page.evaluate(() => {
    const original = window.fetch;
    window.webCalls = [];
    window.aiRequests = [];
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
      if (command.startsWith("ai_diagnostics") || command === "ai_cancel")
        return;
      if (command === "web_sources_cancel") return;
      if (command === "web_sources_fetch") {
        window.webCalls.push(args.urls);
        channel(args, [
          ...args.urls.flatMap((url) => [
            { url, status: "fetching" },
            {
              url,
              status: "finished",
              result: {
                url,
                finalUrl: url,
                fetchedAt: String(Date.now()),
                contentType: "text/html",
                body: "<html><head><title>Speaking coach</title></head><body><main><h1>Speak with confidence</h1><p>The coach gives instant feedback on posture, eye contact and tone.</p></main></body></html>",
              },
            },
          ]),
          { url: "", status: "complete" },
        ]);
        return;
      }
      if (command === "ai_respond") {
        window.aiRequests.push(args);
        const web = JSON.parse(args.context).citationSources.filter(
          (s) => s.kind === "web",
        );
        channel(args, [
          { delta: `It coaches public speaking ${web[0]?.citation ?? ""}.` },
        ]);
        return;
      }
      throw Error("Unexpected mock: " + command);
    };
    window.fetch = async (url, options) => {
      const command = String(url).split("/").at(-1);
      // Record browser commands instead of opening real pages.
      if (command.startsWith("browser_")) {
        (window.browserCalls ??= []).push({
          command,
          args: JSON.parse(options.body || "{}"),
        });
        return new Response("null", {
          headers: {
            "Content-Type": "application/json",
            "Tauri-Response": "ok",
          },
        });
      }
      // Chats save to the real (isolated) test workspace.
      if (
        command.startsWith("ai_chat") ||
        (!command.startsWith("ai_") && !command.startsWith("web_sources_"))
      )
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
  await createNotebook(page); // A new notebook opens on its canvas.
  await page.waitForSelector("affine-edgeless-root", { timeout: 30000 });
  // Select a website card, then open Ask Knot (the screenshot's flow).
  await page.evaluate(() => {
    const container = document.querySelector("affine-editor-container");
    const doc = container.doc;
    const surface = doc.getBlocksByFlavour("affine:surface")[0].model;
    const id = doc.addBlock(
      "affine:bookmark",
      {
        url: "https://example.com/coach",
        title: "AI Public Speaking Coach",
        xywh: "[400,0,360,240]",
      },
      surface.id,
    );
    container
      .querySelector("affine-edgeless-root")
      .gfx.selection.set({ elements: [id], editing: false });
  });
  await page.getByRole("button", { name: "Ask Knot", exact: true }).click();
  await page.getByLabel("Ask Knot message").fill("Summarize this");
  await page.getByRole("button", { name: "Send to Knot", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop", exact: true })
    .waitFor({ state: "detached", timeout: 20000 });
  assert.deepEqual(await page.evaluate(() => window.webCalls), [
    ["https://example.com/coach"],
  ]);
  const context = JSON.parse(
    await page.evaluate(() => window.aiRequests.at(-1).context),
  );
  const web = context.citationSources.filter((s) => s.kind === "web");
  assert.ok(
    web.some((s) => s.text.includes("instant feedback on posture")),
    "The card's page text must reach the model",
  );
  assert.equal(await page.locator(".web-source-item").count(), 1);
  assert.match(
    await page.locator(".ask-knot").innerText(),
    /It coaches public speaking/,
  );
  console.log("PASS a selected website card's page is captured and sent");
  // The card and its fetched page are one source: one chip, not two.
  assert.equal(
    await page.locator(".ask-sent-attachments li").count(),
    1,
    "The sent message lists the card's page once",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Exclude note context", exact: true })
      .count(),
    0,
    "The composer does not repeat the card beside its website source",
  );
  console.log("PASS one chip for a website card and its page");
  // Open source follows Settings → Web links (default: Knot's browser).
  await page.evaluate(() => (window.browserCalls = []));
  await page.locator(".ask-sources summary").last().click();
  await page.getByRole("button", { name: "Open source", exact: true }).click();
  await page.waitForFunction(() =>
    window.browserCalls.some((c) => c.command !== "browser_status"),
  );
  const calls = await page.evaluate(() => window.browserCalls);
  assert.ok(
    calls.some(
      (c) =>
        ["browser_create", "browser_navigate"].includes(c.command) &&
        c.args.url?.startsWith("https://example.com/coach"),
    ),
    "Open source opens Knot's browser: " + JSON.stringify(calls),
  );
  assert.ok(!calls.some((c) => c.command === "browser_open_external"));
  // Settings → Web links → default browser (read from storage per open).
  await page.evaluate(() => {
    localStorage.setItem("knot.web-links", "external");
    window.browserCalls = [];
  });
  // Knot's Browser opened as a tab beside Ask Knot; go back to the chat.
  await page.getByRole("tab", { name: /Ask Knot/ }).click();
  await page.getByRole("button", { name: "Open source", exact: true }).click();
  await page.waitForFunction(() => window.browserCalls.length > 0);
  const external = await page.evaluate(() => window.browserCalls);
  assert.ok(
    external.some(
      (c) =>
        c.command === "browser_open_external" &&
        c.args.url?.startsWith("https://example.com/coach"),
    ),
    "Open source opens the default browser: " + JSON.stringify(external),
  );
  console.log("PASS Open source follows the Web links setting (both choices)");
  await page.screenshot({ path: path.join(root, "website-card.png") });
} catch (error) {
  if (page) await page.screenshot({ path: path.join(root, "failure.png") });
  throw error;
} finally {
  if (child.pid && child.exitCode === null)
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
}
