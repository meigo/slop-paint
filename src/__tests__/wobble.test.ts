import { describe, it, expect } from "vitest";
import { holdRestPressure } from "../stroke-smoothing";
import type { InputPoint } from "../input";
import { noise2, strokeSeed, wobbleAmp, wobbleOutline, wobbleScale } from "../wobble";
import { outlineOfPath, pathSpine, strokeOutline, widthRange } from "../brush";

/** Filled length (nonzero winding) of a polygon along the vertical line x = x0. */
function crossSection(poly: number[][], x0: number): number {
  const hits: { y: number; dir: number }[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    if ((ax <= x0 && bx > x0) || (bx <= x0 && ax > x0)) {
      hits.push({ y: ay + ((by - ay) * (x0 - ax)) / (bx - ax), dir: bx > ax ? 1 : -1 });
    }
  }
  hits.sort((p, q) => p.y - q.y);
  let w = 0;
  let len = 0;
  for (let i = 0; i < hits.length; i++) {
    if (w !== 0) len += hits[i].y - hits[i - 1].y;
    w += hits[i].dir;
  }
  return len;
}

const pt = (x: number, pressure: number, i: number): InputPoint => ({
  x,
  y: 0,
  pressure,
  timestamp: 1000 + i * 8,
});

describe("wobble", () => {
  it("noise2 is smooth, in 0–1, and the same for the same key", () => {
    for (let i = 0; i < 200; i++) {
      const v = noise2(7, i * 0.37, i * 0.11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(noise2(7, i * 0.37, i * 0.11)).toBe(v);
      expect(Math.abs(noise2(7, i * 0.37 + 0.01, i * 0.11) - v)).toBeLessThan(0.05);
    }
    expect(noise2(7, 3.5, 2.5)).not.toBe(noise2(8, 3.5, 2.5));
  });

  it("wobble moves a point by its page position alone, at most the amplitude", () => {
    const pts = [
      [10, 20, 0.5],
      [40.5, 33, 0.5],
    ];
    const a = wobbleOutline(pts, 3, 4, 10);
    // the same point in another outline lands in the same place
    const b = wobbleOutline([[0, 0, 0.5], ...pts.slice(1)], 3, 4, 10);
    expect(b[1]).toEqual(a[1]);
    for (let i = 0; i < pts.length; i++) {
      expect(Math.hypot(a[i][0] - pts[i][0], a[i][1] - pts[i][1])).toBeLessThanOrEqual(
        4 * Math.SQRT2,
      );
    }
    expect(wobbleOutline(pts, 3, 0, 10)).toBe(pts);
    expect(wobbleAmp(100, 0)).toBe(0);
    expect(wobbleAmp(100, 100)).toBeCloseTo(20);
  });

  it("without the fine octave it moves as far at most, and differs from with it", () => {
    const pts = Array.from({ length: 60 }, (_, i) => [i * 1.7, 40 + i * 0.9]);
    const soft = wobbleOutline(pts, 5, 4, 10, false);
    const both = wobbleOutline(pts, 5, 4, 10);
    let moved = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(soft[i][0] - pts[i][0], soft[i][1] - pts[i][1]);
      expect(d).toBeLessThanOrEqual(4 * Math.SQRT2);
      moved = Math.max(moved, d);
    }
    expect(moved).toBeGreaterThan(1);
    expect(soft).not.toEqual(both);
    // less jagged: the second differences of the displacement are smaller
    const jag = (out: number[][]) => {
      let sum = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        for (const k of [0, 1]) {
          const d = (j: number) => out[j][k] - pts[j][k];
          sum += Math.abs(d(i - 1) - 2 * d(i) + d(i + 1));
        }
      }
      return sum;
    };
    expect(jag(soft)).toBeLessThan(jag(both) * 0.7);
  });

  it("bumps are a third of the width across, at least 3 px", () => {
    expect(wobbleScale(30)).toBeCloseTo(10.5);
    expect(wobbleScale(2)).toBe(3);
  });
});

describe("holdRestPressure", () => {
  it("keeps a resting pen's highest pressure, so the tip never shrinks back", () => {
    const pts = [
      pt(0, 0.3, 0),
      pt(10, 0.5, 1),
      pt(10.4, 0.6, 2),
      pt(10.2, 0.55, 3),
      pt(9.9, 0.4, 4),
    ];
    expect(holdRestPressure(pts, 2).map((p) => p.pressure)).toEqual([0.3, 0.5, 0.6, 0.6, 0.6]);
  });

  it("lets the pressure fall again once the pen moves on, and leaves a moving stroke alone", () => {
    const pts = [pt(0, 0.8, 0), pt(1, 0.7, 1), pt(5, 0.6, 2), pt(9, 0.5, 3), pt(13, 0.4, 4)];
    const held = holdRestPressure(pts, 2).map((p) => p.pressure);
    // only the point within 2 px of where the pen was keeps the higher value
    expect(held).toEqual([0.8, 0.8, 0.6, 0.5, 0.4]);
    expect(holdRestPressure(pts, 0)).toBe(pts);
  });

  it("depends only on the points before, so a growing stroke's start never changes", () => {
    const pts = Array.from({ length: 40 }, (_, i) =>
      pt(Math.floor(i / 5) * 3 + (i % 2) * 0.3, 0.5 + 0.1 * Math.sin(i), i),
    );
    const whole = holdRestPressure(pts, 2);
    expect(holdRestPressure(pts.slice(0, 23), 2)).toEqual(whole.slice(0, 23));
  });
});

