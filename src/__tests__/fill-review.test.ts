import { describe, it, expect } from "vitest";
import { bucketStrength, fillMask, floodFill, ridgeCoverage, UNDER_LINE_MAX_PX } from "../fill";
import { dilateMask, distanceToMask } from "../mask-ops";

// The 2026-11-13 review's fill fixes.

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A few strokes with soft edges on a transparent w×h layer; `opaque`: hard black lines. */
function art(w: number, h: number, seed: number, opaque = false): Uint8ClampedArray {
  const r = rng(seed);
  const d = new Uint8ClampedArray(w * h * 4);
  for (let k = 3 + Math.floor(r() * 4); k > 0; k--) {
    const x0 = r() * w;
    const y0 = r() * h;
    const dx = r() * w - x0;
    const dy = r() * h - y0;
    const half = 0.5 + r() * 4;
    const strength = 0.3 + r() * 0.7;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
        const dist = Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
        const c = Math.max(0, Math.min(1, half - dist + 0.5));
        const a = opaque ? (c > 0.4 ? 255 : 0) : Math.round(c * strength * (0.7 + 0.3 * r()) * 255);
        const p = (y * w + x) * 4;
        if (a > d[p + 3]) d.set([20, 20, 20, a], p);
      }
    }
  }
  return d;
}

function fakeCtx(w: number, h: number, data: Uint8ClampedArray) {
  return {
    canvas: { width: w, height: h },
    getImageData: () => ({ data: new Uint8ClampedArray(data), width: w, height: h }),
    putImageData: (img: { data: Uint8ClampedArray }) => data.set(img.data),
  } as unknown as CanvasRenderingContext2D;
}
const px = (d: Uint8ClampedArray, w: number, x: number, y: number) => [
  ...d.slice((y * w + x) * 4, (y * w + x) * 4 + 4),
];
const BLUE = { r: 0, g: 0, b: 255, a: 255 };

describe("fillMask: Bridge by distance", () => {
  /** The bridged fill as it was: the walls thickened with `dilateMask`. Only the pixels the
   *  thickening leaves open are compared — the rest of `fillMask` is unchanged. */
  it("thickens the walls exactly as the round dilation did", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const w = 70;
      const h = 50;
      const d = art(w, h, seed, true);
      const walls = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) walls[i] = d[i * 4 + 3] ? 1 : 0;
      const dist = distanceToMask(walls, w, h);
      for (const r of [1, 3, 8]) {
        const thick = dilateMask(walls, w, h, r);
        for (let i = 0; i < w * h; i++) expect(dist[i] <= r ? 1 : 0).toBe(thick[i]);
      }
    }
  });

  it("fills a layer with no walls whole, at any Bridge", () => {
    const d = new Uint8ClampedArray(40 * 30 * 4);
    for (const gap of [0, 8])
      expect(fillMask(d, 40, 30, 7, 7, 32, gap)!.every((v) => v)).toBe(true);
  });
});

describe("fillMask: colour as far as it shows", () => {
  it("isn't walled in by white residue at alpha 2", () => {
    // An empty layer crossed by a column of (255,255,255,2): invisible, and it stopped the flood.
    const w = 20;
    const d = new Uint8ClampedArray(w * 10 * 4);
    for (let y = 0; y < 10; y++) d.set([255, 255, 255, 2], (y * w + 10) * 4);
    const m = fillMask(d, w, 10, 3, 3, 32)!;
    expect(m[3 * w + 10]).toBe(1);
    expect(m[3 * w + 16]).toBe(1);
    // and the strength Soft reads agrees: no line there
    const s = bucketStrength(d, w, 10, { r: 0, g: 0, b: 0, a: 0 }, 32);
    expect(s[3 * w + 10]).toBe(2);
  });

  it("from a tap on the residue itself, floods the empty space round it", () => {
    const w = 20;
    const d = new Uint8ClampedArray(w * 10 * 4);
    d.set([255, 255, 255, 2], (3 * w + 10) * 4);
    expect(fillMask(d, w, 10, 10, 3, 32)![3 * w + 2]).toBe(1);
  });

  it("still tells opaque colours apart, and a line from the paper", () => {
    const w = 20;
    const d = new Uint8ClampedArray(w * 10 * 4);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) d.set([255, 0, 0, 255], (y * w + x) * 4);
      for (let x = 10; x < 14; x++) d.set([200, 0, 0, 255], (y * w + x) * 4);
      d.set([0, 0, 0, 120], (y * w + 16) * 4);
    }
    const red = fillMask(d, w, 10, 3, 3, 32)!;
    expect(red[3 * w + 9]).toBe(1);
    expect(red[3 * w + 10]).toBe(0);
    const paper = fillMask(d, w, 10, 15, 3, 32)!;
    expect(paper[3 * w + 16]).toBe(0);
    expect(paper[3 * w + 18]).toBe(0);
  });
});

