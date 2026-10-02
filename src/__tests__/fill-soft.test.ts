import { describe, it, expect } from "vitest";
import { climbToRidge, colourDistance, fillCoverage } from "../fill";

/** One row: region pixels marked 1, distances as given. */
const row = (bits: number[]) => Uint8Array.from(bits);

describe("climbToRidge", () => {
  it("runs uphill into a soft line and stops at its darkest pixel", () => {
    // region | fringe rising to the ridge at x=5 | falling side | empty beyond
    const dist = row([0, 0, 40, 90, 160, 230, 150, 60, 0, 0]);
    const region = row([1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...climbToRidge(dist, 10, 1, region)]).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it("crosses a flat, opaque line but not into the space past it", () => {
    const dist = row([0, 0, 255, 255, 255, 0, 0]);
    expect([...climbToRidge(dist, 7, 1, row([1, 1, 0, 0, 0, 0, 0]))]).toEqual([
      1, 1, 1, 1, 1, 0, 0,
    ]);
  });

  it("never leaks through a break (empty pixels don't count) and keeps to maxSteps", () => {
    expect([...climbToRidge(row([0, 0, 0, 0]), 4, 1, row([1, 0, 0, 0]))]).toEqual([1, 0, 0, 0]);
    const ramp = row([0, 10, 20, 30, 40, 50]);
    expect([...climbToRidge(ramp, 6, 1, row([1, 0, 0, 0, 0, 0]), 3)]).toEqual([1, 1, 1, 1, 0, 0]);
  });
});

describe("fillCoverage", () => {
  it("keeps the tapped region solid and fades toward the ridge, nothing past it", () => {
    const solid = row([1, 1, 1, 0, 0, 0, 0, 0]);
    const grown = row([1, 1, 1, 1, 1, 1, 0, 0]);
    const c = [...fillCoverage(solid, grown, 8, 1, 1)];
    expect(c.slice(0, 3)).toEqual([255, 255, 255]);
    // A 1-px-high row sees 3 of the 9 pixels a radius-1 box covers when all three are grown.
    expect(c[3]).toBe(85);
    expect(c[5]).toBe(57); // 2 of 9: the last grown pixel, at the ridge
    expect(c.slice(6)).toEqual([0, 0]);
  });

  it("is the solid region alone at radius 0", () => {
    expect([...fillCoverage(row([1, 0]), row([1, 1]), 2, 1, 0)]).toEqual([255, 0]);
  });
});

describe("colourDistance", () => {
  it("uses alpha alone from an empty seed, every channel otherwise", () => {
    const data = Uint8ClampedArray.from([255, 0, 0, 100, 0, 0, 0, 0]);
    expect([...colourDistance(data, 2, 1, { r: 0, g: 0, b: 0, a: 0 })]).toEqual([100, 0]);
    expect([...colourDistance(data, 2, 1, { r: 0, g: 0, b: 0, a: 255 })]).toEqual([255, 255]);
  });
});
