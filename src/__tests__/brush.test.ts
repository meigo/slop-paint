import { describe, it, expect } from "vitest";
import { clampPress, strokeOutline, widthRange } from "../brush";

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
});
