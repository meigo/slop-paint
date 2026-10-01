// iPad smoke check (`npm run test:ipad`): the app in WebKit — Safari's engine — at iPad Pro 11
// size with touch, in a fresh profile (its own IndexedDB and localStorage: never your documents).
// Walks most of the app: every tool and brush type, the touch gestures, selections and
// transforms, the layer panel, text and image references, the dialogs, save/export/open through
// the share sheet, autosave across a reload, and portrait layout.
//
//   npm run test:ipad                     starts its own dev server on a free port
//   npm run test:ipad -- <url>            checks that URL instead (e.g. the deployed site)
//
// Screenshots go to test-results/ipad/ (one per step, and `FAIL-…` for a failed one). Exits 1 when
// a check fails or the page reports an error. Each step runs on its own: a failure is reported and
// the next step still runs.
//
// Two kinds of input, and they are not equally strong evidence:
//   - REAL taps (`tap`, `locator.tap()`): Playwright's touchscreen, which WebKit turns into a
//     genuine touch — the browser makes the pointer, touch and click events itself.
//   - SIMULATED gestures (`gesture`, checks marked [sim]): the Pencil, drags and multi-finger
//     gestures are pointer events this script dispatches (over, enter, down, moves, up, out,
//     leave). They test the app's routing and tools, not what iPadOS delivers.
// Pixels are read back from the on-screen canvas (the composited document).
// Not covered — test on the iPad itself: the real Pencil (pressure, palm), how gestures feel, the
// real share sheet (stubbed here: `navigator.share` records the file), the system clipboard, the
// on-screen keyboard, iPadOS memory limits.
// First run on a machine: `npx playwright install webkit` (~100 MB).
/* global setTimeout, getComputedStyle, Element, document, window, navigator, PointerEvent, MouseEvent, FileReader -- used inside page.evaluate / addInitScript, which run in the page */
import { mkdirSync, rmSync } from "node:fs";
import process from "node:process";
import { devices, webkit } from "playwright";
import { createServer } from "vite";

const OUT = "test-results/ipad";
rmSync(OUT, { recursive: true, force: true }); // no stale FAIL shots from an earlier run
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `fn` until it returns truthy or `ms` pass; returns the last value. */
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  let v = await fn();
  while (!v && Date.now() < end) {
    await sleep(100);
    v = await fn();
  }
  return v;
}

/** Runs in the page before the app. */
function pageSetup() {
  // Simulated pointers aren't live, so WebKit refuses to capture them ("The object can not be
  // found here"); a real Pencil or finger is one. Let capture fail quietly for the simulation.
  const capture = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function (id) {
    try {
      capture.call(this, id);
    } catch {
      /* simulated pointer */
    }
  };

  // The share sheet, stubbed: Save to Files and the exports reach `navigator.share` exactly as on
  // the iPad (WebKit with an iPad user agent counts as an Apple touch device). It records each
  // file, with its bytes as base64 so the script can open a saved PSD again.
  window.__shared = [];
  Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async ({ files }) => {
      for (const f of files) {
        const b64 = await new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
          r.readAsDataURL(f);
        });
        window.__shared.push({ name: f.name, type: f.type, size: f.size, b64 });
      }
    },
  });

  /** Plays simulated pointer steps: `{ type: "down" | "move" | "up" | "cancel", id, kind, x, y,
   *  p?, wait? }`, or `{ type: "click", x, y }` for the click a browser may add after a lift. */
  // Kept across calls, so a check can look at the page mid-gesture and lift in a later call.
  const targets = new Map();
  window.__gesture = async (steps) => {
    const fire = (el, type, s, extra) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: type !== "pointerenter" && type !== "pointerleave",
          cancelable: true,
          composed: true,
          pointerId: s.id,
          pointerType: s.kind,
          isPrimary: targets.size === 1,
          clientX: s.x,
          clientY: s.y,
          width: s.kind === "touch" ? 20 : 1,
          height: s.kind === "touch" ? 20 : 1,
          pressure: s.p ?? 0.5,
          ...extra,
        }),
      );
    for (const s of steps) {
      if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
      if (s.type === "click") {
        document.elementFromPoint(s.x, s.y)?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: s.x,
            clientY: s.y,
          }),
        );
      } else if (s.type === "down") {
        const el = document.elementFromPoint(s.x, s.y);
        targets.set(s.id, el);
        fire(el, "pointerover", s, { buttons: 1 });
        fire(el, "pointerenter", s, { buttons: 1 });
        fire(el, "pointerdown", s, { button: 0, buttons: 1 });
      } else if (s.type === "move") {
        fire(targets.get(s.id), "pointermove", s, { button: -1, buttons: 1 });
      } else {
        const el = targets.get(s.id);
        const end = s.type === "up" ? "pointerup" : "pointercancel";
        fire(el, end, s, { button: 0, buttons: 0, pressure: 0 });
        fire(el, "pointerout", s, { buttons: 0, pressure: 0, relatedTarget: null });
        fire(el, "pointerleave", s, { buttons: 0, pressure: 0, relatedTarget: null });
        targets.delete(s.id);
      }
    }
  };

  /** Pixel stats of the on-screen canvas (the composited document) inside a client rect: how many
   *  pixels are dark, the average colour, and the darkest pixel's client position. */
  window.__pixels = ({ x, y, w, h }) => {
    const c = document.querySelector(".canvas-checkerboard + canvas");
    const r = c.getBoundingClientRect();
    const sx = c.width / r.width;
    const sy = c.height / r.height;
    const px = Math.max(0, Math.round((x - r.left) * sx));
    const py = Math.max(0, Math.round((y - r.top) * sy));
    const pw = Math.max(1, Math.min(c.width - px, Math.round(w * sx)));
    const ph = Math.max(1, Math.min(c.height - py, Math.round(h * sy)));
    const d = c.getContext("2d").getImageData(px, py, pw, ph).data;
    let dark = 0;
    let rs = 0;
    let gs = 0;
    let bs = 0;
    let min = Infinity;
    let at = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] + d[i + 1] + d[i + 2];
      if (v < 450) dark++;
      if (v < min) [min, at] = [v, i / 4];
      rs += d[i];
      gs += d[i + 1];
      bs += d[i + 2];
    }
    const n = d.length / 4;
    const hex = (v) =>
      Math.round(v / n)
        .toString(16)
        .padStart(2, "0");
    return {
      dark,
      avg: `#${hex(rs)}${hex(gs)}${hex(bs)}`,
      darkest: {
        x: r.left + ((at % pw) + px + 0.5) / sx,
        y: r.top + (Math.floor(at / pw) + py + 0.5) / sy,
      },
    };
  };
}

