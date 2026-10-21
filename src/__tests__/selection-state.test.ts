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

function lasso(pts: { x: number; y: number }[]) {
  sel.mode = "lasso";
  sel.startCreate(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) sel.updateCreate(p.x, p.y);
  sel.endCreate();
}

describe("lifting a lasso", () => {
  for (const dpr of [1, 2]) {
    it(`at dpr ${dpr}, the copy's clip lands where the hole is cut`, () => {
      const pts = [];
      for (let k = 0; k < 32; k++) {
        const t = (k / 32) * 2 * Math.PI;
        pts.push({ x: 100.33 + 30.17 * Math.cos(t), y: 80.71 + 30.29 * Math.sin(t) });
      }
      lasso(pts);
      const layer = layerCtx(dpr);
      made = [];
      sel.liftPixels(layer.ctx, dpr);
      const copy = made[0].rec;
      const [sx, sy] = copy.draws[0].args; // the copy's (0, 0) is this layer pixel
      const clip = copy.clips[0];
      const hole = layer.rec.clips[0];
      expect(clip.length).toBe(hole.length);
      clip.forEach((p, i) => {
        expect(p.x + sx).toBeCloseTo(hole[i].x, 9);
        expect(p.y + sy).toBeCloseTo(hole[i].y, 9);
      });
    });
  }

  it("copies every pixel the outline touches", () => {
    lasso([
      { x: 10.6, y: 20.2 },
      { x: 60.2, y: 20.2 },
      { x: 60.2, y: 70.7 },
      { x: 10.6, y: 70.7 },
    ]);
    const layer = layerCtx(1);
    made = [];
    sel.liftPixels(layer.ctx, 1);
    const [sx, sy, sw, sh] = made[0].rec.draws[0].args;
    expect([sx, sy, sw, sh]).toEqual([10, 20, 51, 51]);
    expect(sel.rect).toEqual({ x: 10, y: 20, w: 51, h: 51 });
  });
});

describe("a lasso marquee keeps its shape", () => {
  it("when the mode changes after it is drawn (Lasso → Select)", () => {
    lasso([
      { x: 10, y: 10 },
      { x: 100, y: 10 },
      { x: 10, y: 100 },
    ]);
    sel.mode = "rect";
    expect(sel.hitTest(90, 90)).toBe(null); // in the box, outside the triangle
    expect(sel.hitTest(20, 20)).toBe("move");
    const c = fakeCanvas();
    sel.applyClip(c.ctx);
    expect(c.rec.clips[0].length).toBe(3);
    overlay.rec.calls.length = 0;
    sel.drawOverlay();
    const fns = overlay.rec.calls.map((k) => k.fn);
    expect(fns).toContain("lineTo");
    expect(fns).not.toContain("rect");
  });
});

describe("moving a float", () => {
  for (const dpr of [1, 2]) {
    it(`at dpr ${dpr}, lands on whole layer pixels`, () => {
      sel.screenScale = 0.75;
      sel.pixelRatio = () => dpr;
      sel.mode = "rect";
      sel.startCreate(10.37, 10.81);
      sel.updateCreate(50.2, 50.6);
      sel.endCreate();
      const layer = layerCtx(dpr);
      const lifted = sel.liftPixels(layer.ctx, dpr)!;
      sel.beginTransform(lifted);
      sel.startDrag("move", 30, 30);
      sel.updateDrag(30 + 10 / 0.75, 30 + 7 / 0.75);
      sel.endDrag();
      layer.rec.draws.length = 0;
      sel.renderFloatingTo(layer.ctx); // what Apply does
      const d = layer.rec.draws[0];
      const o = ap(d.ctm, d.args[0], d.args[1]);
      expect(o.x).toBeCloseTo(Math.round(o.x), 9);
      expect(o.y).toBeCloseTo(Math.round(o.y), 9);
      expect(d.ctm.a * d.args[2]).toBeCloseTo(lifted.width, 9);
    });
  }
});

describe("a small float", () => {
  for (const [w, h] of [
    [20, 20],
    [40, 20],
    [100, 10],
  ]) {
    it(`${w}×${h} screen px moves from inside and scales from just outside`, () => {
      sel.screenScale = 1;
      sel.pasteFloat(fakeCanvas(w, h).canvas, { x: 100, y: 100, w, h });
      expect(sel.hitTest(100 + w / 2, 100 + h / 2)).toBe("move");
      expect(sel.hitTest(100 + w + 6, 100 + h + 6)).toBe("br");
    });
  }

  it("a large float still scales from just inside its corner", () => {
    sel.screenScale = 1;
    sel.pasteFloat(fakeCanvas(100, 100).canvas, { x: 100, y: 100, w: 100, h: 100 });
    expect(sel.hitTest(195, 195)).toBe("br");
    expect(sel.hitTest(150, 150)).toBe("move");
  });
});

describe("a tap makes no marquee", () => {
  const drag = (zoom: number, w: number, h: number) => {
    sel.screenScale = zoom;
    sel.mode = "rect";
    sel.startCreate(100, 100);
    sel.updateCreate(100 + w, 100 + h);
    sel.endCreate();
    return sel.state;
  };
  it("zoomed out, a tap's jitter of a screen px or two", () => {
    expect(drag(0.25, 4, 4)).toBe("idle");
    expect(drag(0.25, 8, 8)).toBe("idle");
  });
  it("zoomed in, a thin deliberate drag is kept", () => {
    expect(drag(8, 2, 40)).toBe("selected");
  });
  it("at 100%, 3 px a side is a marquee", () => {
    expect(drag(1, 2, 40)).toBe("idle");
    expect(drag(1, 3, 3)).toBe("selected");
  });
});

describe("the Move box", () => {
  it("is drawn again when the selection is cleared", () => {
    sel.selectRect({ x: 10, y: 10, w: 40, h: 40 });
    sel.setMoveBox({ x: 100, y: 100, w: 50, h: 50 });
    overlay.rec.calls.length = 0;
    sel.cancel();
    const rects = overlay.rec.calls.filter((k) => k.fn === "rect").map((k) => k.args);
    expect(rects).toContainEqual([100, 100, 50, 50]);
  });
});