describe("floodFill: already this colour", () => {
  const flat = (c: number[]) => {
    const d = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) d.set(c, i * 4);
    return d;
  };
  const HARD = { tolerance: 32, expand: 0, softEdge: 0, gap: 0 };

  it("refuses only the very same colour", () => {
    const d = flat([0, 0, 255, 255]);
    expect(floodFill(fakeCtx(10, 10, d), 3, 3, BLUE, HARD)).toBe(false);
  });

  it("fills #909090 over #808080", () => {
    const d = flat([0x80, 0x80, 0x80, 255]);
    const grey = { r: 0x90, g: 0x90, b: 0x90, a: 255 };
    expect(floodFill(fakeCtx(10, 10, d), 3, 3, grey, HARD)).toBe(true);
    expect(px(d, 10, 3, 3)).toEqual([0x90, 0x90, 0x90, 255]);
  });

  it("fills the same colour at 90% opacity", () => {
    const d = flat([0, 0, 255, 255]);
    expect(floodFill(fakeCtx(10, 10, d), 3, 3, { ...BLUE, a: 230 }, HARD)).toBe(true);
    expect(px(d, 10, 3, 3)).toEqual([0, 0, 255, 230]);
  });
});

describe("floodFill: what lands beyond the region", () => {
  // A red square (x, y 4..11) on a 16×16 transparent layer, with a soft edge: a ring of
  // (255,0,0,24) round it, as a brush's antialiasing leaves.
  const W = 16;
  function softSquare() {
    const d = new Uint8ClampedArray(W * W * 4);
    for (let y = 3; y <= 12; y++)
      for (let x = 3; x <= 12; x++) {
        const inner = x >= 4 && x <= 11 && y >= 4 && y <= 11;
        d.set([255, 0, 0, inner ? 255 : 24], (y * W + x) * 4);
      }
    return d;
  }

  for (const [name, opts] of [
    ["Expand 2", { expand: 2, softEdge: 0 }],
    ["Soft 1", { expand: 0, softEdge: 1 }],
    ["Expand 2 + Soft 1", { expand: 2, softEdge: 1 }],
  ] as const) {
    it(`recolouring a painted area never makes its soft edge more opaque (${name})`, () => {
      const d = softSquare();
      const before = new Uint8ClampedArray(d);
      floodFill(fakeCtx(W, W, d), 8, 8, BLUE, { tolerance: 32, gap: 0, ...opts });
      expect(px(d, W, 8, 8)).toEqual([0, 0, 255, 255]);
      for (let i = 0; i < W * W; i++) expect(d[i * 4 + 3]).toBe(before[i * 4 + 3]);
      // the edge takes the colour the fill behind it gives, at its own alpha
      const edge = px(d, W, 3, 8);
      expect(edge[3]).toBe(24);
      expect(edge[2]).toBeGreaterThan(edge[0]);
    });
  }

  it("Expand 2 gives the edge (24,0,231) at alpha 24", () => {
    const d = softSquare();
    floodFill(fakeCtx(W, W, d), 8, 8, BLUE, { tolerance: 32, gap: 0, expand: 2, softEdge: 0 });
    expect(px(d, W, 3, 8)).toEqual([24, 0, 231, 24]);
  });

  it("from an empty tap the fill still goes BEHIND a see-through line, making it opaque", () => {
    // Paper, then a 4-px line at alpha 128 with paper beyond it.
    const d = new Uint8ClampedArray(W * W * 4);
    for (let y = 0; y < W; y++) for (let x = 8; x < 12; x++) d.set([0, 0, 0, 128], (y * W + x) * 4);
    floodFill(fakeCtx(W, W, d), 2, 8, BLUE, { tolerance: 32, gap: 0, expand: 2, softEdge: 0 });
    expect(px(d, W, 2, 8)).toEqual([0, 0, 255, 255]);
    // black at 128 over opaque blue
    expect(px(d, W, 8, 8)).toEqual([0, 0, 127, 255]);
    expect(px(d, W, 9, 8)).toEqual([0, 0, 127, 255]);
    expect(px(d, W, 10, 8)).toEqual([0, 0, 0, 128]); // beyond Expand: untouched
  });
});