describe("noise2 (dx / dy independence)", () => {
  /** Correlation of the noise for `seed` and `seed + 1` (wobbleOutline's dx and dy). */
  function corr(seed: number) {
    const a: number[] = [];
    const b: number[] = [];
    for (let k = 0; k < 20000; k++) {
      const x = ((k * 0.6180339887) % 1) * 200;
      const y = ((k * 0.7548776662) % 1) * 200;
      a.push(noise2(seed, x, y) - 0.5);
      b.push(noise2(seed + 1, x, y) - 0.5);
    }
    const ma = a.reduce((s, v) => s + v, 0) / a.length;
    const mb = b.reduce((s, v) => s + v, 0) / b.length;
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let k = 0; k < a.length; k++) {
      sab += (a[k] - ma) * (b[k] - mb);
      saa += (a[k] - ma) ** 2;
      sbb += (b[k] - mb) ** 2;
    }
    return sab / Math.sqrt(saa * sbb);
  }

  // `key ^ x` made an even seed's next noise the same one with neighbouring columns swapped.
  it("gives seed and seed + 1 unrelated noise, even seeds too", () => {
    for (const seed of [2, 1000, 123456, 3, 1001]) expect(Math.abs(corr(seed))).toBeLessThan(0.05);
  });

  describe("Smooth's inward cap (spine)", () => {
    const line = (pressure: number, shift: number, n = 600) =>
      Array.from({ length: n + 1 }, (_, k) => ({
        x: 100 + k + shift,
        y: 300.37,
        pressure,
        timestamp: 1000 + k * 4,
      }));
    const wobbled = (pts: InputPoint[], size: number, press: number, spine: boolean) => {
      const outline = strokeOutline(pts, size, 0, press, true);
      const maxW = widthRange(size, press).max;
      return wobbleOutline(
        outline,
        strokeSeed(pts[0]),
        wobbleAmp(maxW, 100),
        wobbleScale(maxW),
        true,
        spine ? pathSpine(pts, size, press) : undefined,
      );
    };
    const narrowest = (poly: number[][], from: number, to: number) => {
      let m = Infinity;
      for (let x = from; x <= to; x += 0.5) m = Math.min(m, crossSection(poly, x + 0.0123));
      return m;
    };

    it("keeps at least about half the width at the lightest pressure, Wobble 100, Press 3", () => {
      const nominal = widthRange(10, 3).min;
      let without = Infinity;
      for (let s = 0; s < 6; s++) {
        const pts = line(0, s * 0.37);
        expect(narrowest(wobbled(pts, 10, 3, true), 140, 660)).toBeGreaterThan(0.45 * nominal);
        without = Math.min(without, narrowest(wobbled(pts, 10, 3, false), 140, 660));
      }
      expect(without).toBeLessThan(0.3 * nominal); // what it did before: pinched
    });

    // Watercolour draws Smooth's outline (steady spacing, no taper) and takes the same cap.
    it("keeps Watercolour's light stroke from pinching too, Wobble 100, Press 8", () => {
      const nominal = widthRange(10, 8).min;
      const wash = (pts: InputPoint[], spine: boolean) => {
        const maxW = widthRange(10, 8).max;
        return wobbleOutline(
          outlineOfPath(pts, 10, 8, true, false, true),
          strokeSeed(pts[0]),
          wobbleAmp(maxW, 100),
          wobbleScale(maxW),
          true,
          spine ? pathSpine(pts, 10, 8) : undefined,
        );
      };
      let without = Infinity;
      for (let s = 0; s < 6; s++) {
        const pts = line(0, s * 0.37);
        expect(narrowest(wash(pts, true), 140, 660)).toBeGreaterThan(0.45 * nominal);
        without = Math.min(without, narrowest(wash(pts, false), 140, 660));
      }
      expect(without).toBeLessThan(0.45 * nominal); // what it did before: pinched
    });

    it("changes nothing where the stroke is wide", () => {
      const pts = line(1, 0);
      expect(wobbled(pts, 10, 3, true)).toEqual(wobbled(pts, 10, 3, false));
    });

    it("moves no point near the start as the stroke grows", () => {
      const short = line(0, 0, 200);
      const long = line(0, 0, 600);
      const outline = strokeOutline(short, 10, 0, 3, true).filter((p) => p[0] < 200);
      const maxW = widthRange(10, 3).max;
      const args = [strokeSeed(short[0]), wobbleAmp(maxW, 100), wobbleScale(maxW), true] as const;
      expect(wobbleOutline(outline, ...args, pathSpine(short, 10, 3))).toEqual(
        wobbleOutline(outline, ...args, pathSpine(long, 10, 3)),
      );
    });
  });
});