/** Steps for one pointer dragged along `path` (a function of t in 0..1). */
function pathSteps(
  kind,
  id,
  path,
  { n = 30, wait = 8, p = (t) => 0.3 + 0.6 * Math.sin(t * Math.PI) } = {},
) {
  const a = path(0);
  const steps = [{ type: "down", id, kind, x: a.x, y: a.y, p: p(0) }];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const q = path(t);
    steps.push({ type: "move", id, kind, x: q.x, y: q.y, p: p(t), wait });
  }
  const b = path(1);
  steps.push({ type: "up", id, kind, x: b.x, y: b.y, wait });
  return steps;
}
const line = (a, b) => (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Every step of the walk-through for one page; `step` isolates failures. */
async function main(page) {
  const gesture = (steps) => page.evaluate((s) => window.__gesture(s), steps);
  const pixels = (r) => page.evaluate((r) => window.__pixels(r), r);
  const tap = (p) => page.touchscreen.tap(p.x, p.y);
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
  const status = () => page.locator("div.h-7.border-t").innerText();
  /** The status bar's context line: a tap on the bar itself (it has no title) clears the hint
   *  that the last tapped control left there, which outranks the context. */
  const context = async () => {
    await page.locator("div.h-7.border-t").tap();
    await page.waitForTimeout(100);
    return status();
  };
  const redo = () => page.locator('button[title^="Redo"]').first().tap();
  const undo = () => page.locator('button[title^="Undo"]').first().tap();
  const undoTitle = () => page.locator('button[title^="Undo"]').first().getAttribute("title");
  const canUndo = async () => !/nothing to undo/.test((await undoTitle()) ?? "");
  const zoom = () => page.getByTitle("Zoom", { exact: true }).innerText();
  const shared = () => page.evaluate(() => window.__shared);
  const tool = (title) => page.locator(`button[title^="${title}"]`).first();
  const tapTool = async (title) => {
    await tool(title).tap();
    await page.waitForTimeout(150);
  };
  const pressed = async (title) => (await tool(title).getAttribute("aria-pressed")) === "true";
  const rows = () => page.locator(".layer-item");
  const rowCount = () => rows().count();
  const activeRow = () => page.locator(".layer-item.ui-selected");
  /** Opens a toolbar menu and taps one of its items. */
  async function menu(name, item) {
    await page
      .getByRole("button", { name: new RegExp(`^${name}`) })
      .first()
      .tap();
    await page.getByRole("menuitem", { name: item }).first().tap();
    await page.waitForTimeout(250);
  }
  const fit = async () => {
    await menu("View", /^Fit to view/);
    await page.waitForTimeout(200);
  };

  let n = 0;
  /** One step: runs `fn`, which returns [ok, message]; a throw is a failure too. */
  async function step(fn) {
    n++;
    try {
      const [ok, what, name] = await fn();
      check(ok, what);
      await shot(`${String(n).padStart(2, "0")}-${name ?? "step"}${ok ? "" : "-FAIL"}`);
    } catch (e) {
      check(false, `step ${n} threw: ${e.message.split("\n")[0]}`);
      await shot(`${String(n).padStart(2, "0")}-FAIL`).catch(() => {});
      // Leave no menu or dialog open for the next step.
      await page.keyboard.press("Escape").catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------- load and layout
  await page.goto(url);
  await page.waitForSelector("text=Background", { timeout: 20000 });
  await page.waitForTimeout(800);
  const area = await page.locator("div.bg-canvas-bg.touch-none").boundingBox();
  let pb = await page.locator(".canvas-checkerboard + canvas").boundingBox();
  /** A point on the page (the document), as fractions of it. */
  const at = (fx, fy) => ({ x: pb.x + pb.width * fx, y: pb.y + pb.height * fy });
  /** A client rect on the page, as fractions. */
  const rect = (fx, fy, fw, fh) => ({
    x: pb.x + pb.width * fx,
    y: pb.y + pb.height * fy,
    w: pb.width * fw,
    h: pb.height * fh,
  });
  const refreshPage = async () => {
    pb = await page.locator(".canvas-checkerboard + canvas").boundingBox();
  };
  /** A spot on the canvas area off the page, for taps that must hit nothing. */
  const offPage = { x: area.x + 12, y: area.y + area.height - 12 };
  const pen = (path, opts) => gesture(pathSteps("pen", 2, path, opts));
  const penTap = (p) =>
    gesture([
      { type: "down", id: 2, kind: "pen", x: p.x, y: p.y, p: 0.6 },
      { type: "up", id: 2, kind: "pen", x: p.x, y: p.y, wait: 40 },
    ]);
  const wave = (fy) => (t) => ({
    x: pb.x + pb.width * (0.08 + 0.5 * t),
    y: pb.y + pb.height * (fy + 0.025 * Math.sin(t * Math.PI * 4)),
  });
  const band = (fy) => rect(0.05, fy - 0.05, 0.56, 0.1);

  await step(async () => {
    const bar = await page.evaluate(() => {
      const r1 = [...document.querySelectorAll("div")].find(
        (e) => getComputedStyle(e).gridRowStart === "row1",
      );
      return { fits: r1.scrollWidth <= r1.clientWidth, w: r1.clientWidth };
    });
    return [
      bar.fits && pb.width > 100,
      `loads (${url}); toolbar row 1 fits (${bar.w}px), page ${Math.round(pb.width)}×${Math.round(pb.height)} on screen`,
      "loaded",
    ];
  });

  await step(async () => {
    await page.getByRole("button", { name: /^File/ }).first().tap();
    await page.waitForTimeout(300);
    const opened = (await page.locator('[role="menu"]').count()) > 0;
    await shot(`${String(n).padStart(2, "0")}-menu-open`);
    await tap(offPage);
    await page.waitForTimeout(400);
    const closed = (await page.locator('[role="menu"]').count()) === 0;
    return [
      opened && closed,
      "a finger tap opens the File menu, and a tap outside closes it",
      "menu",
    ];
  });

  await step(async () => {
    const t = tool("Lasso Select");
    await t.tap();
    await page.waitForTimeout(200);
    const s = await status();
    await tapTool("Brush (B)");
    return [
      s.includes("Lasso Select (L)"),
      `a tapped tool's title shows in the status bar ("${s.split("\n")[0]}")`,
      "hint",
    ];
  });

  // ------------------------------------------------------------------------------- brushes
  const brushTypes = ["smooth", "ink", "calligraphy", "pencil", "charcoal", "airbrush"];
  const bandY = (i) => 0.1 + i * 0.15;
  await step(async () => {
    const select = page
      .locator("select")
      .filter({ has: page.locator('option[value="calligraphy"]') });
    const results = [];
    for (const [i, kind] of brushTypes.entries()) {
      await select.selectOption(kind);
      await page.waitForTimeout(100);
      const before = await undoTitle();
      await pen(wave(bandY(i)));
      await page.waitForTimeout(300);
      const ink = (await pixels(band(bandY(i)))).dark;
      results.push({ kind, ink, step: (await undoTitle()) !== before || (await canUndo()) });
    }
    await select.selectOption("smooth");
    const bad = results.filter((r) => r.ink < 30 || !r.step);
    return [
      bad.length === 0,
      `[sim] a pen stroke draws with every brush type and adds an undo step (${results.map((r) => `${r.kind} ${r.ink}`).join(", ")} dark px)`,
      "brushes",
    ];
  });

  // ---------------------------------------------------------------------- finger gestures
  const fingers = (k, id, c) =>
    Array.from({ length: k }, (_, i) => ({ id: id + i, x: c.x + i * 60, y: c.y }));
  const multiTap = (fs) => [
    ...fs.map((f, i) => ({ type: "down", kind: "touch", ...f, wait: i ? 15 : 0 })),
    ...fs.map((f, i) => ({ type: "up", kind: "touch", ...f, wait: i ? 10 : 80 })),
  ];
  const lastBand = band(bandY(5));
  await step(async () => {
    const c = at(0.75, 0.5);
    const ink0 = (await pixels(lastBand)).dark;
    await gesture(multiTap(fingers(2, 20, c)));
    await page.waitForTimeout(350);
    const ink1 = (await pixels(lastBand)).dark;
    await gesture(multiTap(fingers(3, 30, c)));
    await page.waitForTimeout(350);
    const ink2 = (await pixels(lastBand)).dark;
    return [
      ink0 > 30 && ink1 < ink0 / 4 && ink2 > ink0 * 0.8,
      `[sim] a two-finger tap undoes the last stroke, a three-finger tap redoes it (dark px ${ink0} → ${ink1} → ${ink2})`,
      "undo-redo-taps",
    ];
  });

  await step(async () => {
    const c = at(0.6, 0.5);
    const z0 = await zoom();
    const whole = rect(0, 0, 1, 1);
    const ink0 = (await pixels(whole)).dark;
    const pinch = [
      { type: "down", id: 50, kind: "touch", x: c.x - 40, y: c.y },
      { type: "down", id: 51, kind: "touch", x: c.x + 40, y: c.y, wait: 15 },
    ];
    for (let i = 1; i <= 10; i++) {
      pinch.push({ type: "move", id: 50, kind: "touch", x: c.x - 40 - i * 8, y: c.y, wait: 16 });
      pinch.push({ type: "move", id: 51, kind: "touch", x: c.x + 40 + i * 8, y: c.y });
    }
    pinch.push({ type: "up", id: 50, kind: "touch", x: c.x - 120, y: c.y, wait: 16 });
    pinch.push({ type: "up", id: 51, kind: "touch", x: c.x + 120, y: c.y, wait: 10 });
    await gesture(pinch);
    await page.waitForTimeout(300);
    const z1 = await zoom();
    await shot(`${String(n).padStart(2, "0")}-pinched`);
    await fit();
    const z2 = await zoom();
    return [
      z1 !== z0 && z2 === z0 && (await pixels(whole)).dark === ink0,
      `[sim] a pinch zooms (${z0} → ${z1}) and draws nothing; View ▸ Fit to view puts it back (${z2})`,
      "pinch",
    ];
  });

  await step(async () => {
    const before = await page.locator(".canvas-checkerboard + canvas").boundingBox();
    const a = at(0.7, 0.5);
    await gesture(
      pathSteps("touch", 60, line(a, { x: a.x + 80, y: a.y + 40 }), { n: 10, wait: 16 }),
    );
    await page.waitForTimeout(250);
    const after = await page.locator(".canvas-checkerboard + canvas").boundingBox();
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    await fit();
    return [
      Math.abs(dx - 80) < 3 && Math.abs(dy - 40) < 3,
      `[sim] a one-finger drag pans the page (moved ${dx.toFixed(0)}, ${dy.toFixed(0)}) and draws nothing`,
      "pan",
    ];
  });

  await step(async () => {
    await refreshPage();
    const p = at(0.8, 0.8);
    await tap(p);
    await page.waitForTimeout(80);
    await tap(p);
    await page.waitForTimeout(300);
    const eraser = await pressed("Eraser (E)");
    const b = band(bandY(0));
    const ink0 = (await pixels(b)).dark;
    await pen(wave(bandY(0)), { p: () => 0.9 });
    await page.waitForTimeout(300);
    const ink1 = (await pixels(b)).dark;
    await page.waitForTimeout(400);
    await tap(p);
    await page.waitForTimeout(80);
    await tap(p);
    await page.waitForTimeout(300);
    const back = await pressed("Brush (B)");
    return [
      eraser && ink1 < ink0 * 0.6 && back,
      `a one-finger double-tap switches to the eraser, which erases (dark px ${ink0} → ${ink1}), and back to the brush`,
      "double-tap-eraser",
    ];
  });

  // ---------------------------------------------------------------------------- colour and fill
  const swatch = () =>
    page
      .locator('button[title^="Brush colour"], button[title^="Fill colour"]')
      .first()
      .getAttribute("title");
  await step(async () => {
    await tapTool("Eyedropper");
    const white = at(0.9, 0.1);
    await gesture(pathSteps("pen", 2, line(white, white), { n: 3 }));
    await page.waitForTimeout(250);
    const picked = await swatch();
    const back = await pressed("Brush (B)");
    await tapTool("Eyedropper");
    const { darkest } = await pixels(band(bandY(1)));
    await gesture(pathSteps("pen", 2, line(darkest, darkest), { n: 3 }));
    await page.waitForTimeout(250);
    const picked2 = await swatch();
    return [
      /#ffffff/i.test(picked) && back && !/#ffffff/i.test(picked2),
      `[sim] the eyedropper picks white, then the ink, and hands back the brush ("${picked}", then "${picked2}")`,
      "eyedropper",
    ];
  });

  await step(async () => {
    await tapTool("Paint Bucket");
    const spot = rect(0.85, 0.45, 0.05, 0.05);
    const c0 = (await pixels(spot)).avg;
    await penTap(at(0.875, 0.475));
    const c1 = await until(async () => {
      const c = (await pixels(spot)).avg;
      return c !== c0 && c;
    });
    await shot(`${String(n).padStart(2, "0")}-filled`);
    await page.locator('button[title^="Undo"]').first().tap();
    await page.waitForTimeout(300);
    const c2 = (await pixels(spot)).avg;
    return [
      !!c1 && c2 === c0,
      `[sim] the bucket fills an empty area (${c0} → ${c1}) and Undo takes it back (${c2})`,
      "fill",
    ];
  });

  await step(async () => {
    await tapTool("Paint Bucket");
    const enclosed = page.locator('button[title^="Fill every area"]');
    // A closed square to enclose.
    await tapTool("Brush (B)");
    const sq = [at(0.7, 0.2), at(0.85, 0.2), at(0.85, 0.35), at(0.7, 0.35)];
    await pen(
      (t) => {
        const k = Math.min(3.999, t * 4);
        const i = Math.floor(k);
        const a = sq[i];
        const b = sq[(i + 1) % 4];
        return { x: a.x + (b.x - a.x) * (k - i), y: a.y + (b.y - a.y) * (k - i) };
      },
      { n: 60, p: () => 0.8 },
    );
    await page.waitForTimeout(300);
    await tapTool("Paint Bucket");
    const inside = rect(0.76, 0.26, 0.03, 0.03);
    const c0 = (await pixels(inside)).avg;
    await enclosed.tap();
    const c1 = await until(async () => {
      const c = (await pixels(inside)).avg;
      return c !== c0 && c;
    }, 8000);
    const outside = (await pixels(rect(0.9, 0.6, 0.03, 0.03))).avg;
    await tapTool("Brush (B)");
    return [
      !!c1 && /#ffffff/i.test(outside),
      `Fill enclosed fills inside a closed outline (${c0} → ${c1}) and not outside (${outside})`,
      "fill-enclosed",
    ];
  });

  // ------------------------------------------------------------------- selections and transforms
  const selRect = rect(0.04, bandY(2) - 0.06, 0.6, 0.12);
  const marquee = () =>
    pen(
      line({ x: selRect.x, y: selRect.y }, { x: selRect.x + selRect.w, y: selRect.y + selRect.h }),
      { n: 10 },
    );
  await step(async () => {
    await tapTool("Rect Select");
    await marquee();
    await page.waitForTimeout(250);
    const s = await status();
    const ink0 = (await pixels(selRect)).dark;
    await page.locator('button[title="Delete selection (Del)"]').tap();
    await page.waitForTimeout(300);
    const ink1 = (await pixels(selRect)).dark;
    await page.locator('button[title^="Undo"]').first().tap();
    await page.waitForTimeout(300);
    const ink2 = (await pixels(selRect)).dark;
    return [
      s.includes("Selection") && ink0 > 30 && ink1 < 5 && ink2 === ink0,
      `[sim] a pen drag with Rect Select makes a selection; Delete clears it (dark px ${ink0} → ${ink1}), Undo restores (${ink2})`,
      "select-delete",
    ];
  });

  await step(async () => {
    // Still selected after the undo? Make sure.
    await marquee();
    await page.waitForTimeout(250);
    // Where the pasted copy will be dragged to: right of the selection, so new ink there.
    const dest = { x: selRect.x + selRect.w, y: selRect.y, w: 60, h: selRect.h + 30 };
    const ink0 = (await pixels(dest)).dark;
    await page.locator('button[title="Copy (Ctrl+C)"]').tap();
    await page.locator('button[title^="Paste"]').last().tap();
    const floating = await until(
      async () => (await page.locator('button[title="Apply (Enter)"]').count()) > 0,
      4000,
    );
    const s = await status();
    await shot(`${String(n).padStart(2, "0")}-pasted`);
    // Drag the float off to the right, then apply.
    const c = { x: selRect.x + selRect.w / 2, y: selRect.y + selRect.h / 2 };
    await pen(line(c, { x: c.x + 60, y: c.y + 30 }), { n: 10 });
    await page.waitForTimeout(200);
    await page.locator('button[title="Apply (Enter)"]').tap();
    await page.waitForTimeout(300);
    const applied = (await page.locator('button[title="Apply (Enter)"]').count()) === 0;
    const ink1 = (await pixels(dest)).dark;
    await undo();
    await page.waitForTimeout(300);
    const ink2 = (await pixels(dest)).dark;
    // WebKit refuses `navigator.clipboard.read()` here, so Paste falls back to the internal copy
    // and says so in the status bar for 10 s; wait it out, as the next steps read the status.
    const fallback = /Pasted the last copy/.test(s);
    await until(async () => !/Pasted the last copy/.test(await status()), 12000);
    return [
      floating && applied && ink1 > ink0 + 30 && ink2 === ink0,
      `[sim] Copy, then Paste floats the copy (${fallback ? "the internal copy: WebKit refuses the clipboard read" : `"${s.split("\n")[0]}"`}); dragged and applied it lands (dark px ${ink0} → ${ink1}), one Undo takes it away (${ink2})`,
      "copy-paste",
    ];
  });

  await step(async () => {
    // Flip the whole layer: the strokes on the left half land on the right.
    const right = rect(0.62, 0, 0.36, 1);
    const ink0 = (await pixels(right)).dark;
    await page.locator('button[title="Select all"]').tap();
    await page.waitForTimeout(200);
    await page.locator('button[title^="Free transform"]').first().tap();
    await page.waitForTimeout(250);
    const s1 = await context();
    await page.locator('button[title^="Flip horizontal"]').tap();
    await page.waitForTimeout(250);
    await shot(`${String(n).padStart(2, "0")}-flipped`);
    await page.locator('button[title="Apply (Enter)"]').tap();
    await page.waitForTimeout(300);
    const ink1 = (await pixels(right)).dark;
    await undo();
    await page.waitForTimeout(300);
    const ink2 = (await pixels(right)).dark;
    await page.locator('button[title="Select all"]').tap();
    await page.locator('button[title^="Distort"]').tap();
    await page.waitForTimeout(250);
    const s2 = await context();
    await page.locator('button[title="Cancel (Esc)"]').tap();
    await page.waitForTimeout(200);
    await page.locator('button[title="Select all"]').tap();
    await page.locator('button[title^="Mesh warp"]').tap();
    await page.waitForTimeout(250);
    const s3 = await context();
    await page.locator('button[title^="More mesh points"]').tap();
    await page.waitForTimeout(200);
    const s4 = await context();
    await page.locator('button[title="Cancel (Esc)"]').tap();
    await page.waitForTimeout(200);
    const ok =
      /Free transform/.test(s1) &&
      Math.abs(ink1 - ink0) > 1000 &&
      ink2 === ink0 &&
      /4-corner distort/.test(s2) &&
      /Mesh warp 3×3/.test(s3) &&
      /Mesh warp 4×4/.test(s4);
    const label = (t) => t.split(" ·")[0].trim();
    return [
      ok,
      `Select all + Free transform + Flip horizontal + Apply moves the strokes (dark px on the right ${ink0} → ${ink1}, Undo ${ink2}); "${label(s2)}", "${label(s3)}" → "${label(s4)}", Cancel`,
      "transform",
    ];
  });

  await step(async () => {
    await tapTool("Lasso Select");
    await pen(
      (t) => {
        const a = t * Math.PI * 2;
        const c = at(0.35, 0.5);
        return { x: c.x + 80 * Math.cos(a), y: c.y + 60 * Math.sin(a) };
      },
      { n: 30 },
    );
    await page.waitForTimeout(250);
    const s = await context();
    const deselect = page.locator('button[title="Deselect (Esc)"]');
    const had = (await deselect.count()) > 0;
    if (had) await deselect.tap();
    await page.waitForTimeout(200);
    const s2 = await context();
    return [
      s.includes("Selection") && had && !s2.includes("Selection ·"),
      "[sim] a pen loop with the Lasso makes a selection; Deselect clears it",
      "lasso",
    ];
  });

  await step(async () => {
    const b = band(bandY(1));
    const ink0 = (await pixels(b)).dark;
    await tapTool("Outline");
    const apply = page.locator('button[aria-label="Apply outline"]');
    const live = await until(
      async () => /Enter/.test((await apply.getAttribute("title")) ?? ""),
      4000,
    );
    await shot(`${String(n).padStart(2, "0")}-outline-preview`);
    await apply.tap();
    await page.waitForTimeout(300);
    const back = await pressed("Lasso Select");
    const ink1 = (await pixels(b)).dark;
    await undo();
    await page.waitForTimeout(300);
    const ink2 = (await pixels(b)).dark;
    await redo();
    await page.waitForTimeout(300);
    const ink3 = (await pixels(b)).dark;
    await tapTool("Brush (B)");
    return [
      !!live && back && ink1 < ink0 * 0.9 && ink2 === ink0 && ink3 === ink1,
      `picking Outline previews at once; Apply hollows the strokes (dark px ${ink0} → ${ink1}) and hands back the previous tool; Undo (${ink2}) and Redo (${ink3})`,
      "outline",
    ];
  });

  // ------------------------------------------------------------------------------------ layers
  await step(async () => {
    const r0 = await rowCount();
    await page.locator('button[title="Add layer"]').tap();
    await page.waitForTimeout(250);
    const r1 = await rowCount();
    const name = (await activeRow().innerText()).trim();
    // Rename: a double-tap on the name.
    const nameSpan = activeRow().locator("span.text-ellipsis").first();
    const box = await nameSpan.boundingBox();
    const c = { x: box.x + Math.min(20, box.width / 2), y: box.y + box.height / 2 };
    await tap(c);
    await page.waitForTimeout(80);
    await tap(c);
    const input = page.locator("input.layer-rename-input");
    const editing = await until(async () => (await input.count()) > 0, 2000);
    if (editing) {
      await input.fill("Inks");
      await input.press("Enter");
    }
    await page.waitForTimeout(250);
    const renamed = (await activeRow().innerText()).includes("Inks");
    return [
      r1 === r0 + 1 && editing && renamed,
      `Add layer adds "${name}" above, selected; a double-tap on its name renames it to Inks`,
      "add-rename",
    ];
  });

  await step(async () => {
    const blend = page.locator('select[title^="Blend mode"]');
    await blend.selectOption({ label: "Multiply" });
    await page.waitForTimeout(200);
    const title = await blend.getAttribute("title");
    const u = await undoTitle();
    await page.locator('button[title^="Undo"]').first().tap();
    await page.waitForTimeout(200);
    const undone = /Normal/.test((await blend.getAttribute("title")) ?? "");
    return [
      /Multiply/.test(title) && !/nothing/.test(u) && undone,
      `the layer strip sets Multiply ("${title}"), and Undo puts Normal back`,
      "blend",
    ];
  });

  await step(async () => {
    const a = activeRow();
    await a.locator('button[title^="Visible"]').tap();
    await page.waitForTimeout(200);
    await pen(wave(0.5));
    await page.waitForTimeout(150);
    const hidden = await status();
    await a.locator('button[title^="Hidden"]').tap();
    await page.waitForTimeout(700);
    await a.locator('button[title^="Unlocked"]').tap();
    await page.waitForTimeout(200);
    await pen(wave(0.5));
    await page.waitForTimeout(150);
    const locked = await status();
    await a.locator('button[title^="Locked"]').tap();
    await a.locator('button[title^="Alpha lock off"]').tap();
    await page.waitForTimeout(150);
    const alpha = (await a.locator('button[title^="Alpha lock on"]').count()) === 1;
    await a.locator('button[title^="Alpha lock on"]').tap();
    return [
      /Layer is hidden/.test(hidden) && /Layer is locked/.test(locked) && alpha,
      `a pen stroke on a hidden or locked layer is refused with a reason ("${hidden.split("\n")[0]}", "${locked.split("\n")[0]}"); alpha lock toggles`,
      "hide-lock",
    ];
  });

  await step(async () => {
    const r0 = await rowCount();
    await pen(wave(0.55), { p: () => 0.9 });
    await page.waitForTimeout(250);
    await page.locator('button[title="Duplicate layer or group"]').tap();
    await page.waitForTimeout(250);
    const r1 = await rowCount();
    await page.locator('button[title^="Group the selected"]').tap();
    await page.waitForTimeout(250);
    const groups = await page.locator('[title^="Layer group"]').count();
    await shot(`${String(n).padStart(2, "0")}-grouped`);
    // Undo the group, then merge the copy down onto Inks.
    await page.locator('button[title^="Undo"]').first().tap();
    await page.waitForTimeout(250);
    await page.locator('button[title="Merge down onto the layer below"]').tap();
    await page.waitForTimeout(250);
    const r2 = await rowCount();
    await page.locator('button[title="Delete layer or group"]').tap();
    await page.waitForTimeout(250);
    const r3 = await rowCount();
    await page.locator('button[title^="Undo"]').first().tap();
    await page.waitForTimeout(250);
    const r4 = await rowCount();
    return [
      r1 === r0 + 1 && groups === 1 && r2 === r0 && r3 === r0 - 1 && r4 === r0,
      `Duplicate (${r0} → ${r1} rows), Group (a group row), Merge down (${r2}), Delete (${r3}), Undo (${r4})`,
      "layer-ops",
    ];
  });

  await step(async () => {
    // A finger drags the bottom row by its grip to the top of the list. Mid-drag: the floating
    // copy, the rows slid down to open the gap, the dragged row dimmed. Then Undo puts it back.
    const names = () => page.$$eval("[data-row-id]", (els) => els.map((e) => e.textContent.trim()));
    const n0 = await names();
    const bottom = n0.at(-1);
    const grip = page
      .locator("[data-row-id]", { hasText: bottom })
      .first()
      .locator('[title^="Drag to move"]');
    const g = await grip.boundingBox();
    const top = await page.locator("[data-row-id]").first().boundingBox();
    const from = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
    const to = { x: from.x, y: top.y + 3 };
    const steps = pathSteps("touch", 80, line(from, to), { n: 12, wait: 16 });
    const lift = steps.pop();
    await gesture(steps);
    await page.waitForTimeout(250);
    const mid = await page.evaluate(() => ({
      ghost: !!document.querySelector("[data-drag-ghost]"),
      slid: [...document.querySelectorAll("[data-row-id]")].filter((e) => e.style.transform).length,
      dimmed: document.querySelectorAll("[data-row-id].opacity-40").length,
    }));
    await shot(`${String(n).padStart(2, "0")}-row-drag-mid`);
    await gesture([lift]);
    await page.waitForTimeout(300);
    const n1 = await names();
    await undo();
    await page.waitForTimeout(300);
    const n2 = await names();
    return [
      mid.ghost &&
        mid.slid === n0.length &&
        mid.dimmed === 1 &&
        n1[0] === bottom &&
        n2.join("|") === n0.join("|"),
      `[sim] a finger drags the bottom row (${bottom}) to the top by its grip: mid-drag a floating copy (${mid.ghost}), ${mid.slid} rows slid to open the gap, ${mid.dimmed} dimmed; dropped (${n1.join(", ")}); Undo restores`,
      "row-drag",
    ];
  });

  await step(async () => {
    const before = await page.locator(".layer-item.ui-selected").innerText();
    await page.locator(".layer-item", { hasText: "Layer 1" }).first().tap();
    await page.waitForTimeout(200);
    const after = await page.locator(".layer-item.ui-selected").innerText();
    return [
      after.includes("Layer 1") && !before.includes("Layer 1"),
      `a tap on a layer row selects it (${before.trim()} → ${after.trim()})`,
      "select-row",
    ];
  });

  // -------------------------------------------------------------------------------- references
  await step(async () => {
    const r0 = await rowCount();
    await page.locator('button[title^="Add text"]').tap();
    const dialog = page.getByRole("dialog", { name: "Add text" });
    await dialog.waitFor({ timeout: 3000 });
    await dialog.locator("textarea").fill("Hello");
    await page.waitForTimeout(300);
    await shot(`${String(n).padStart(2, "0")}-text-dialog`);
    await dialog.getByRole("button", { name: "Add", exact: true }).tap();
    await until(async () => (await rowCount()) === r0 + 1, 4000);
    await page.waitForTimeout(300);
    const added = (await activeRow().innerText()).includes("Hello");
    const onSelect = await pressed("Rect Select");
    const s = await status();
    await page.locator(".layer-item", { hasText: "Layer 1" }).first().tap();
    await page.waitForTimeout(300);
    const handedBack = await pressed("Brush (B)");
    return [
      added && onSelect && /Reference/.test(s) && handedBack,
      "the T button adds a text reference (its handles and Rect Select come up), and picking a drawing layer hands back the brush",
      "text",
    ];
  });

  await step(async () => {
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 80;
      const g = c.getContext("2d");
      g.fillStyle = "#e33";
      g.fillRect(0, 0, 120, 80);
      return c.toDataURL("image/png").split(",")[1];
    });
    const r0 = await rowCount();
    const chooser = page.waitForEvent("filechooser");
    await menu("File", /^Import image…/);
    await (
      await chooser
    ).setFiles({ name: "dot.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    const added = await until(async () => (await rowCount()) === r0 + 1, 5000);
    await page.waitForTimeout(300);
    const isRef = (await activeRow().innerText()).includes("ref dot");
    const refs0 = await page.locator('.layer-item [title^="Reference —"]').count();
    // Move it with the pen: the handles take any drag.
    await refreshPage();
    // The image sits centred; a spot just right of it turns red when it is dragged over.
    const c = at(0.5, 0.5);
    const spot = { x: c.x + 40, y: c.y + 10, w: 30, h: 16 };
    const c0 = (await pixels(spot)).avg;
    await pen(line(c, { x: c.x + 50, y: c.y + 20 }), { n: 10 });
    await page.waitForTimeout(300);
    const c1 = (await pixels(spot)).avg;
    await undo();
    await page.waitForTimeout(300);
    const c2 = (await pixels(spot)).avg;
    await redo();
    await page.waitForTimeout(300);
    const moved = c1 !== c0 && c2 === c0;
    await page.locator('button[title^="Bake the reference"]').tap();
    await page.waitForTimeout(300);
    const refs1 = await page.locator('.layer-item [title^="Reference —"]').count();
    return [
      added && isRef && moved && refs0 === 1 && refs1 === 0,
      `File ▸ Import image… adds a reference layer, a pen drag moves it (${c0} → ${c1}, Undo ${c2}), Bake makes it plain pixels`,
      "import-ref",
    ];
  });

  // ------------------------------------------------------------------------- dialogs and files
  await step(async () => {
    await menu("Edit", /^Settings/);
    const shown = await page.getByRole("heading", { name: "Settings" }).isVisible();
    await page.getByRole("button", { name: "Done" }).tap();
    await page.waitForTimeout(200);
    const gone = !(await page
      .getByRole("heading", { name: "Settings" })
      .isVisible()
      .catch(() => false));
    return [shown && gone, "Edit ▸ Settings… opens the settings, Done closes them", "settings"];
  });

  await step(async () => {
    await page
      .getByRole("button", { name: /^Document/ })
      .first()
      .tap();
    const name = page.locator('label[title^="Project name"] input').first();
    await name.fill("Inks");
    await name.press("Enter");
    await name.dispatchEvent("change");
    await tap(offPage);
    await page.waitForTimeout(300);
    const title = await page.title();
    return [
      title.includes("Inks"),
      `Document ▸ Name renames the project (tab title "${title}")`,
      "project-name",
    ];
  });

  let savedPsd = null;
  let savedRows = 0;
  await step(async () => {
    savedRows = await rowCount();
    await menu("File", /^Save to Files/);
    const ready = page.getByRole("button", { name: "Save to Files…" });
    const f = await until(async () => {
      if ((await ready.count()) > 0) await ready.tap();
      return (await shared()).find((x) => x.name === "Inks.psd");
    }, 10000);
    savedPsd = f;
    const magic = f ? Buffer.from(f.b64, "base64").subarray(0, 4).toString("latin1") : "";
    return [
      !!f && magic === "8BPS",
      `File ▸ Save to Files… shares Inks.psd (${f?.size ?? 0} bytes, "${magic}")`,
      "save-to-files",
    ];
  });

  await step(async () => {
    await menu("File", /^Export PNG/);
    const ready = page.getByRole("button", { name: "Save to Files…" });
    const png = await until(async () => {
      if ((await ready.count()) > 0) await ready.tap();
      return (await shared()).find((x) => x.name === "Inks.png");
    }, 10000);
    await menu("File", /^Export PSD/);
    const psd = await until(async () => {
      if ((await ready.count()) > 0) await ready.tap();
      return (await shared()).find((x) => x.name === "Inks-export.psd");
    }, 10000);
    return [
      !!png && png.type === "image/png" && png.size > 1000 && !!psd,
      `File ▸ Export PNG and Export PSD for Spine reach the share sheet (Inks.png ${png?.size ?? 0} bytes, Inks-export.psd ${psd?.size ?? 0})`,
      "exports",
    ];
  });

  await step(async () => {
    await menu("File", /^New/);
    await page.getByRole("button", { name: "Create" }).tap();
    await page.waitForTimeout(500);
    const r = await rowCount();
    const clean = !(await canUndo());
    return [
      r === 2 && clean,
      `File ▸ New… → Create: Background + Layer 1 (${r} rows), no undo history`,
      "new",
    ];
  });

  await step(async () => {
    if (!savedPsd) return [false, "File ▸ Open… — skipped, no saved PSD", "open"];
    const chooser = page.waitForEvent("filechooser");
    await menu("File", /^Open/);
    await (
      await chooser
    ).setFiles({
      name: "Inks.psd",
      mimeType: "image/vnd.adobe.photoshop",
      buffer: Buffer.from(savedPsd.b64, "base64"),
    });
    const back = await until(async () => (await rowCount()) === savedRows, 8000);
    await page.waitForTimeout(400);
    await refreshPage();
    const ink = (await pixels(band(bandY(3)))).dark;
    return [
      back && ink > 30,
      `File ▸ Open… brings the saved PSD back (${await rowCount()} of ${savedRows} rows, its strokes drawn)`,
      "open",
    ];
  });

  await step(async () => {
    const before = await page
      .getByRole("button", { name: /^Document/ })
      .first()
      .tap()
      .then(() => page.getByRole("menuitem", { name: /^Resize canvas/ }).innerText());
    await page.getByRole("menuitem", { name: /^Resize canvas/ }).tap();
    const w = page.locator("label", { hasText: "Width" }).locator("input").last();
    await w.fill("800");
    await page.getByRole("button", { name: "Resize", exact: true }).tap();
    await page.waitForTimeout(500);
    await page
      .getByRole("button", { name: /^Document/ })
      .first()
      .tap();
    const after = await page.getByRole("menuitem", { name: /^Resize canvas/ }).innerText();
    await tap(offPage);
    await page.waitForTimeout(200);
    await fit();
    await refreshPage();
    return [
      /800\s*×/.test(after),
      `Document ▸ Resize canvas… (${before.replace(/\s+/g, " ").trim()} → ${after.replace(/\s+/g, " ").trim()})`,
      "resize",
    ];
  });

  await step(async () => {
    const r0 = await rowCount();
    await pen(wave(0.5));
    await page.waitForTimeout(5500); // the 3 s debounce + 1.5 s after the last lift
    await page.reload();
    await page.waitForSelector("text=Background", { timeout: 20000 });
    const back = await until(async () => (await rowCount()) === r0, 5000);
    await page.waitForTimeout(500);
    await menu("File", /^Restore autosave/);
    const listed = await until(
      async () => (await page.getByRole("button", { name: "Restore", exact: true }).count()) > 0,
      3000,
    );
    await shot(`${String(n).padStart(2, "0")}-restore-dialog`);
    await page.getByRole("button", { name: "Close", exact: true }).tap();
    return [
      back && listed && (await page.title()).includes("Inks"),
      `a reload restores the autosaved document (${await rowCount()} of ${r0} rows, still "Inks"); File ▸ Restore autosave… lists copies`,
      "autosave",
    ];
  });
}

const browser = await webkit.launch();
try {
  const errors = [];
  const watch = (page, tag = "") => {
    page.on("pageerror", (e) => errors.push(`${tag}${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${tag}${m.text()}`));
  };

  // ---------------------------------------------------------------- landscape, the main pass
  const context = await browser.newContext({ ...devices["iPad Pro 11 landscape"] });
  await context.addInitScript(pageSetup);
  const page = await context.newPage();
  watch(page);
  await main(page);
  await context.close();

  // ---------------------------------------------------------------------------------- portrait
  // iPad portrait (834 px): row 1 fits, the layer panel starts below the tool-options row, the
  // File menu opens inside the window, and the pen still draws.
  const portrait = await browser.newContext({ ...devices["iPad Pro 11"] });
  await portrait.addInitScript(pageSetup);
  const pp = await portrait.newPage();
  watch(pp, "portrait: ");
  try {
    await pp.goto(url);
    await pp.waitForSelector("text=Background", { timeout: 20000 });
    await pp.waitForTimeout(600);
    const lay = await pp.evaluate(() => {
      const r1 = [...document.querySelectorAll("div")].find(
        (e) => getComputedStyle(e).gridRowStart === "row1",
      );
      const r2 = [...document.querySelectorAll("div")].find(
        (e) => getComputedStyle(e).gridRowStart === "row2",
      );
      const panel = [...document.querySelectorAll("div")].find(
        (e) => getComputedStyle(e).gridRowStart === "panel",
      );
      return {
        fits: r1.scrollWidth <= r1.clientWidth,
        below: panel.getBoundingClientRect().top >= r2.getBoundingClientRect().bottom - 1,
      };
    });
    await pp.getByRole("button", { name: /^File/ }).first().tap();
    await pp.waitForTimeout(300);
    const mb = await pp.locator('[role="menu"]').boundingBox();
    const vw = pp.viewportSize().width;
    const inside = !!mb && mb.x >= 0 && mb.x + mb.width <= vw;
    await pp.keyboard.press("Escape");
    const pb = await pp.locator(".canvas-checkerboard + canvas").boundingBox();
    await pp.evaluate(
      (s) => window.__gesture(s),
      pathSteps(
        "pen",
        2,
        line(
          { x: pb.x + pb.width * 0.2, y: pb.y + pb.height * 0.5 },
          { x: pb.x + pb.width * 0.8, y: pb.y + pb.height * 0.55 },
        ),
      ),
    );
    await pp.waitForTimeout(300);
    const ink = (
      await pp.evaluate((r) => window.__pixels(r), {
        x: pb.x,
        y: pb.y + pb.height * 0.4,
        w: pb.width,
        h: pb.height * 0.2,
      })
    ).dark;
    await pp.screenshot({ path: `${OUT}/90-portrait.png` });
    check(
      lay.fits && lay.below && inside && ink > 30,
      `portrait: row 1 fits (${lay.fits}), the layer panel sits below the options row (${lay.below}), the File menu is on screen (${inside}), a pen stroke draws (${ink} dark px)`,
    );

    // The tool-options row stays one line (40 px) for every tool: a wrapped row is taller, and
    // switching tools would move the canvas. The brush row once wrapped at 834 px.
    const heights = [];
    for (const t of [
      "Brush (B)",
      "Eraser (E)",
      "Rect Select",
      "Paint Bucket",
      "Eyedropper",
      "Outline",
    ]) {
      await pp.locator(`button[title^="${t}"]`).first().tap();
      await pp.waitForTimeout(200);
      const h = await pp.evaluate(
        () =>
          [...document.querySelectorAll("div")]
            .find((e) => getComputedStyle(e).gridRowStart === "row2")
            .getBoundingClientRect().height,
      );
      heights.push(`${t.split(" (")[0]} ${Math.round(h)}`);
      if (t === "Brush (B)") await pp.screenshot({ path: `${OUT}/91-portrait-brush-row.png` });
    }
    check(
      heights.every((h) => / 40$/.test(h)),
      `portrait: the tool-options row is one line for every tool (${heights.join(", ")} px)`,
    );
  } catch (e) {
    check(false, `portrait threw: ${e.message.split("\n")[0]}`);
  }
  await portrait.close();

  check(
    errors.length === 0,
    `no page errors anywhere${errors.length ? `: ${[...new Set(errors)].join(" | ")}` : ""}`,
  );
} finally {
  await browser.close();
  await server?.close();
}
console.log(
  failures.length ? `\n${failures.length} failed` : `\nall passed — screenshots in ${OUT}/`,
);
process.exit(failures.length ? 1 : 0);
