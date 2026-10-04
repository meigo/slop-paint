import { describe, it, expect } from "vitest";
import {
  colourDistance,
  expandedCoverage,
  ridgeCoverage,
  softStepIndex,
  SOFT_STEPS,
  UNDER_LINE_MAX_PX,
} from "../fill";
import { distanceToMask } from "../mask-ops";

const row = (bits: number[]) => Uint8Array.from(bits);
/** One row: `region` 1s, then the line's strengths, then empty space beyond. */
const across = (line: number[], soft = 1, inside = 6, beyond = 10) => {
  const dist = [...Array(inside).fill(0), ...line, ...Array(beyond).fill(0)];
  const region = [...Array(inside).fill(1), ...Array(line.length + beyond).fill(0)];
  const c = [...ridgeCoverage(row(dist), dist.length, 1, row(region), 32, soft)];
  return c.slice(inside, inside + line.length + beyond);
};

describe("ridgeCoverage", () => {
  it("runs under the line to its middle and stops there", () => {
    const c = across([60, 140, 230, 255, 255, 255, 230, 140, 60]);
    expect(c[0]).toBeGreaterThan(0); // the inner edge gets fill
    expect(c[2]).toBeGreaterThan(0);
    expect(c.slice(6)).toEqual(Array(c.length - 6).fill(0)); // the outer side: none
  });

  it("isn't stopped by grain: every pixel of the inner half gets some", () => {
    // A light pencil line whose strength goes up and down from pixel to pixel.
    const c = across([50, 110, 40, 130, 60, 140, 120, 140, 60, 130, 40, 110, 50]);
    for (let i = 0; i < 5; i++) expect(c[i]).toBeGreaterThan(0);
    expect(c.slice(9)).toEqual(Array(c.length - 9).fill(0));
  });

  it("fades toward 1 − the line's strongest value: a light line keeps more fill than a solid one", () => {
    const light = across([40, 70, 100, 100, 100, 70, 40]);
    const solid = across([100, 200, 255, 255, 255, 200, 100]);
    expect(light[2]).toBeGreaterThan(solid[2]);
    expect(light[0]).toBeGreaterThanOrEqual(light[2]); // fading from the region outward
  });

  it("is the region alone at Soft 0, and a softer cut at a higher Soft", () => {
    expect(across([60, 140, 230, 140, 60], 0)).toEqual(Array(15).fill(0));
    const hard = across([60, 140, 230, 255, 230, 140, 60], 0.25);
    const soft = across([60, 140, 230, 255, 230, 140, 60], 4);
    const last = (c: number[]) => c.findLastIndex((v) => v > 0);
    expect(last(soft)).toBeGreaterThanOrEqual(last(hard));
    // the soft cut steps down more gently at its end
    const step = (c: number[]) => c[last(c) - 1] - c[last(c)];
    expect(step(soft)).toBeLessThan(step(hard));
  });

  it("fills all of a line with no empty space beyond it within reach, and nothing out of reach", () => {
    // The region, then a solid band wider than the reach: fill under it up to the reach only.
    const band = Array(UNDER_LINE_MAX_PX + 8).fill(255);
    const c = across(band, 1, 4, 0);
    expect(c[0]).toBeGreaterThan(0);
    expect(c[UNDER_LINE_MAX_PX - 1]).toBeGreaterThan(0);
    expect(c[UNDER_LINE_MAX_PX + 2]).toBe(0);
  });
});

describe("colourDistance", () => {
  it("uses alpha alone from an empty seed, every channel otherwise", () => {
    const data = Uint8ClampedArray.from([255, 0, 0, 100, 0, 0, 0, 0]);
    expect([...colourDistance(data, 2, 1, { r: 0, g: 0, b: 0, a: 0 })]).toEqual([100, 0]);
    expect([...colourDistance(data, 2, 1, { r: 0, g: 0, b: 0, a: 255 })]).toEqual([255, 255]);
  });
});

describe("expandedCoverage / distanceToMask", () => {
  it("measures true distance to the mask", () => {
    const m = new Uint8Array(25);
    m[12] = 1; // the centre of 5×5
    const d = distanceToMask(m, 5, 5);
    expect(d[12]).toBe(0);
    expect(d[13]).toBeCloseTo(1);
    expect(d[18]).toBeCloseTo(Math.SQRT2);
    expect(d[24]).toBeCloseTo(2 * Math.SQRT2);
    expect(distanceToMask(new Uint8Array(4), 2, 2)[0]).toBe(Infinity);
  });

  it("grows solid to Expand px, then fades over the feather", () => {
    const m = row([1, 0, 0, 0, 0, 0, 0]);
    // Expand 2, Soft 0.5 (feather 1 px): solid to 2, half at 2.5 — pixel 3 is 3 away: 0.
    expect([...expandedCoverage(m, 7, 1, 2, 0.5)]).toEqual([255, 255, 255, 0, 0, 0, 0]);
    // Soft 1 (feather 2 px): pixel 3 → (2 + 2 − 3) / 2 = 0.5, pixel 4 → 0.
    expect([...expandedCoverage(m, 7, 1, 2, 1)]).toEqual([255, 255, 255, 128, 0, 0, 0]);
  });

  it("is the old whole-pixel dilation at Soft 0", () => {
    const m = row([1, 0, 0, 0]);
    expect([...expandedCoverage(m, 4, 1, 2, 0)]).toEqual([255, 255, 255, 0]);
  });
});

describe("SOFT_STEPS / softStepIndex", () => {
  it("snaps a value to the nearest stop, quarters up to 2 then coarser to 8", () => {
    expect(SOFT_STEPS[softStepIndex(0.5)]).toBe(0.5);
    expect(SOFT_STEPS[softStepIndex(2.2)]).toBe(2);
    expect(SOFT_STEPS[softStepIndex(7)]).toBe(6); // a tie goes to the lower stop
    expect(SOFT_STEPS[softStepIndex(99)]).toBe(8);
    expect(softStepIndex(0)).toBe(0);
  });
});
