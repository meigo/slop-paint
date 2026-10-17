import { describe, it, expect } from "vitest";
import { dilateMask, distanceToMask, erodeMask } from "../mask-ops";

/** Build a mask from ASCII art: '#' set, anything else clear. */
function grid(rows: string[]): { m: Uint8Array; w: number; h: number } {
  const h = rows.length,
    w = rows[0].length;
  const m = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => (m[y * w + x] = c === "#" ? 1 : 0)));
  return { m, w, h };
}
const count = (m: Uint8Array) => m.reduce((n, v) => n + v, 0);

describe("dilateMask", () => {
  it("radius 0 is the identity", () => {
    const { m, w, h } = grid(["...", ".#.", "..."]);
    expect([...dilateMask(m, w, h, 0)]).toEqual([...m]);
  });

  it("radius 1 grows a single pixel into a plus (circular structuring element)", () => {
    const { m, w, h } = grid([".....", ".....", "..#..", ".....", "....."]);
    const d = dilateMask(m, w, h, 1);
    expect(count(d)).toBe(5); // centre + 4 orthogonal; the diagonals are at distance √2 > 1
    expect(d[2 * w + 2]).toBe(1);
    expect(d[1 * w + 2]).toBe(1);
    expect(d[1 * w + 1]).toBe(0);
  });

  it("clips at the bitmap edge rather than wrapping", () => {
    const { m, w, h } = grid(["#..", "...", "..."]);
    const d = dilateMask(m, w, h, 1);
    expect(count(d)).toBe(3); // (0,0), (1,0), (0,1) — the rest is off-grid
  });
});

describe("erodeMask", () => {
  it("radius 0 is the identity", () => {
    const { m, w, h } = grid(["###", "###", "###"]);
    expect([...erodeMask(m, w, h, 0)]).toEqual([...m]);
  });

  it("removes any pixel whose neighbourhood is not fully set", () => {
    const { m, w, h } = grid([".....", ".###.", ".###.", ".###.", "....."]);
    const e = erodeMask(m, w, h, 1);
    expect(count(e)).toBe(1); // only the centre keeps a full plus
    expect(e[2 * w + 2]).toBe(1);
  });

  it("treats off-grid as CLEAR, so a shape flush to the edge erodes there", () => {
    const { m, w, h } = grid(["###", "###", "###"]);
    expect(count(erodeMask(m, w, h, 1))).toBe(1); // only the centre survives
  });

  it("is the inverse of dilate for a shape with room around it", () => {
    const { m, w, h } = grid([".....", ".....", "..#..", ".....", "....."]);
    const round = erodeMask(dilateMask(m, w, h, 1), w, h, 1);
    expect([...round]).toEqual([...m]);
  });
});

describe("distanceToMask with work arrays", () => {
  it("gives the same distances in reused arrays, and returns a view of them", () => {
    const w = 7;
    const h = 5;
    const mask = new Uint8Array(w * h);
    mask[2 * w + 3] = 1;
    const buf = { grid: new Float64Array(100), out: new Float32Array(100) };
    buf.grid.fill(123); // left over from an earlier call
    const d = distanceToMask(mask, w, h, buf);
    expect(Array.from(d)).toEqual(Array.from(distanceToMask(mask, w, h)));
    expect(d.buffer).toBe(buf.out.buffer);
    // Too small: works in fresh arrays instead.
    const small = { grid: new Float64Array(4), out: new Float32Array(4) };
    expect(distanceToMask(mask, w, h, small)).toHaveLength(w * h);
  });
});
