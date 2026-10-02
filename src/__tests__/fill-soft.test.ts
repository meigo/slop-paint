import { describe, it, expect } from "vitest";
import { featherMask } from "../fill";

/** A w×h mask with a filled rect [x0, x1) × [y0, y1). */
function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const m = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
  return m;
}

describe("featherMask", () => {
  it("is the mask as 0/255 at radius 0", () => {
    const m = rect(6, 6, 1, 1, 4, 4);
    const c = featherMask(m, 6, 6, 0);
    expect(c[2 * 6 + 2]).toBe(255);
    expect(c[0]).toBe(0);
  });

  it("keeps the whole region solid and softens only outside it, at radius 1", () => {
    const w = 20;
    const c = featherMask(rect(w, w, 5, 5, 15, 15), w, w, 1);
    expect(c[10 * w + 10]).toBe(255); // deep inside
    expect(c[10 * w + 5]).toBe(255); // the region's own edge pixel: no pale ring by the line
    expect(c[10 * w + 4]).toBe(85); // just outside: 1/3
    expect(c[10 * w + 3]).toBe(0);
    expect(c[4 * w + 4]).toBe(28); // the corner outside: 1/9
  });

  it("spreads further at a larger radius", () => {
    const w = 30;
    const m = rect(w, w, 10, 10, 20, 20);
    const one = featherMask(m, w, w, 1);
    const three = featherMask(m, w, w, 3);
    expect(one[15 * w + 8]).toBe(0);
    expect(three[15 * w + 8]).toBeGreaterThan(0);
    expect(three[15 * w + 15]).toBe(255);
  });

  it("handles the canvas edge (pixels past it count as unfilled)", () => {
    const c = featherMask(rect(6, 1, 0, 0, 3, 1), 6, 1, 1);
    expect([...c]).toEqual([255, 255, 255, 28, 0, 0]); // a 1-px-high strip sees 1 of 9
  });
});
