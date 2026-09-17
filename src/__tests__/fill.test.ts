import { describe, it, expect } from "vitest";
import { hexToRgba, rgbToHex, sameImageData } from "../fill";

describe("hexToRgba", () => {
  it("parses black at full opacity", () => {
    const c = hexToRgba("#000000", 100);
    expect(c).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  });

  it("parses white at full opacity", () => {
    const c = hexToRgba("#ffffff", 100);
    expect(c).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  it("parses red", () => {
    const c = hexToRgba("#ff0000", 100);
    expect(c).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it("handles half opacity", () => {
    const c = hexToRgba("#000000", 50);
    expect(c.a).toBe(128);
  });

  it("handles zero opacity", () => {
    const c = hexToRgba("#ffffff", 0);
    expect(c.a).toBe(0);
  });

  it("parses hex colors correctly", () => {
    const c = hexToRgba("#1a2b3c", 100);
    expect(c.r).toBe(0x1a);
    expect(c.g).toBe(0x2b);
    expect(c.b).toBe(0x3c);
  });
});

describe("rgbToHex", () => {
  it("pads each channel to two digits", () => {
    expect(rgbToHex(0, 10, 255)).toBe("#000aff");
  });

  it("round-trips with hexToRgba", () => {
    const { r, g, b } = hexToRgba("#1a2b3c", 100);
    expect(rgbToHex(r, g, b)).toBe("#1a2b3c");
  });
});

describe("sameImageData", () => {
  const img = (...v: number[]) => ({ data: new Uint8ClampedArray(v) }) as ImageData;

  it("is true for identical pixels", () => {
    expect(sameImageData(img(1, 2, 3, 4), img(1, 2, 3, 4))).toBe(true);
  });

  it("is false when any byte differs", () => {
    expect(sameImageData(img(1, 2, 3, 4), img(1, 2, 3, 5))).toBe(false);
  });

  it("is false for different sizes", () => {
    expect(sameImageData(img(1, 2, 3, 4), img(1, 2, 3, 4, 5, 6, 7, 8))).toBe(false);
  });
});
