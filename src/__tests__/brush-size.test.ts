import { describe, expect, it } from "vitest";
import {
  SIZE_MAX,
  SIZE_SLIDER_STEPS,
  parseSize,
  sizeToSlider,
  sliderToSize,
  snapSize,
  stepSize,
} from "../brush-size";

describe("brush size", () => {
  it("the slider spans 1–SIZE_MAX, and 1–80 keeps most of it", () => {
    expect(sliderToSize(0)).toBe(1);
    expect(sliderToSize(SIZE_SLIDER_STEPS)).toBe(SIZE_MAX);
    expect(sizeToSlider(80) / SIZE_SLIDER_STEPS).toBeGreaterThan(0.65);
  });

  it("every preset and snapped size survives a round trip through the slider", () => {
    for (const s of [1, 2, 3, 5, 8, 12, 20, 40, 80, 150, 300, 500])
      expect(sliderToSize(sizeToSlider(s))).toBe(s);
  });

  it("snaps to halves below 10 and whole px above, inside the range", () => {
    expect(snapSize(2.3)).toBe(2.5);
    expect(snapSize(12.4)).toBe(12);
    expect(snapSize(0)).toBe(1);
    expect(snapSize(9000)).toBe(SIZE_MAX);
  });

  it("[ and ] step by about a tenth, at least 1, within the range", () => {
    expect(stepSize(20, 1)).toBe(22);
    expect(stepSize(300, 1)).toBe(330);
    expect(stepSize(300, -1)).toBe(270);
    expect(stepSize(3, -1)).toBe(2);
    expect(stepSize(1, -1)).toBe(1);
    expect(stepSize(SIZE_MAX, 1)).toBe(SIZE_MAX);
  });

  it("a typed size is snapped, or refused with a reason", () => {
    expect(parseSize("250")).toBe(250);
    expect(parseSize("2,5")).toBe(2.5);
    expect(parseSize("0")).toMatch(/1–500/);
    expect(parseSize("600")).toMatch(/1–500/);
    expect(typeof parseSize("abc")).toBe("string");
  });
});
