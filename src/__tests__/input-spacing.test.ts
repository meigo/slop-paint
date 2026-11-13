import { describe, expect, it } from "vitest";
import { interpolationSpacing } from "../input";

describe("interpolationSpacing", () => {
  it("is 4 canvas px at 100% and above, as strokes always were", () => {
    for (const zoom of [1, 1.5, 4, 20]) expect(interpolationSpacing(zoom)).toBe(4);
  });

  it("is 4 px on screen when zoomed out, up to 16 canvas px", () => {
    expect(interpolationSpacing(0.5)).toBe(8);
    expect(interpolationSpacing(0.25)).toBe(16);
    expect(interpolationSpacing(0.1)).toBe(16);
  });

  it("falls back to 4 for a zoom that isn't one", () => {
    for (const zoom of [0, -1, NaN]) expect(interpolationSpacing(zoom)).toBe(4);
  });
});
