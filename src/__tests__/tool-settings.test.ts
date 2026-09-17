import { describe, it, expect } from "vitest";
import {
  allSlots,
  parseSlot,
  readSlot,
  slotFor,
  swapSlots,
  type LiveStroke,
  type StrokeSlot,
} from "../tool-settings";

const brush: StrokeSlot = {
  brushType: "smooth",
  size: 4,
  opacity: 100,
  smoothing: 50,
  streamline: 50,
  sizeRange: 1,
};
const eraser: StrokeSlot = {
  brushType: "pencil",
  size: 20,
  opacity: 60,
  smoothing: 10,
  streamline: 0,
  sizeRange: 2,
};

function liveFrom(s: StrokeSlot): LiveStroke {
  return {
    brushType: s.brushType,
    sizeRange: s.sizeRange,
    streamline: s.streamline,
    brushSettings: { size: s.size, opacity: s.opacity, smoothing: s.smoothing },
  };
}

describe("slotFor", () => {
  it("gives the eraser its own slot and everything else the brush slot", () => {
    expect(slotFor("eraser")).toBe("eraser");
    for (const t of ["brush", "fill", "select", "lasso", "eyedropper"]) {
      expect(slotFor(t)).toBe("brush");
    }
  });
});

describe("swapSlots", () => {
  it("loads the eraser values and parks the brush values", () => {
    const live = liveFrom(brush);
    const slots = { brush: { ...brush }, eraser: { ...eraser } };
    live.brushSettings.size = 12; // edited while brush was active
    swapSlots(live, slots, "brush", "eraser");
    expect(readSlot(live)).toEqual(eraser);
    expect(slots.brush.size).toBe(12);
  });

  it("round-trips brush → eraser → brush", () => {
    const live = liveFrom(brush);
    const slots = { brush: { ...brush }, eraser: { ...eraser } };
    swapSlots(live, slots, "brush", "eraser");
    live.brushSettings.opacity = 30; // edited while eraser was active
    swapSlots(live, slots, "eraser", "brush");
    expect(readSlot(live)).toEqual(brush);
    expect(slots.eraser.opacity).toBe(30);
  });

  it("does nothing between tools that share the brush slot", () => {
    const live = liveFrom(brush);
    const slots = { brush: { ...brush, size: 99 }, eraser: { ...eraser } };
    swapSlots(live, slots, "brush", "fill");
    expect(readSlot(live)).toEqual(brush);
    expect(slots.brush.size).toBe(99);
  });

  it("switching from fill to eraser parks the values into the brush slot", () => {
    const live = liveFrom(brush);
    const slots = { brush: { ...brush }, eraser: { ...eraser } };
    swapSlots(live, slots, "fill", "eraser");
    expect(slots.brush).toEqual(brush);
    expect(readSlot(live)).toEqual(eraser);
  });
});

describe("allSlots", () => {
  it("folds the live values into the active tool's slot", () => {
    const live = liveFrom(eraser);
    const slots = { brush: { ...brush }, eraser: { ...brush } }; // eraser slot is stale while active
    expect(allSlots(live, slots, "eraser")).toEqual({ brush, eraser });
  });
});

describe("parseSlot", () => {
  it("accepts a valid slot", () => {
    expect(parseSlot({ ...eraser }, brush)).toEqual(eraser);
  });

  it("falls back for missing or malformed input", () => {
    expect(parseSlot(undefined, brush)).toEqual(brush);
    expect(parseSlot("nope", brush)).toEqual(brush);
    expect(parseSlot({ size: "big", brushType: "crayon", opacity: NaN }, brush)).toEqual(brush);
  });

  it("keeps valid fields from a partial slot", () => {
    expect(parseSlot({ size: 30 }, brush)).toEqual({ ...brush, size: 30 });
  });
});