// --- ridgeCoverage -------------------------------------------------------------------------

/** `ridgeCoverage` written out plainly, whole arrays and no reuse: what the window's band,
 *  shared work arrays and row ring must still equal. */
function plainRidge(
  dist: Uint8Array,
  w: number,
  h: number,
  region: Uint8Array,
  tol: number,
  soft: number,
): Uint8ClampedArray {
  const n = w * h;
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) if (region[i]) out[i] = 255;
  const box = (get: (x: number, y: number) => number, r: number, horizontal: boolean) => {
    const o = new Float32Array(n);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let count = 0;
        for (let k = -r; k <= r; k++) {
          const nx = horizontal ? x + k : x;
          const ny = horizontal ? y : y + k;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          sum += get(nx, ny);
          count++;
        }
        o[y * w + x] = sum / count;
      }
    return o;
  };
  const rows = box((x, y) => dist[y * w + x], 2, true);
  const both = box((x, y) => rows[y * w + x], 2, false);
  const smooth = new Uint8Array(n);
  for (let i = 0; i < n; i++) smooth[i] = Math.max(dist[i], Math.round(both[i]));
  const outside = new Uint8Array(n);
  for (let i = 0; i < n; i++) outside[i] = !region[i] && smooth[i] < tol ? 1 : 0;
  for (let grew = true; grew;) {
    grew = false;
    for (let i = 0; i < n; i++) {
      if (outside[i] || region[i] || dist[i] >= tol) continue;
      const x = i % w;
      if (
        (x > 0 && outside[i - 1]) ||
        (x < w - 1 && outside[i + 1]) ||
        (i >= w && outside[i - w]) ||
        (i + w < n && outside[i + w])
      ) {
        outside[i] = 1;
        grew = true;
      }
    }
  }
  const dIn = distanceToMask(region, w, h);
  const dOut = distanceToMask(outside, w, h);
  const feather = Math.max(1, 2 * soft);
  const reachFade = Math.max(8, feather);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (region[i] || outside[i] || dIn[i] > UNDER_LINE_MAX_PX) continue;
      let peak = 0;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) peak = Math.max(peak, smooth[ny * w + nx]);
        }
      const span = Number.isFinite(dOut[i]) ? dIn[i] + dOut[i] : Infinity;
      const t = Number.isFinite(span) ? dIn[i] / span : 0;
      const edge = Number.isFinite(span)
        ? Math.max(0, Math.min(1, ((0.5 - t) * span) / feather + 0.5))
        : 1;
      if (edge <= 0) continue;
      const reach =
        !Number.isFinite(span) || span / 2 > UNDER_LINE_MAX_PX
          ? Math.min(1, (UNDER_LINE_MAX_PX - dIn[i]) / reachFade)
          : 1;
      const along = dIn[i] <= 1.5 ? 0 : Math.min(1, t / 0.5);
      out[i] = Math.round(255 * edge * reach * (1 + (1 - peak / 255 - 1) * along));
    }
  return out;
}

