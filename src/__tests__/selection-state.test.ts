import { describe, it, expect, beforeEach } from "vitest";
import { Selection } from "../selection";

// The Selection class on stub canvases (node has no canvas): contexts keep their transform and
// record clips (with their points, in device px) and drawImage calls, enough to check where things
// land. Based on the 2026-10-17 review's repro tests.
type M = { a: number; b: number; c: number; d: number; e: number; f: number };
const I: M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const mul = (p: M, q: M): M => ({
  a: p.a * q.a + p.c * q.b,
  b: p.b * q.a + p.d * q.b,
  c: p.a * q.c + p.c * q.d,
  d: p.b * q.c + p.d * q.d,
  e: p.a * q.e + p.c * q.f + p.e,
  f: p.b * q.e + p.d * q.f + p.f,
});
const ap = (m: M, x: number, y: number) => ({
  x: m.a * x + m.c * y + m.e,
  y: m.b * x + m.d * y + m.f,
});

class FakePath {
  pts: { x: number; y: number }[] = [];
  moveTo(x: number, y: number) {
    this.pts.push({ x, y });
  }
  lineTo(x: number, y: number) {
    this.pts.push({ x, y });
  }
  closePath() {}
}

function inPoly(pts: { x: number; y: number }[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

type Rec = {
  calls: { fn: string; args: unknown[] }[];
  clips: { x: number; y: number }[][];
  draws: { args: number[]; ctm: M }[];
};
function fakeCanvas(w = 400, h = 300) {
  const rec: Rec = { calls: [], clips: [], draws: [] };
  let ctm: M = { ...I };
  const stack: M[] = [];
  const canvas: Record<string, unknown> = { width: w, height: h };
  const t: Record<string, unknown> = {
    canvas,
    save: () => stack.push({ ...ctm }),
    restore: () => {
      ctm = stack.pop() ?? { ...I };
    },
    scale: (sx: number, sy: number) => {
      ctm = mul(ctm, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
    },
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      ctm = mul(ctm, { a, b, c, d, e, f });
    },
    setTransform: (...args: unknown[]) => {
      if (args.length === 1) ctm = { ...(args[0] as M) };
      else {
        const [a, b, c, d, e, f] = args as number[];
        ctm = { a, b, c, d, e, f };
      }
    },
    resetTransform: () => {
      ctm = { ...I };
    },
    getTransform: () => ({ ...ctm }),
    clip: (p?: FakePath) => {
      rec.clips.push(p ? p.pts.map((q) => ap(ctm, q.x, q.y)) : []);
    },
    drawImage: (...args: unknown[]) =>
      rec.draws.push({ args: args.slice(1) as number[], ctm: { ...ctm } }),
    isPointInPath: (p: FakePath, x: number, y: number) => inPoly(p.pts, x, y),
  };
  const ctx = new Proxy(t, {
    get(target, p: string) {
      if (p in target) return target[p];
      return (...args: unknown[]) => rec.calls.push({ fn: p, args });
    },
    set(target, p: string, v) {
      target[p] = v;
      return true;
    },
  });
  canvas.getContext = () => ctx;
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    ctx: ctx as unknown as CanvasRenderingContext2D,
    rec,
  };
}

const g = globalThis as Record<string, unknown>;
g.requestAnimationFrame = () => 1;
g.cancelAnimationFrame = () => {};
g.DOMMatrix = class {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
};
g.Path2D = FakePath;
let made: ReturnType<typeof fakeCanvas>[] = [];
g.document = {
  createElement: () => {
    const c = fakeCanvas();
    made.push(c);
    return c.canvas;
  },
};

let overlay: ReturnType<typeof fakeCanvas>;
let sel: Selection;
beforeEach(() => {
  made = [];
  overlay = fakeCanvas(800, 600);
  sel = new Selection(overlay.canvas);
  sel.pageSize = { w: 400, h: 300 };
});

/** A layer context as LayerManager makes it: scaled by the pixel ratio. */
function layerCtx(dpr: number) {
  const l = fakeCanvas(400 * dpr, 300 * dpr);
  l.ctx.scale(dpr, dpr);
  return l;
}

describe("changing the warp grid while a drag is held", () => {
  it("a finer mesh ends the held drag instead of rebuilding the old grid", () => {
    sel.pasteFloat(fakeCanvas(100, 100).canvas, { x: 0, y: 0, w: 100, h: 100 });
    sel.beginWarp(2, 2);
    sel.startDrag(sel.hitTest(100, 100), 100, 100);
    sel.densifyWarp(3, 3);
    sel.updateDrag(110, 110);
    sel.endDrag();
    expect(sel.warpRows).toBe(3);
    expect(sel.warpGrid.length).toBe(3);
    expect(sel.warpGrid.every((r) => r.length === 3)).toBe(true);
    expect(() => sel.renderFloatingTo(layerCtx(1).ctx)).not.toThrow();
    expect(() => sel.hitTest(500, 500)).not.toThrow();
  });

  it("Distort during a free-transform move drag keeps its grid", () => {
    sel.pasteFloat(fakeCanvas(100, 100).canvas, { x: 0, y: 0, w: 100, h: 100 });
    sel.startDrag("move", 50, 50);
    sel.beginWarp(2, 2);
    sel.updateDrag(60, 60);
    expect(sel.warpGrid.length).toBe(2);
    expect(sel.warpGrid[1][1]).toEqual({ x: 100, y: 100 });
  });
});
