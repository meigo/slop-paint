import { describe, it, expect } from "vitest";
import { climbDepth, colourDistance, fillCoverage } from "../fill";

const row = (bits: number[]) => Uint8Array.from(bits);

describe("climbDepth", () => {
  it("steps into a soft line as deep as allowed, numbering each step", () => {
    const dist = row([0, 0, 40, 90, 160, 230, 150, 60, 0]);
    const region = row([1, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect([...climbDepth(dist, 9, 1, region, 2)]).toEqual([1, 1, 2, 3, 0, 0, 0, 0, 0]);
  });

  it("never passes the line's darkest pixel, however deep it may go", () => {
    const dist = row([0, 40, 230, 150, 60, 0]);
    expect([...climbDepth(dist, 6, 1, row([1, 0, 0, 0, 0, 0]), 4)]).toEqual([1, 2, 3, 0, 0, 0]);
  });

  it("crosses a flat line but never an empty pixel (a break)", () => {
    expect([...climbDepth(row([0, 255, 255, 0, 0]), 5, 1, row([1, 0, 0, 0, 0]), 4)]).toEqual([
      1, 2, 3, 0, 0,
    ]);
    expect([...climbDepth(row([0, 0, 0]), 3, 1, row([1, 0, 0]), 4)]).toEqual([1, 0, 0]);
  });
});

describe("fillCoverage", () => {
  const depth = row([1, 2, 3, 4, 0]);
  it("fills the region solid and `soft` px of the line, fractions partly", () => {
    expect([...fillCoverage(depth, 1)]).toEqual([255, 255, 0, 0, 0]);
    expect([...fillCoverage(depth, 0.5)]).toEqual([255, 128, 0, 0, 0]);
    expect([...fillCoverage(depth, 1.75)]).toEqual([255, 255, 191, 0, 0]);
    expect([...fillCoverage(depth, 0)]).toEqual([255, 0, 0, 0, 0]);
  });
});

describe("colourDistance", () => {
  it("uses alpha alone from an empty seed, every channel otherwise", () => {
    const data = Uint8ClampedArray.from([255, 0, 0, 100, 0, 0, 0, 0]);
    expect([...colourDistance(data, 2, 1, { r: 0, g: 0, b: 0, a: 0 })]).toEqual([100, 0]);
    expect([...colourDistance(data, 2, 1, { r: 0, g: 0, b: 0, a: 255 })]).toEqual([255, 255]);
  });
});
