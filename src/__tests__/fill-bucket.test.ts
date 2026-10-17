import { describe, it, expect } from "vitest";
import { floodFill } from "../fill";

/** A context over `data` with just what `floodFill` needs without Expand. */
function fakeCtx(w: number, h: number, data: Uint8ClampedArray) {
  return {
    canvas: { width: w, height: h },
    getImageData: () => ({ data: new Uint8ClampedArray(data), width: w, height: h }),
    putImageData: (img: { data: Uint8ClampedArray }) => data.set(img.data),
  } as unknown as CanvasRenderingContext2D;
}
const BLUE = { r: 0, g: 0, b: 255, a: 255 };
const HARD = { tolerance: 32, expand: 0, softEdge: 0, gap: 0 };
const W = 10;
const at = (d: Uint8ClampedArray, x: number, y: number) => [
  ...d.slice((y * W + x) * 4, (y * W + x) * 4 + 4),
];

describe("floodFill: where a tap lands", () => {
  it("seeds from the pixel the tap is inside, not the nearest pixel corner", () => {
    // A black line at x = 5; the tap at 4.6 is inside empty pixel 4.
    const d = new Uint8ClampedArray(W * W * 4);
    for (let y = 0; y < W; y++) d.set([0, 0, 0, 255], (y * W + 5) * 4);
    floodFill(fakeCtx(W, W, d), 4.6, 3.2, BLUE, HARD);
    expect(at(d, 4, 3)).toEqual([0, 0, 255, 255]);
    expect(at(d, 5, 3)).toEqual([0, 0, 0, 255]);
  });

  it("fills from the far half of the last column and row", () => {
    const d = new Uint8ClampedArray(W * W * 4);
    floodFill(fakeCtx(W, W, d), W - 0.4, W - 0.3, BLUE, HARD);
    expect(at(d, 0, 0)).toEqual([0, 0, 255, 255]);
  });
});

describe("floodFill: the same-colour check", () => {
  it("fills an empty area with a faint dark colour", () => {
    const d = new Uint8ClampedArray(W * W * 4);
    floodFill(fakeCtx(W, W, d), 3, 3, { r: 0, g: 0, b: 0, a: 20 }, HARD);
    expect(at(d, 3, 3)).toEqual([0, 0, 0, 20]);
  });

  it("still skips a painted area already within tolerance of the colour", () => {
    const d = new Uint8ClampedArray(W * W * 4);
    for (let i = 0; i < W * W; i++) d.set([10, 0, 250, 255], i * 4);
    floodFill(fakeCtx(W, W, d), 3, 3, BLUE, HARD);
    expect(at(d, 3, 3)).toEqual([10, 0, 250, 255]);
  });
});
