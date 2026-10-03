import { describe, it, expect } from "vitest";
import { holdRestPressure } from "../stroke-smoothing";
import type { InputPoint } from "../input";
import { noise2, wobbleAmp, wobbleOutline, wobbleScale } from "../wobble";

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
