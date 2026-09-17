import { describe, it, expect } from "vitest";
import { PASTE_OFFSET, placeExternalImage, placeInternalPaste } from "../paste";

describe("placeExternalImage", () => {
  it("centres a small image at its own size", () => {
    expect(placeExternalImage(100, 50, 1000, 500)).toEqual({ x: 450, y: 225, w: 100, h: 50 });
  });

  it("scales a too-large image down to fit, keeping aspect", () => {
    const r = placeExternalImage(4000, 1000, 2000, 1000);
    expect(r).toEqual({ x: 0, y: 250, w: 2000, h: 500 });
  });

  it("never scales up", () => {
    expect(placeExternalImage(10, 10, 1000, 1000).w).toBe(10);
  });
});

describe("placeInternalPaste", () => {
  it("offsets the paste from the copied spot", () => {
    expect(placeInternalPaste({ x: 10, y: 20, w: 50, h: 50 }, 1000, 1000)).toEqual({
      x: 10 + PASTE_OFFSET,
      y: 20 + PASTE_OFFSET,
      w: 50,
      h: 50,
    });
  });

  it("keeps a paste at the bottom-right edge on the page", () => {
    expect(placeInternalPaste({ x: 950, y: 950, w: 50, h: 50 }, 1000, 1000)).toEqual({
      x: 950,
      y: 950,
      w: 50,
      h: 50,
    });
  });

  it("pins a copy wider than the page to the left edge", () => {
    expect(placeInternalPaste({ x: 0, y: 0, w: 2000, h: 10 }, 1000, 1000).x).toBe(0);
  });
});
