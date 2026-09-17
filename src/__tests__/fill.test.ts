import { describe, it, expect } from "vitest";
import { hexToRgba, rgbToHex } from "../fill";

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
