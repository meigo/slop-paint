import { describe, it, expect } from "vitest";
import { strokeOutline, widthRange } from "../brush";

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

describe("widthRange", () => {
  it("uses size as the thinnest width and widens by sizeRange", () => {
    expect(widthRange(4, 3)).toEqual({ min: 4, max: 12 });
  });

  it("floors tiny sizes at 0.5px", () => {
    expect(widthRange(0.1, 2)).toEqual({ min: 0.5, max: 1 });
  });
});

describe("strokeOutline width", () => {
  // perfect-freehand's `size` is a radius basis; passing the diameter drew strokes 2x too wide
  it("draws a no-pressure stroke exactly `size` wide", () => {
    expect(horizontalWidth(10, 1, 0)).toBeCloseTo(10, 0);
    expect(horizontalWidth(10, 3, 0)).toBeCloseTo(10, 0);
  });

  it("draws a full-pressure stroke `size * sizeRange` wide", () => {
    expect(horizontalWidth(10, 3, 1)).toBeCloseTo(30, 0);
  });
});
