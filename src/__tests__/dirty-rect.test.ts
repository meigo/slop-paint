import { describe, expect, it } from "vitest";
import { deviceRect, pointsBox, strokePad, unionBox } from "../dirty-rect";

describe("pointsBox", () => {
  it("bounds the points from `from`, grown by the pad", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 4, y: 20 },
    ];
    expect(pointsBox(pts, 2)).toEqual({ x0: -2, y0: -2, x1: 12, y1: 22 });
    expect(pointsBox(pts, 0, 1)).toEqual({ x0: 4, y0: 5, x1: 10, y1: 20 });
    expect(pointsBox(pts, 0, -3)).toEqual({ x0: 0, y0: 0, x1: 10, y1: 20 });
  });
  it("is null with no points", () => {
    expect(pointsBox([], 5)).toBeNull();
    expect(pointsBox([{ x: 1, y: 1 }], 5, 1)).toBeNull();
  });
});

describe("unionBox", () => {
  it("joins two boxes, either may be null", () => {
    const a = { x0: 0, y0: 0, x1: 5, y1: 5 };
    const b = { x0: 3, y0: -2, x1: 9, y1: 4 };
    expect(unionBox(a, b)).toEqual({ x0: 0, y0: -2, x1: 9, y1: 5 });
    expect(unionBox(null, b)).toBe(b);
    expect(unionBox(a, null)).toBe(a);
    expect(unionBox(null, null)).toBeNull();
  });
});

describe("deviceRect", () => {
  it("grows to whole pixels at the ratio and clips to the canvas", () => {
    expect(deviceRect({ x0: 1.2, y0: 2.6, x1: 3.1, y1: 4 }, 2, 100, 100)).toEqual({
      x: 2,
      y: 5,
      w: 5,
      h: 3,
    });
    expect(deviceRect({ x0: -10, y0: -10, x1: 200, y1: 50 }, 1, 100, 80)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 50,
    });
  });
  it("is null when the box is off the canvas", () => {
    expect(deviceRect({ x0: 120, y0: 0, x1: 150, y1: 10 }, 1, 100, 100)).toBeNull();
    expect(deviceRect({ x0: -20, y0: 0, x1: -1, y1: 10 }, 1, 100, 100)).toBeNull();
  });
});

describe("strokePad", () => {
  it("is twice the widest width plus 16", () => {
    expect(strokePad(10)).toBe(36);
  });
});
