import { describe, it, expect } from "vitest";
import { colourDistance, softCoverage, SOFT_RANGE_PER_PX } from "../fill";

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
