import { describe, it, expect } from "vitest";
import { clampPress, strokeOutline, TAPER_WIDTHS, widthRange } from "../brush";

/** Height of the outline of a horizontal stroke = the rendered stroke width. */
function horizontalWidth(size: number, sizeRange: number, pressure: number): number {
  const points = Array.from({ length: 41 }, (_, i) => ({
    x: i * 5,
    y: 100,
    pressure,
    timestamp: i,
  }));
  const ys = strokeOutline(points, size, 0, sizeRange, true).map((p) => p[1]);
  return Math.max(...ys) - Math.min(...ys);
}

describe("clampPress", () => {
  it("keeps a saved range inside 1–8, on the 0.5 step", () => {
    expect(clampPress(3)).toBe(3);
    expect(clampPress(50)).toBe(8);
    expect(clampPress(0)).toBe(1);
    expect(clampPress(2.2)).toBe(2);
  });
});

describe("widthRange", () => {
  it("opens both ways around the nominal size", () => {
    expect(widthRange(4, 3)).toEqual({ min: 4 / 3, max: 12 });
  });

  it("is a constant width at range 1", () => {
    expect(widthRange(4, 1)).toEqual({ min: 4, max: 4 });
  });

  it("floors the thin end at 0.5px", () => {
    expect(widthRange(1, 8)).toEqual({ min: 0.5, max: 8 });
    expect(widthRange(0.1, 2)).toEqual({ min: 0.5, max: 1 });
  });
});

describe("strokeOutline width", () => {
  // perfect-freehand's `size` is a radius basis; passing the diameter drew strokes 2x too wide
  it("draws a constant-width stroke exactly `size` wide", () => {
    expect(horizontalWidth(10, 1, 0)).toBeCloseTo(10, 0);
    expect(horizontalWidth(10, 1, 1)).toBeCloseTo(10, 0);
  });

  it("thins a light stroke and widens a full-pressure one", () => {
    expect(horizontalWidth(10, 3, 0)).toBeCloseTo(10 / 3, 0);
    expect(horizontalWidth(10, 3, 1)).toBeCloseTo(30, 0);
  });
});

describe("taper", () => {
  const pts = Array.from({ length: 41 }, (_, i) => ({
    x: i * 5,
    y: 100,
    pressure: 0.5,
    timestamp: i,
  }));
  /** Height of the outline within `dx` px of the stroke's start — the width at that end. */
  const startWidth = (taper: boolean) => {
    const near = strokeOutline(pts, 10, 0, 1, true, taper).filter((p) => p[0] < 3);
    const ys = near.map((p) => p[1]);
    return Math.max(...ys) - Math.min(...ys);
  };

  it("narrows the stroke's ends to a point", () => {
    expect(startWidth(true)).toBeLessThan(startWidth(false) / 2);
  });

  it("leaves the ends at full width when off", () => {
    expect(startWidth(false)).toBeCloseTo(10, 0);
  });

  /** Width of a horizontal outline at x. */
  const widthAt = (outline: number[][], x: number) => {
    const ys: number[] = [];
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) {
        ys.push(a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
      }
    }
    return Math.max(...ys) - Math.min(...ys);
  };
  const line = (len: number) =>
    Array.from({ length: len / 2 + 1 }, (_, i) => ({ x: i * 2, y: 0, pressure: 1, timestamp: i }));

  // perfect-freehand's `taper: true` is the whole stroke's length: a spindle never at full width.
  it("tapers over a fixed length, so a long stroke reaches its full width between", () => {
    const o = strokeOutline(line(600), 8, 0, 1, true, true);
    expect(TAPER_WIDTHS * 8).toBeLessThan(100);
    expect(widthAt(o, 300)).toBeCloseTo(8, 0);
    expect(widthAt(o, 150)).toBeCloseTo(8, 0);
  });

  /** Height of an outline: the widest the stroke gets across a horizontal path. */
  const height = (o: number[][]) =>
    Math.max(...o.map((p) => p[1])) - Math.min(...o.map((p) => p[1]));

  it("draws a finished tap as a dot, not a taper to nothing", () => {
    // A Pencil tap travels 0.3–2 px: tapered over 4 widths an end, it drew a speck.
    const tap = [0, 0.4, 0.9, 1.3].map((x, i) => ({ x, y: 0, pressure: 1, timestamp: i }));
    const o = strokeOutline(tap, 8, 0, 1, true, true);
    expect(height(o)).toBeCloseTo(8, 0);
    expect(o).toEqual(strokeOutline(tap, 8, 0, 1, true, false));
  });

  it("tapers a finished short tick over half its length, so it reaches near full width", () => {
    // 24 px long, 8 wide: 4 widths an end would be 32 px, more than the whole tick.
    const o = strokeOutline(line(24), 8, 0, 1, true, true);
    expect(widthAt(o, 12)).toBeGreaterThan(6);
    expect(widthAt(o, 2)).toBeLessThan(widthAt(o, 12) / 2); // still tapered at its ends
  });

  it("leaves a finished stroke of 8 widths or more, and every live stroke, as they were", () => {
    // 200 px is 25 widths of 8: the full 4-width taper, the same one a live stroke gets.
    const done = strokeOutline(line(200), 8, 0, 1, true, true);
    expect(widthAt(done, 100)).toBeCloseTo(8, 0);
    expect(widthAt(done, 10)).toBeCloseTo(
      widthAt(strokeOutline(line(200), 8, 0, 1, false, true), 10),
      1,
    );
    expect(widthAt(done, 10)).toBeLessThan(6);
    // live: the 24-px tick is still drawn with the full taper (no change while drawing)
    expect(widthAt(strokeOutline(line(24), 8, 0, 1, false, true), 12)).toBeLessThan(6);
  });

  it("keeps the drawn start as the live stroke grows", () => {
    const short = widthAt(strokeOutline(line(200), 8, 0, 1, false, true), 10);
    const long = widthAt(strokeOutline(line(1600), 8, 0, 1, false, true), 10);
    expect(long).toBeCloseTo(short, 1);
  });
});
