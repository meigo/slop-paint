// iPad smoke check (`npm run test:ipad`): the app in WebKit — Safari's engine — at iPad Pro 11
// landscape size with touch, in a fresh profile (its own IndexedDB: never your documents).
//
//   npm run test:ipad                     starts its own dev server on a free port
//   npm run test:ipad -- <url>            checks that URL instead (e.g. the deployed site)
//
// Screenshots go to test-results/ipad/. Exits 1 when a check fails or the page reports an error.
// Not covered — test these on the iPad itself: the real Pencil (strokes here are simulated pen
// events), multi-finger gestures, the share sheet, the on-screen keyboard, iPadOS memory limits.
// First run on a machine: `npx playwright install webkit` (~100 MB).
/* global Element, document, PointerEvent -- used inside page.evaluate / addInitScript, which run in the page */
import { mkdirSync } from "node:fs";
import { webkit, devices } from "playwright";
import { createServer } from "vite";

const OUT = "test-results/ipad";
mkdirSync(OUT, { recursive: true });

let server = null;
let url = process.argv[2];
if (!url) {
  server = await createServer({ server: { port: 0 }, logLevel: "error" });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await webkit.launch();
try {
  const context = await browser.newContext({ ...devices["iPad Pro 11 landscape"] });
  // Simulated pen events aren't live pointers, so WebKit refuses to capture them ("The object
  // can not be found here"); a real Pencil is one. Let capture fail quietly for the simulation.
  await context.addInitScript(() => {
    const capture = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = function (id) {
      try {
        capture.call(this, id);
      } catch {
        /* simulated pointer */
      }
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(url);
  await page.waitForSelector("text=Background", { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/1-loaded.png` });
  check(true, `loads (${url})`);

  // A Pencil stroke: pen pointer events with rising and falling pressure.
  const box = await page.locator('canvas[style*="width"]').first().boundingBox();
  await page.evaluate(
    ({ x, y, w, h }) => {
      const target = document.elementFromPoint(x + w / 2, y + h / 2);
      const send = (type, t) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 2,
            pointerType: "pen",
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: x + w * (0.2 + 0.6 * t),
            clientY: y + h * (0.4 + 0.2 * Math.sin(t * Math.PI)),
            pressure: 0.2 + 0.7 * Math.sin(t * Math.PI),
          }),
        );
      send("pointerdown", 0);
      for (let i = 1; i <= 40; i++) send("pointermove", i / 40);
      send("pointerup", 1);
    },
    { x: box.x, y: box.y, w: box.width, h: box.height },
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/2-stroke.png` });
  const undo = await page.locator('button[title^="Undo"]').first().getAttribute("title");
  check(!/nothing to undo/.test(undo ?? ""), "a pen stroke draws and adds an undo step");

  // A finger tap on a toolbar menu: real touch input, as Safari gets it.
  const file = await page.getByRole("button", { name: /^File/ }).boundingBox();
  await page.touchscreen.tap(file.x + file.width / 2, file.y + file.height / 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/3-menu.png` });
  check((await page.locator('[role="menu"]').count()) > 0, "a finger tap opens the File menu");

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
  await server?.close();
}
console.log(
  failures.length ? `\n${failures.length} failed` : `\nall passed — screenshots in ${OUT}/`,
);
process.exit(failures.length ? 1 : 0);
