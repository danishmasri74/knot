import { expect, test } from "vitest";
import { extractWebSource } from "../src/services/web-source-extraction";

test("Readability worker DOM preserves article, documentation, code, tables, Unicode and malformed text", () => {
  const result = extractWebSource(
    `<html><head><title>Guide</title></head><body><nav>Ignore</nav><main><h1>مرحبا 世界</h1><p>A short valid page.</p><pre>const x = 1;\nconsole.log(x)</pre><table><tr><th>Item</th><th>Cost</th></tr><tr><td>Tea</td><td>3</td></tr></table><ul><li>One</li><li>Two</li></ul><p>Unclosed`,
    "text/html",
  );
  expect(result.title).toBe("Guide");
  expect(
    result.sections.some(
      (s) => s.kind === "code" && s.text.includes("const x"),
    ),
  ).toBe(true);
  expect(
    result.sections.some(
      (s) => s.kind === "table" && s.text.includes("Item | Cost\nTea | 3"),
    ),
  ).toBe(true);
  expect(result.sections.map((s) => s.text).join(" ")).toContain("مرحبا 世界");
  expect(result.sections.map((s) => s.text).join(" ")).not.toContain("Ignore");
  expect(
    extractWebSource("<html><body><p>Hi.</p></body></html>", "text/html")
      .sections[0].text,
  ).toBe("Hi.");
});
test("hostile markup remains inert and visual gaps/challenges are explicit", () => {
  const result = extractWebSource(
    '<html><body><article><h1>Safe</h1><p onclick="fetch(\'/bad\')">Evidence</p><script>throw Error("executed")</script><img src="https://example.com/track"><iframe src="https://example.com/frame"></iframe></article></body></html>',
    "text/html",
  );
  expect(result.sections.map((s) => s.text).join(" ")).toBe("Safe Evidence");
  expect(result.warnings).toContain(
    "Images, embedded and visual content were not captured.",
  );
  expect(() =>
    extractWebSource(
      "<html><head><title>Just a moment</title></head><body>Verify you are human</body></html>",
      "text/html",
    ),
  ).toThrow("challenge");
  expect(() =>
    extractWebSource(
      "<html><body><script>app()</script></body></html>",
      "text/html",
    ),
  ).toThrow("No readable");
});
test("long passages keep Unicode intact and reject excessive DOMs", () => {
  const body = "x".repeat(5999) + "😀" + "z".repeat(10_000);
  const result = extractWebSource(body, "text/plain");
  expect(result.sections.map((s) => s.text).join("")).toBe(body);
  expect(result.sections.every((s) => s.text.length <= 6000)).toBe(true);
  expect(() =>
    extractWebSource(
      `<html><body><main>${"<p>x</p>".repeat(50_001)}</main></body></html>`,
      "text/html",
    ),
  ).toThrow("DOM limit");
});

test("layout tables become text and cell whitespace collapses", () => {
  const { sections } = extractWebSource(
    `<html><body><main><h1>Guide</h1><table><tr><td class="icon"><i title="Note"></i></td><td class="content">This tutorial needs a review.
         You can edit it.</td></tr></table><table><tr><th>Name</th><th>Note</th></tr><tr><td>Tea</td><td></td></tr><tr><td>Rice
      bowl</td><td>Hot</td></tr></table></main></body></html>`,
    "text/html",
  );
  expect(sections.find((s) => s.text.startsWith("This tutorial"))).toMatchObject({
    kind: "text",
    text: "This tutorial needs a review. You can edit it.",
  });
  // Real data tables keep empty cells so columns stay aligned.
  expect(sections.find((s) => s.kind === "table")?.text).toBe(
    "Name | Note\nTea | \nRice bowl | Hot",
  );
});

test("inline content reads as whole passages with rendered whitespace", () => {
  const { sections } = extractWebSource(
    `<html><body><main><div class="hatnote">For the game, see <a href="/g">Gungnir (game)</a>. For the missile, see <a>RBS 15</a>.</div>
    <h2>History<span class="mw-editsection">[<a>edit</a>]</span></h2>
    <figure><img src="x"><figcaption>A plate depicting <a>Odin</a> with <a>Gungnir</a>.<sup>[1]</sup></figcaption></figure>
    <p>The element is used
        to collect input<br>across lines.</p>
    <ul><li>Parent item<ul><li>Child item</li></ul></li></ul>
    <div class="w3-code notranslate">&lt;form&gt;<br>&nbsp;&nbsp;&lt;input&gt;<br>&lt;/form&gt;</div>
    <div class="navbox">Navigation box</div><div class="catlinks">Categories: Spears</div></main></body></html>`,
    "text/html",
  );
  const texts = sections.map((s) => s.text);
  expect(texts).toContain("For the game, see Gungnir (game). For the missile, see RBS 15.");
  expect(texts).toContain("History");
  expect(texts).toContain("A plate depicting Odin with Gungnir.[1]");
  expect(texts).toContain("The element is used to collect input\nacross lines.");
  expect(sections.find((s) => s.text === "Parent item")?.kind).toBe("list");
  expect(sections.find((s) => s.text === "Child item")?.kind).toBe("list");
  expect(sections.find((s) => s.kind === "code")?.text).toBe("<form>\n  <input>\n</form>");
  expect(texts.join(" ")).not.toMatch(/edit|Navigation box|Categories/);
});

test("demo password fields don't make a tutorial look like a sign-in page", () => {
  const tutorial = `<html><head><title>HTML Input Types</title></head><body><main><h1>Input types</h1>${"<p>The password input masks characters typed by the user in a form field.</p>".repeat(60)}<form><input type="password"></form></main></body></html>`;
  expect(extractWebSource(tutorial, "text/html").sections.length).toBeGreaterThan(10);
  const login = `<html><head><title>Welcome</title></head><body><form><label>Email<input></label><label>Password<input type="password"></label></form></body></html>`;
  expect(() => extractWebSource(login, "text/html")).toThrow(/login/);
});
