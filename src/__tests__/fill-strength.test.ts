import { describe, it, expect } from "vitest";
import { bucketStrength, fillMask, ridgeCoverage } from "../fill";

/** RGBA pixels of a w×h image, every pixel `bg`, with `paint(x, y)` overriding. */
function image(
  w: number,
  h: number,
  paint: (x: number, y: number) => number[] | null,
): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = paint(x, y) ?? [0, 0, 0, 0];
      d.set(p, (y * w + x) * 4);
    }
  }
  return d;
}

const coverAt = (d: Uint8ClampedArray, w: number, h: number, sx: number, sy: number) => {
  const i = (sy * w + sx) * 4;
  const seed = { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
  const region = fillMask(d, w, h, sx, sy, 32, 0)!;
  return { region, cover: ridgeCoverage(bucketStrength(d, w, h, seed, 32), w, h, region, 32, 1) };
};

describe("bucketStrength (the line strength Soft reads)", () => {
  it("recolouring a painted area on a transparent layer fills nothing around it", () => {
    // a red 20×20 square in an 80×80 transparent layer, tapped inside
    const w = 80;
    const d = image(w, w, (x, y) =>
      x >= 30 && x < 50 && y >= 30 && y < 50 ? [255, 0, 0, 255] : null,
    );
    const { cover } = coverAt(d, w, w, 40, 40);
    let outside = 0;
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const inSquare = x >= 30 && x < 50 && y >= 30 && y < 50;
        if (!inSquare && cover[y * w + x] > 0) outside++;
      }
    }
    expect(outside).toBe(0);
  });

  it("a faint pixel whose colour drifted (walled off by the flood) still gets fill behind it", () => {
    // empty region on the left, then a faint grey pixel (46,46,46,11) as WebKit reads a Pencil
    // line's faintest edge, then a LIGHT line (alpha 40, as a 4H pencil)
    const w = 40;
    const d = image(w, 10, (x) =>
      x === 20 ? [46, 46, 46, 11] : x >= 21 && x < 25 ? [30, 30, 30, 40] : null,
    );
    const { region, cover } = coverAt(d, w, 10, 5, 5);
    expect(region[5 * w + 20]).toBe(0); // the flood walls it off
    expect(cover[5 * w + 20]).toBeGreaterThan(0); // but the fill goes behind it
  });

  it("is the alpha alone from an empty tap, and never more than the pixel's alpha", () => {
    const d = Uint8ClampedArray.from([255, 0, 0, 100, 0, 0, 0, 0]);
    expect([...bucketStrength(d, 2, 1, { r: 0, g: 0, b: 0, a: 0 }, 32)]).toEqual([100, 0]);
    expect([...bucketStrength(d, 2, 1, { r: 0, g: 0, b: 255, a: 255 }, 32)]).toEqual([100, 0]);
  });
});
