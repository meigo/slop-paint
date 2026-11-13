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

describe("dilating and eroding by distance", () => {
  // What Bridge does since 2026-11-13 (fillMask, fillEnclosed): the round morphology in linear time.
  const random = (w: number, h: number, seed: number, density: number) => {
    const m = new Uint8Array(w * h);
    let a = seed;
    for (let i = 0; i < w * h; i++) {
      a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
      m[i] = a / 4294967296 < density ? 1 : 0;
    }
    return m;
  };

  it("`distance to the mask ≤ r` is dilateMask", () => {
    for (const r of [1, 2, 3, 5, 8]) {
      for (let seed = 1; seed <= 4; seed++) {
        const m = random(37, 29, seed, 0.02 * seed);
        const d = distanceToMask(m, 37, 29);
        expect(Array.from(d, (v) => (v <= r ? 1 : 0))).toEqual([...dilateMask(m, 37, 29, r)]);
      }
    }
  });

  it("`distance to the clear pixels > r` is erodeMask, given a clear border", () => {
    for (const r of [1, 2, 3, 5, 8]) {
      for (let seed = 1; seed <= 4; seed++) {
        const w = 41;
        const h = 33;
        // mostly set, with holes; the border ring clear (as fillEnclosed's padding guarantees)
        const m = random(w, h, seed, 1 - 0.01 * seed);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++)
            if (x === 0 || y === 0 || x === w - 1 || y === h - 1) m[y * w + x] = 0;
        const clear = m.map((v) => (v ? 0 : 1));
        const d = distanceToMask(clear, w, h);
        expect(Array.from(d, (v) => (v > r ? 1 : 0))).toEqual([...erodeMask(m, w, h, r)]);
      }
    }
  });

  it("works the same in an Int32 grid as in a Float64 one", () => {
    const m = random(50, 40, 9, 0.01);
    const a = distanceToMask(m, 50, 40, {
      grid: new Int32Array(2000),
      out: new Float32Array(2000),
    });
    const b = distanceToMask(m, 50, 40, {
      grid: new Float64Array(2000),
      out: new Float32Array(2000),
    });
    expect(Array.from(a)).toEqual(Array.from(b));
    // a column with nothing in it, and an empty mask
    const col = new Uint8Array(12);
    col[0] = 1;
    expect(Array.from(distanceToMask(col, 4, 3))).toEqual(
      [
        0,
        1,
        2,
        3,
        1,
        Math.SQRT2,
        Math.sqrt(5),
        Math.sqrt(10),
        2,
        Math.sqrt(5),
        Math.sqrt(8),
        Math.sqrt(13),
      ].map(Math.fround),
    );
    expect(distanceToMask(new Uint8Array(12), 4, 3).every((v) => v === Infinity)).toBe(true);
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
