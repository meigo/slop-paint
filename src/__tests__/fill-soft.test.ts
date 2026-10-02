import { describe, it, expect } from "vitest";
import {
  colourDistance,
  expandedCoverage,
  softCoverage,
  softStepIndex,
  SOFT_RANGE_PER_PX,
  SOFT_STEPS,
} from "../fill";
import { distanceToMask } from "../mask-ops";

const row = (bits: number[]) => Uint8Array.from(bits);
const cover = (dist: number[], region: number[], tol: number, soft: number) => [
  ...softCoverage(row(dist), dist.length, 1, row(region), tol, soft),
];

describe("softCoverage", () => {
  it("fades into a line's soft edge by how faint it is there", () => {
    // region | line edge getting darker | ridge | far side | empty
    const c = cover([0, 0, 40, 96, 200, 120, 0], [1, 1, 0, 0, 0, 0, 0], 32, 1);
    expect(c.slice(0, 2)).toEqual([255, 255]);
    expect(c[2]).toBe(Math.round(255 * (1 - 8 / SOFT_RANGE_PER_PX))); // faint: mostly filled
    expect(c[3]).toBe(0); // at tol + range: none
    expect(c.slice(4)).toEqual([0, 0, 0]);
  });

  it("follows sub-pixel position: a fainter edge pixel gets more fill", () => {
    const a = cover([0, 40], [1, 0], 32, 1)[1];
    const b = cover([0, 70], [1, 0], 32, 1)[1];
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0);
  });

  it("never passes the line's darkest pixel nor crosses a break", () => {
    // Falling side past the ridge is out, even when faint.
    expect(cover([0, 60, 50, 40], [1, 0, 0, 0], 32, 2).slice(2)).toEqual([0, 0]);
    expect(cover([0, 0, 0], [1, 0, 0], 32, 2)).toEqual([255, 0, 0]);
  });

  it("is the region alone at Soft 0, and reaches further at a higher Soft", () => {
    expect(cover([0, 40, 60], [1, 0, 0], 32, 0)).toEqual([255, 0, 0]);
    expect(cover([0, 40, 120], [1, 0, 0], 32, 1)[2]).toBe(0);
    expect(cover([0, 40, 120], [1, 0, 0], 32, 2)[2]).toBeGreaterThan(0);
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
