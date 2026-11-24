import { describe, it, expect } from "vitest";
import { bulge, lensTable, spherize, type Lens } from "../spherize";
import { applyFilter } from "../filters";

const N = 1024;

describe("lensTable", () => {
  for (const amount of [-100, -40, 0, 40, 100]) {
    it(`at ${amount} fixes the middle and the rim and only grows`, () => {
      const t = lensTable(amount);
      expect(t[0]).toBe(0);
      expect(t[N]).toBeCloseTo(1, 6);
      for (let i = 1; i <= N; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    });
  }

  it("bulges by reading nearer the middle, pinches by reading further out", () => {
    expect(lensTable(100)[N / 2]).toBeLessThan(0.5);
    expect(lensTable(-100)[N / 2]).toBeGreaterThan(0.5);
    expect(lensTable(0)[N / 2]).toBeCloseTo(0.5, 6);
  });

  it("a pinch is the bulge's inverse", () => {
    const k = 0.5 * 0.7;
    const pinch = lensTable(-70);
    for (let i = 0; i <= N; i += 37) expect(bulge(pinch[i], k)).toBeCloseTo(i / N, 5);
  });

  it("magnifies the middle 2× at 100", () => {
    expect(lensTable(100)[1] * N).toBeCloseTo(0.5, 3);
  });
});

/** A w × h opaque image whose colour is its x (red) and y (green). */
function ramp(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      d[p] = x * 4;
      d[p + 1] = y * 4;
      d[p + 3] = 255;
    }
  return d;
}

describe("spherize", () => {
  const w = 41,
    h = 41;
  const lens: Lens = { cx: 20.5, cy: 20.5, rx: 20.5, ry: 20.5 };

  it("leaves everything outside the ellipse, and the middle pixel, as they were", () => {
    const src = ramp(w, h);
    const out = new Uint8ClampedArray(src.length);
    spherize(src, out, w, h, 0, 0, lens, 100, false);
    for (const [x, y] of [
      [0, 0],
      [40, 0],
      [0, 40],
      [40, 40],
      [2, 3],
    ]) {
      const p = (y * w + x) * 4;
      expect([...out.subarray(p, p + 4)]).toEqual([...src.subarray(p, p + 4)]);
    }
    const c = (20 * w + 20) * 4;
    expect([...out.subarray(c, c + 4)]).toEqual([...src.subarray(c, c + 4)]);
  });

  it("changes nothing at 0", () => {
    const src = ramp(w, h);
    const out = new Uint8ClampedArray(src.length);
    spherize(src, out, w, h, 0, 0, lens, 0, false);
    expect(out).toEqual(src);
  });

  /** Painted pixels of a centred dot of radius 5 after spherize at `amount`. */
  function dotArea(amount: number): number {
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if ((x - 20) ** 2 + (y - 20) ** 2 <= 25) src[(y * w + x) * 4 + 3] = 255;
    const out = new Uint8ClampedArray(src.length);
    spherize(src, out, w, h, 0, 0, lens, amount, false);
    let n = 0;
    for (let p = 3; p < out.length; p += 4) if (out[p] >= 128) n++;
    return n;
  }

  it("a bulge grows a dot in the middle, a pinch shrinks it", () => {
    const flat = dotArea(0);
    expect(dotArea(100)).toBeGreaterThan(flat * 2.5);
    expect(dotArea(-100)).toBeLessThan(flat * 0.5);
  });

  it("reads the lens in layer px: a region placed elsewhere on the layer matches the whole", () => {
    const src = ramp(w, h);
    const whole = new Uint8ClampedArray(src.length);
    spherize(src, whole, w, h, 0, 0, lens, 60, false);
    // The same image as a region at (100, 50): the lens moves with it.
    const part = new Uint8ClampedArray(src.length);
    spherize(src, part, w, h, 100, 50, { ...lens, cx: 120.5, cy: 70.5 }, 60, false);
    expect(part).toEqual(whole);
  });

  it("keeps each pixel's alpha under alpha lock", () => {
    const src = ramp(w, h);
    for (let p = 3; p < src.length; p += 8) src[p] = 0; // every other pixel transparent
    const out = new Uint8ClampedArray(src.length);
    spherize(src, out, w, h, 0, 0, lens, 100, true);
    for (let p = 3; p < src.length; p += 4) expect(out[p]).toBe(src[p]);
  });

  it("runs through applyFilter with App's lens, and copies without one", () => {
    const src = ramp(w, h);
    const a = new Uint8ClampedArray(src.length);
    const b = new Uint8ClampedArray(src.length);
    applyFilter(src, a, w, h, 0, 0, { kind: "spherize", amount: 80 }, 1, false, { lens });
    spherize(src, b, w, h, 0, 0, lens, 80, false);
    expect(a).toEqual(b);
    applyFilter(src, a, w, h, 0, 0, { kind: "spherize", amount: 80 }, 1, false, {});
    expect(a).toEqual(src);
  });
});
