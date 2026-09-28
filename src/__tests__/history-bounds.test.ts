import { describe, it, expect } from "vitest";
import { DEFAULT_HISTORY_BYTES, UNDO_TILE, changedTiles, cropPixels } from "../history";

const W = 20;
const H = 10;
const blank = (w = W, h = H) => new Uint8ClampedArray(w * h * 4);
function paint(buf: Uint8ClampedArray, x: number, y: number, w = W) {
  buf[(y * w + x) * 4 + 3] = 255;
}

describe("changedTiles", () => {
  it("is empty for identical buffers", () => {
    expect(changedTiles(blank(), blank(), W, H, 8)).toEqual([]);
  });

  it("finds the tile of a single pixel", () => {
    const b = blank();
    paint(b, 9, 3);
    expect(changedTiles(blank(), b, W, H, 8)).toEqual([{ x: 8, y: 0, w: 8, h: 8 }]);
  });

  it("clips the edge tiles to the buffer", () => {
    const b = blank();
    paint(b, 19, 9);
    expect(changedTiles(blank(), b, W, H, 8)).toEqual([{ x: 16, y: 8, w: 4, h: 2 }]);
  });

  it("lists only the tiles touched, in row order", () => {
    const b = blank();
    paint(b, 1, 1);
    paint(b, 17, 2);
    paint(b, 10, 9);
    expect(changedTiles(blank(), b, W, H, 8)).toEqual([
      { x: 0, y: 0, w: 8, h: 8 },
      { x: 16, y: 0, w: 4, h: 8 },
      { x: 8, y: 8, w: 8, h: 2 },
    ]);
  });

  it("sees a change in any channel", () => {
    const b = blank();
    b[(4 * W + 9) * 4 + 1] = 1; // green of (9, 4)
    expect(changedTiles(blank(), b, W, H, 8)).toEqual([{ x: 8, y: 0, w: 8, h: 8 }]);
  });
});

describe("cropPixels", () => {
  it("copies the rectangle row by row", () => {
    const src = new Uint8ClampedArray(W * H * 4).map((_, i) => i % 251);
    const r = { x: 3, y: 2, w: 4, h: 3 };
    const out = cropPixels(src, W, r);
    expect(out.length).toBe(4 * 3 * 4);
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w * 4; x++)
        expect(out[y * r.w * 4 + x]).toBe(src[((r.y + y) * W + r.x) * 4 + x]);
  });
});

describe("the budget with tiled steps", () => {
  it("holds 50 page-crossing strokes on a 1920×1080 doc at dpr 2", () => {
    // A 16 px (doc) line corner to corner, at dpr 2: 3840×2160 canvas px, 32 px wide.
    const w = 3840;
    const h = 2160;
    const a = blank(w, h);
    const b = blank(w, h);
    for (let i = 0; i < 4000; i++) {
      const x = Math.round((i / 4000) * (w - 33));
      const y = Math.round((i / 4000) * (h - 33));
      for (let d = 0; d < 32; d++) paint(b, x + d, y + d, w);
    }
    const tiles = changedTiles(a, b, w, h);
    const perStroke = tiles.reduce((s, r) => s + r.w * r.h * 4 * 2, 0);
    expect(tiles.length).toBeLessThan((w / UNDO_TILE) * (h / UNDO_TILE) * 0.1);
    expect(Math.floor(DEFAULT_HISTORY_BYTES / perStroke)).toBeGreaterThanOrEqual(50);
    // what a whole-layer step cost: ~4 steps
    expect(Math.floor(DEFAULT_HISTORY_BYTES / (w * h * 4 * 2))).toBe(4);
  });
});
