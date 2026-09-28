import { describe, it, expect } from "vitest";
import {
  ROPE_MAX_PX,
  SMOOTH_MAX_PX,
  pathSmoothRadius,
  ropeLength,
  ropeStep,
  smoothPath,
} from "../stroke-smoothing";

/** 300 px/s along x with a 3 px, 6 Hz hand wobble, sampled at `hz` (the old test case). */
function wobble(hz: number, seconds = 1.5) {
  return Array.from({ length: Math.round(hz * seconds) }, (_, i) => {
    const t = i / hz;
    return { x: 300 * t, y: 3 * Math.sin(2 * Math.PI * 6 * t), pressure: 0.5, timestamp: t };
  });
}
const maxAbsY = (pts: { x: number; y: number }[]) => Math.max(...pts.map((p) => Math.abs(p.y)));

describe("ropeLength", () => {
  it("is 0 at 0, gentle at half, full at the top", () => {
    expect(ropeLength(0)).toBe(0);
    expect(ropeLength(0.5)).toBe(ROPE_MAX_PX / 4);
    expect(ropeLength(1)).toBe(ROPE_MAX_PX);
    expect(ropeLength(7)).toBe(ROPE_MAX_PX);
  });
});

describe("ropeStep", () => {
  it("stays put while the string is slack", () => {
    const b = { x: 0, y: 0 };
    expect(ropeStep(b, { x: 3, y: 4 }, 5)).toBe(b);
  });

  it("is pulled to exactly the string's length behind", () => {
    const b = ropeStep({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    expect(b).toEqual({ x: 6, y: 0 });
  });

  it("follows the pen exactly with no string", () => {
    expect(ropeStep({ x: 0, y: 0 }, { x: 2, y: 1 }, 0)).toEqual({ x: 2, y: 1 });
  });

  it("takes out most of a hand wobble, whatever the event rate", () => {
    for (const hz of [60, 240]) {
      let b = { x: 0, y: 0 };
      const trail = wobble(hz).map((p) => (b = ropeStep(b, p, ropeLength(1))));
      // after the string has gone taut
      expect(maxAbsY(trail.slice(Math.round(hz * 0.5)))).toBeLessThan(0.6);
    }
  });
});

describe("pathSmoothRadius", () => {
  it("is a screen distance: bigger in document px when zoomed out", () => {
    expect(pathSmoothRadius(100, 1)).toBe(SMOOTH_MAX_PX);
    expect(pathSmoothRadius(100, 0.5)).toBe(SMOOTH_MAX_PX * 2);
    expect(pathSmoothRadius(50, 2)).toBe(SMOOTH_MAX_PX / 4);
    expect(pathSmoothRadius(0, 1)).toBe(0);
  });
});

describe("smoothPath", () => {
  it("does nothing at radius 0", () => {
    const pts = wobble(120);
    expect(smoothPath(pts, 0)).toBe(pts);
  });

  it("keeps both ends exactly", () => {
    const pts = wobble(240);
    const out = smoothPath(pts, SMOOTH_MAX_PX);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("rounds out a wobble away from the ends", () => {
    const out = smoothPath(wobble(240), SMOOTH_MAX_PX);
    const middle = out.filter((p) => p.x > 60 && p.x < 390);
    expect(maxAbsY(middle)).toBeLessThan(0.75);
  });

  it("leaves a straight, evenly drawn line where it is", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({
      x: i * 3,
      y: 2 * i,
      pressure: 0.4,
      timestamp: i,
    }));
    smoothPath(line, 20).forEach((p, i) => {
      expect(p.x).toBeCloseTo(line[i].x, 9);
      expect(p.y).toBeCloseTo(line[i].y, 9);
      expect(p.pressure).toBeCloseTo(0.4, 9);
    });
  });

  it("isn't thrown by uneven spacing (a slow stretch, then a fast one)", () => {
    const pts = [
      ...Array.from({ length: 40 }, (_, i) => ({ x: i * 0.25, y: 0, pressure: 1, timestamp: i })),
      ...Array.from({ length: 10 }, (_, i) => ({
        x: 10 + i * 5,
        y: 0,
        pressure: 1,
        timestamp: 40 + i,
      })),
    ];
    const out = smoothPath(pts, 10);
    for (let i = 1; i < out.length; i++) expect(out[i].x).toBeGreaterThanOrEqual(out[i - 1].x);
  });
});