describe("ridgeCoverage in less memory", () => {
  it("gives the same coverage as the plain whole-array version", () => {
    // Small enough that the window is the whole image (the plain version has no window).
    const w = 90;
    const h = 70;
    let lines = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const d = art(w, h, seed * 13);
      const sx = 2 + (seed % 4) * 28;
      const sy = 2 + (seed % 3) * 30;
      if (d[(sy * w + sx) * 4 + 3] !== 0) continue;
      const region = fillMask(d, w, h, sx, sy, 32)!;
      const dist = bucketStrength(d, w, h, { r: 0, g: 0, b: 0, a: 0 }, 32);
      for (const soft of [0.25, 1, 4]) {
        const got = ridgeCoverage(dist, w, h, region, 32, soft);
        const want = plainRidge(dist, w, h, region, 32, soft);
        expect(Array.from(got)).toEqual(Array.from(want));
        for (let i = 0; i < w * h; i++) if (!region[i] && got[i]) lines++;
      }
    }
    expect(lines).toBeGreaterThan(500); // the comparison did cover fill under lines
  });

  it("is the region alone when the region is everything", () => {
    const w = 50;
    const region = new Uint8Array(w * w).fill(1);
    const c = ridgeCoverage(new Uint8Array(w * w), w, w, region, 32, 1);
    expect(c.every((v) => v === 255)).toBe(true);
  });
});

describe("ridgeCoverage: a solid line's antialiased edge", () => {
  /** One row: 6 px of region, the line's strengths, 10 px of paper. */
  const across = (line: number[], soft = 1) => {
    const dist = Uint8Array.from([...Array(6).fill(0), ...line, ...Array(10).fill(0)]);
    const region = Uint8Array.from([...Array(6).fill(1), ...Array(line.length + 10).fill(0)]);
    return [...ridgeCoverage(dist, dist.length, 1, region, 32, soft)].slice(6);
  };
  /** A line pixel of alpha `a` over fill coverage `c` (an opaque fill), as alpha 0–255. */
  const over = (a: number, c: number) => Math.round(a + (c * (255 - a)) / 255);

  it("leaves no see-through seam between an opaque fill and an opaque line", () => {
    // (A wider Soft than the line's half-width still thins it: that is Soft's own cut.)
    for (const soft of [0.25, 1]) {
      const line = [128, 255, 255, 255, 255, 128];
      const c = across(line, soft);
      expect(c[0]).toBe(255); // it was 170: the edge pixel came out at alpha 212
      for (let i = 0; i < 3; i++) expect(over(line[i], c[i])).toBe(255);
    }
  });

  it("covers a diagonal neighbour of the region fully too", () => {
    // The region is the top-left 6×6 of a 24×24 image, wrapped in a solid line 6 px wide (strength
    // 255), with paper beyond.
    const w = 24;
    const region = new Uint8Array(w * w);
    const dist = new Uint8Array(w * w);
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 12; x++) {
        if (x < 6 && y < 6) region[y * w + x] = 1;
        else dist[y * w + x] = 255;
      }
    const c = ridgeCoverage(dist, w, w, region, 32, 1);
    expect(c[6 * w + 6]).toBe(255);
    expect(c[7 * w + 7]).toBeLessThan(255); // further in it fades as before
    expect(c[7 * w + 7]).toBeGreaterThan(0);
  });

  it("keeps a light line two-tone: fill under its inner half only, fading", () => {
    const c = across([40, 70, 100, 100, 100, 100, 70, 40]);
    expect(c[0]).toBe(255);
    expect(c[1]).toBeLessThan(c[0]);
    expect(c[2]).toBeLessThanOrEqual(c[1]);
    expect(c[2]).toBeGreaterThan(0);
    expect(c.slice(5)).toEqual(Array(c.length - 5).fill(0));
  });
});
