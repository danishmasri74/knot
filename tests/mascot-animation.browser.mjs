import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

await mkdir("test-results/mascot-rigs", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 880 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/mascot-rig-review", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<style>body{margin:0;font:14px system-ui;background:#888}#root>div{display:grid;grid-template-columns:repeat(4,1fr);gap:1px}.mascot-scene{width:300px!important;opacity:1!important;filter:none!important}section{height:430px;display:grid;justify-items:center;align-content:center}p{margin:12px}</style><div id="root"></div>',
    }),
  );
  await page.goto("http://127.0.0.1:1420/mascot-rig-review");
  await page.evaluate(async () => {
    const rt = (await import("/@react-refresh")).default;
    rt.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (t) => t;
    window.__vite_plugin_react_preamble_installed__ = true;
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (
      await import("/node_modules/.vite/deps/react-dom_client.js")
    ).default;
    const { Mascot } = await import("/src/app/Mascot.tsx");
    createRoot(document.getElementById("root")).render(
      React.createElement(
        "div",
        {},
        ...["light", "dark"].flatMap((theme) =>
          ["write", "library", "search", "ask"].map((mood) =>
            React.createElement(
              "section",
              {
                key: `${theme}-${mood}`,
                style: {
                  background: theme === "light" ? "#fafafa" : "#202124",
                  color: theme === "light" ? "#444" : "#ddd",
                },
              },
              React.createElement(Mascot, { mood }),
              React.createElement("p", {}, `${mood} / ${theme}`),
            ),
          ),
        ),
      ),
    );
  });
  await page.waitForSelector(".mascot-writing-hand");
  await page.evaluate(async () => {
    await Promise.all(
      [
        ...new Set(
          [...document.querySelectorAll("image,img")].map(
            (el) => el.getAttribute("href") || el.getAttribute("src"),
          ),
        ),
      ].map(
        (src) =>
          new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = resolve;
            i.onerror = reject;
            i.src = src;
          }),
      ),
    );
  });
  const seek = (ms) =>
    page.evaluate(
      (ms) =>
        document.getAnimations().forEach((a) => {
          a.pause();
          a.currentTime = ms;
        }),
      ms,
    );
  await seek(0);
  const anchors = await page
    .locator(".mascot-rig > image:first-of-type")
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      }),
    );
  const propBoxes = await page
    .locator(".mascot-page-hands, .mascot-glass-hand, .mascot-writing-hand")
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return [r.x, r.y];
      }),
    );
  await page.screenshot({ path: "test-results/mascot-rigs/rest.png" });
  for (const ms of [1400, 2600, 3600, 4900]) {
    await seek(ms);
    await page.screenshot({ path: `test-results/mascot-rigs/frame-${ms}.png` });
    const now = await page
      .locator(".mascot-rig > image:first-of-type")
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        }),
      );
    assert.deepEqual(
      now,
      anchors,
      "bodies must remain stationary while props move",
    );
    if (ms === 1400) {
      const moved = await page
        .locator(".mascot-page-hands, .mascot-glass-hand, .mascot-writing-hand")
        .evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return [r.x, r.y];
          }),
        );
      moved.forEach((v, i) =>
        assert(
          Math.hypot(v[0] - propBoxes[i][0], v[1] - propBoxes[i][1]) > 3,
          "each prop must visibly move independently",
        ),
      );
    }
  }
  await page.evaluate(() =>
    document.getAnimations().forEach((a) => {
      a.currentTime =
        a.animationName === "mascot-writing-blink"
          ? 1640
          : a.animationName.includes("blink")
            ? 3182 + Number(a.effect.getTiming().delay)
            : 0;
    }),
  );
  await page.screenshot({ path: "test-results/mascot-rigs/blink.png" });
  const clipIds = await page
    .locator("clipPath,mask")
    .evaluateAll((els) => els.map((el) => el.id));
  assert.equal(new Set(clipIds).size, clipIds.length);
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  await page.screenshot({
    path: "test-results/mascot-rigs/reduced-motion.png",
  });
  assert.deepEqual(errors, []);
  console.log(
    "Independent prop motion, stationary bodies, all blink poses, unique mask/clip IDs and reduced motion passed in light/dark.",
  );
} finally {
  await browser.close();
}
