import { describe, it, expect } from "vitest";
import { floorScale, MIN_SCALE } from "../selection";

// A corner released exactly on its anchor gave scale 0: a non-invertible matrix froze the float.
describe("floorScale", () => {
  it("lifts zero and tiny magnitudes to MIN_SCALE", () => {
    expect(floorScale(0)).toBe(MIN_SCALE);
    expect(floorScale(0.001)).toBe(MIN_SCALE);
    expect(floorScale(-0.001)).toBe(-MIN_SCALE);
  });

  it("keeps the sign, so a drag through the anchor still mirrors", () => {
    expect(floorScale(-2)).toBe(-2);
  });

  it("leaves ordinary scales alone", () => {
    for (const v of [MIN_SCALE, 0.5, 1, 3]) expect(floorScale(v)).toBe(v);
  });
});
