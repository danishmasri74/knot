import { createNotebook } from "./create-notebook.mjs";
import { clickShellButton } from "./shell-navigation.mjs";
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("test-results/pdf-highlights-" + Date.now());
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9260",
    },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9260");
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
  await page.locator(".app-shell").waitFor();
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
  await clickShellButton(page, name);
  await ready();
}
async function stop() {
  await browser?.close();
  browser = null;
  // Closing the CDP browser may already have exited the native test process.
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (child?.pid && child.exitCode === null) {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch (error) {
      // The process can finish between the exitCode check and taskkill.
      try {
        process.kill(child.pid, 0);
      } catch (probe) {
        if (probe.code === "ESRCH") {
          child = null;
          return;
        }
        throw error;
      }
      throw error;
    }
  }
  child = null;
}
const { PDFDocument, StandardFonts } = await import("pdf-lib");
const fixture = await PDFDocument.create();
const font = await fixture.embedFont(StandardFonts.Helvetica);
fixture
  .addPage([600, 500])
  .drawText("First PDF page", { x: 40, y: 420, size: 20, font });
const second = fixture.addPage([600, 1200]);
second.drawText("A retained highlight on page two.", {
  x: 40,
  y: 420,
  size: 20,
  font,
});
second.drawText("The original PDF remains unchanged.", {
  x: 40,
  y: 380,
  size: 20,
  font,
});
fixture.addPage([600, 500]);
const fixturePath = path.join(root, "highlights.pdf");
await writeFile(fixturePath, await fixture.save());
async function readerReady(text) {
  await page.waitForFunction(
    (text) =>
      [...document.querySelectorAll(".pdf-reader .textLayer span")].some((el) =>
        el.textContent.includes(text),
      ),
    text,
  );
}
async function chooseText(text) {
  await readerReady(text);
  const span = page
    .locator(".pdf-reader .textLayer span")
    .filter({ hasText: text })
    .first();
  await span.scrollIntoViewIfNeeded();
  const box = await span.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await page
    .getByRole("button", { name: "Create highlight card", exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll(".pdf-reader button")].find(
        (b) => b.getAttribute("aria-label") === "Create highlight card",
      ).disabled,
  );
}
try {
  await launch();
  await createNotebook(page);
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await page.locator("affine-attachment").first().waitFor();
  await click("PDF reader");
  await readerReady("First PDF page");
  await page.locator('.pdf-page[data-page="2"]').evaluate((el) => {
    const scroll = el.parentElement;
    scroll.scrollTop +=
      el.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
  });
  await chooseText("A retained highlight");
  await click("Create highlight card");
  const excerpt = page.locator("knot-cited-excerpt").last();
  await excerpt.waitFor();
  const quote = excerpt.locator("blockquote").first();
  const text = await quote.textContent();
  await quote.focus();
  await page.keyboard.type("MUTATION");
  assert.equal(
    await quote.textContent(),
    text,
    "Typing cannot change cited text",
  );
  await page.locator(".pdf-highlight.active").first().focus();
  await page.keyboard.press("Enter");
  const clear = page.getByRole("button", {
    name: "Unlink excerpt and clear highlight",
    exact: true,
  });
  await clear.focus();
  await clear.click();
  await page.locator(".pdf-toast").getByText("Undo", { exact: true }).waitFor();
  assert.equal(await page.locator("knot-cited-excerpt").count(), 0);
  assert.equal(await page.locator(".pdf-highlight").count(), 0);
  const modelState = await page.evaluate(() =>
    document
      .querySelector("affine-editor-container")
      .doc.getBlocksByFlavour("affine:paragraph")
      .map(({ model }) => model.text.toDelta()),
  );
  assert.ok(JSON.stringify(modelState).includes("A retained highlight"));
  assert.ok(
    !JSON.stringify(modelState).includes("knot.invalid/pdf"),
    "Unlink removes the citation",
  );
  await page.locator(".pdf-toast").getByText("Undo", { exact: true }).click();
  await excerpt.waitFor();
  assert.ok(await page.locator(".pdf-highlight").count());
  await page
    .getByRole("button", { name: "Close PDF reader tab", exact: true })
    .click();
  // Turn this block back into a legacy pair with edited wording, then reopen.
  await page.evaluate(() => {
    const doc = document.querySelector("affine-editor-container").doc;
    const model = doc.getBlocksByFlavour("knot:cited-excerpt")[0].model;
    const parent = doc.getParent(model),
      source = model.source,
      Text = model.text.constructor;
    doc.transact(() => {
      doc.addBlock(
        "affine:paragraph",
        { type: "quote", text: new Text("Edited legacy wording") },
        parent,
      );
      doc.addBlock(
        "affine:paragraph",
        {
          text: new Text([
            { insert: "PDF source", attributes: { link: source } },
          ]),
        },
        parent,
      );
      doc.deleteBlock(model);
    });
  });
  await page.waitForTimeout(1500);
  await stop();
  await launch();
  await page
    .getByText("Existing excerpt · source review needed", { exact: true })
    .waitFor();
  assert.equal(
    (
      await page.locator("knot-cited-excerpt blockquote").first().textContent()
    ).trim(),
    "Edited legacy wording",
  );
  await page.getByRole("button", { name: "Check source", exact: true }).click();
  await page
    .getByRole("button", { name: "Use source excerpt", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Use source excerpt", exact: true })
    .click();
  assert.ok(
    (
      await page.locator("knot-cited-excerpt blockquote").first().textContent()
    ).includes("A retained highlight"),
  );
  await page.locator("knot-cited-excerpt").scrollIntoViewIfNeeded();
  const clipboardResult = await page.evaluate(async () => {
    const editor = document.querySelector("affine-editor-container"),
      doc = editor.doc,
      clipboard = editor.std.clipboard;
    const model = doc.getBlocksByFlavour("knot:cited-excerpt")[0].model;
    const slice = {
      content: [model],
      docId: doc.id,
      workspaceId: doc.collection.id,
      data: {
        content: [model],
        pageId: doc.id,
        workspaceId: doc.collection.id,
      },
    };
    const write = clipboard.writeToClipboard;
    let captured;
    clipboard.writeToClipboard = async (getter) => {
      captured = await getter({});
    };
    try {
      await clipboard.copy(slice);
    } finally {
      clipboard.writeToClipboard = write;
    }
    await clipboard.duplicateSlice(slice, doc, doc.getParent(model).id);
    const duplicate = doc
      .getBlocksByFlavour("knot:cited-excerpt")
      .find(({ model: m }) => m.id !== model.id).model;
    const same =
      duplicate.text.toString() === model.text.toString() &&
      duplicate.source === model.source &&
      duplicate.reviewed === model.reviewed;
    doc.deleteBlock(duplicate);
    return { captured, same };
  });
  assert.equal(
    clipboardResult.same,
    true,
    "Internal copy keeps citation and read-only state",
  );
  assert.ok(
    clipboardResult.captured["text/plain"].includes("A retained highlight"),
  );
  assert.ok(clipboardResult.captured["text/html"].includes("knot.invalid/pdf"));
  assert.ok(
    clipboardResult.captured["text/html"].includes("A retained highlight"),
  );
  await page.locator("knot-cited-excerpt a").first().click();
  await readerReady("A retained highlight");
  await chooseText("The original PDF remains");
  await click("Replace excerpt");
  await page.getByText("Excerpt replaced", { exact: true }).waitFor();
  await click("Close PDF reader tab");
  assert.equal(await page.locator("knot-cited-excerpt").count(), 1);
  assert.ok(
    (
      await page.locator("knot-cited-excerpt blockquote").textContent()
    ).includes("The original PDF remains"),
  );
  await page.screenshot({ path: path.join(root, "cited-excerpt.png") });
  await click("Canvas");
  await page.locator("knot-cited-excerpt").first().waitFor();
  assert.equal(
    await page
      .locator("knot-cited-excerpt")
      .first()
      .evaluate((el) => el.isContentEditable),
    false,
  );
  const paintOrder = await page.evaluate(async () => {
    const excerpt = document.querySelector(
        "affine-edgeless-root knot-cited-excerpt",
      ),
      note = excerpt.closest("affine-edgeless-note"),
      v = document.querySelector("affine-edgeless-root").gfx.viewport;
    const [x, y, w, h] = JSON.parse(note.model.xywh);
    v.setZoom(0.5);
    v.setCenter(x + w / 2, y + h / 2);
    await new Promise((r) => setTimeout(r, 250));
    const quote = excerpt.querySelector("blockquote"),
      bg = note.querySelector(".note-background");
    const order = () => {
      const r = quote.getBoundingClientRect(),
        els = document.elementsFromPoint(r.left + 10, r.top + r.height / 2);
      return [els.indexOf(quote), els.indexOf(bg)];
    };
    return order();
  });
  assert.ok(
    paintOrder[0] >= 0 && paintOrder[0] < paintOrder[1],
    "Canvas quote paints above its note background",
  );
  await page.screenshot({ path: path.join(root, "cited-excerpt-canvas.png") });
  await click("Page");
  await page.evaluate(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (String(input).endsWith("/export_document")) {
        window.exportCapture = JSON.parse(init.body);
        return new Response(JSON.stringify("Captured"), {
          headers: {
            "Content-Type": "application/json",
            "Tauri-Response": "ok",
          },
        });
      }
      return fetch(input, init);
    };
  });
  await click("Export");
  await page.getByLabel("Export format").selectOption("markdown");
  await click("Save export");
  const files = await page.evaluate(() => window.exportCapture.files);
  const markdown = Buffer.from(
    files.find((f) => f.name === "index.md").bytes,
  ).toString();
  assert.ok(markdown.includes("The original PDF remains"));
  assert.ok(markdown.includes("knot.invalid/pdf"));

  console.log(
    "PASS locked excerpts, unlink and Undo, migration, source restoration, Page/Canvas, clipboard and Markdown",
    root,
  );
} finally {
  await stop();
}
