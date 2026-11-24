import { describe, it, expect } from "vitest";
import {
  allSlots,
  parseSlot,
  parseTypes,
  PAINT_TYPES,
  readSlot,
  resetTypeColours,
  seedTypes,
  slotFor,
  swapSlots,
  switchType,
  typesForSave,
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

const blend: StrokeSlot = {
  brushType: "blend",
  size: 40,
  opacity: 80,
  smoothing: 0,
  streamline: 30,
  sizeRange: 3,
};

function liveFrom(s: StrokeSlot): LiveStroke {
  return {
    brushType: s.brushType,
    sizeRange: s.sizeRange,
    streamline: s.streamline,
    brushSettings: { size: s.size, opacity: s.opacity, smoothing: s.smoothing, color: "#000000" },
  };
}

describe("slotFor", () => {
  it("gives the eraser and Blend their own slots and everything else the brush slot", () => {
    expect(slotFor("eraser")).toBe("eraser");
    expect(slotFor("blend")).toBe("blend");
    for (const t of ["brush", "fill", "select", "eyedropper"]) {
      expect(slotFor(t)).toBe("brush");
    }
  });
});

describe("swapSlots", () => {
  it("loads the eraser values and parks the brush values", () => {
    const live = liveFrom(brush);
    const slots = { brush: { ...brush }, eraser: { ...eraser }, blend: { ...blend } };
    live.brushSettings.size = 12; // edited while brush was active
    swapSlots(live, slots, "brush", "eraser");
    expect(readSlot(live)).toEqual(eraser);
    expect(slots.brush.size).toBe(12);
  });

  it("round-trips brush → eraser → brush", () => {
    const live = liveFrom(brush);
    const slots = { brush: { ...brush }, eraser: { ...eraser }, blend: { ...blend } };
    swapSlots(live, slots, "brush", "eraser");
    live.brushSettings.opacity = 30; // edited while eraser was active
    swapSlots(live, slots, "eraser", "brush");
    expect(readSlot(live)).toEqual(brush);
    expect(slots.eraser.opacity).toBe(30);
  });

  it("does nothing between tools that share the brush slot", () => {
    const live = liveFrom(brush);
    const slots = { brush: { ...brush, size: 99 }, eraser: { ...eraser }, blend: { ...blend } };
    swapSlots(live, slots, "brush", "fill");
    expect(readSlot(live)).toEqual(brush);
    expect(slots.brush.size).toBe(99);
  });

  it("switching from fill to eraser parks the values into the brush slot", () => {
    const live = liveFrom(brush);
    const slots = { brush: { ...brush }, eraser: { ...eraser }, blend: { ...blend } };
    swapSlots(live, slots, "fill", "eraser");
    expect(slots.brush).toEqual(brush);
    expect(readSlot(live)).toEqual(eraser);
  });
});

describe("Blend's slot", () => {
  it("round-trips brush → blend → eraser → brush, each keeping its own values", () => {
    const live = liveFrom(brush);
    const slots = { brush: { ...brush }, eraser: { ...eraser }, blend: { ...blend } };
    swapSlots(live, slots, "brush", "blend");
    expect(readSlot(live)).toEqual(blend);
    live.brushSettings.size = 60; // edited while Blend was active
    swapSlots(live, slots, "blend", "eraser");
    expect(readSlot(live)).toEqual(eraser);
    expect(slots.blend.size).toBe(60);
    swapSlots(live, slots, "eraser", "brush");
    expect(readSlot(live)).toEqual(brush);
  });

  it("a saved slot can't make the brush or eraser blend", () => {
    expect(parseSlot({ ...eraser, brushType: "blend" }, eraser).brushType).toBe("pencil");
  });
});

describe("allSlots", () => {
  it("folds the live values into the active tool's slot", () => {
    const live = liveFrom(eraser);
    const slots = { brush: { ...brush }, eraser: { ...brush }, blend: { ...blend } }; // eraser stale
    expect(allSlots(live, slots, "eraser")).toEqual({ brush, eraser, blend });
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

const linear = { cp1: { x: 0.25, y: 0.25 }, cp2: { x: 0.75, y: 0.75 } };
const soft = { cp1: { x: 0.1, y: 0.6 }, cp2: { x: 0.4, y: 0.9 } };

describe("switchType", () => {
  it("parks the outgoing type's values and curve and loads the incoming type's", () => {
    const store = seedTypes(brush, linear, "#000000");
    const live = liveFrom({ ...brush, brushType: "ink" });
    const curve = { cp1: { ...linear.cp1 }, cp2: { ...linear.cp2 } };
    // Tune Ink, then switch to Watercolour: Watercolour still has the seeded values.
    live.brushSettings.size = 12;
    live.streamline = 80;
    curve.cp1 = { ...soft.cp1 };
    switchType(live, curve, store, "watercolor", true);
    expect(readSlot(live)).toEqual({ ...brush, brushType: "watercolor" });
    expect(curve).toEqual(linear);
    expect(store.ink.size).toBe(12);
    expect(store.ink.streamline).toBe(80);
    expect(store.ink.curve.cp1).toEqual(soft.cp1);
    // Back to Ink: its tuning returns.
    switchType(live, curve, store, "ink", true);
    expect(live.brushType).toBe("ink");
    expect(live.brushSettings.size).toBe(12);
    expect(live.streamline).toBe(80);
    expect(curve.cp1).toEqual(soft.cp1);
  });

  it("parks and brings back each type's colour", () => {
    const store = seedTypes(brush, linear, "#000000");
    const live = liveFrom({ ...brush, brushType: "ink" });
    const curve = { cp1: { ...linear.cp1 }, cp2: { ...linear.cp2 } };
    live.brushSettings.color = "#3366ff";
    switchType(live, curve, store, "watercolor", true);
    expect(live.brushSettings.color).toBe("#000000");
    live.brushSettings.color = "#aa0000";
    switchType(live, curve, store, "ink", true);
    expect(live.brushSettings.color).toBe("#3366ff");
    expect(store.watercolor.color).toBe("#aa0000");
  });

  it("leaves the colour alone without withColour", () => {
    const store = seedTypes(brush, linear, "#000000");
    const live = liveFrom({ ...brush, brushType: "ink" });
    live.brushSettings.color = "#3366ff";
    switchType(live, { cp1: { ...linear.cp1 }, cp2: { ...linear.cp2 } }, store, "dry", false);
    expect(live.brushSettings.color).toBe("#3366ff");
  });

  it("does not share curve points with the store", () => {
    const store = seedTypes(brush, linear, "#000000");
    const live = liveFrom({ ...brush, brushType: "ink" });
    const curve = { cp1: { ...linear.cp1 }, cp2: { ...linear.cp2 } };
    switchType(live, curve, store, "pencil", true);
    curve.cp1.x = 0.9;
    expect(store.pencil.curve.cp1.x).toBe(0.25);
  });

  it("does nothing for the same type", () => {
    const store = seedTypes(brush, linear, "#000000");
    const live = liveFrom(brush);
    live.brushSettings.size = 99;
    switchType(live, { ...linear }, store, "smooth", true);
    expect(live.brushSettings.size).toBe(99);
    expect(store.smooth.size).toBe(brush.size);
  });
});

describe("resetTypeColours", () => {
  it("gives every type the colour", () => {
    const store = seedTypes(brush, linear, "#000000");
    store.ink.color = "#ff0000";
    resetTypeColours(store, "#00ff00");
    for (const t of PAINT_TYPES) expect(store[t].color).toBe("#00ff00");
  });
});

describe("typesForSave", () => {
  it("folds the brush's current values in under its type", () => {
    const store = seedTypes(brush, linear, "#000000");
    const out = typesForSave(store, { ...brush, brushType: "dry", size: 30 }, soft, "#ff0000");
    expect(out.dry.size).toBe(30);
    expect(out.dry.color).toBe("#ff0000");
    expect(out.smooth.color).toBe("#000000");
    expect(out.dry.curve).toEqual(soft);
    expect(out.smooth.size).toBe(brush.size);
    expect(store.dry.size).toBe(brush.size);
  });
});

describe("parseTypes", () => {
  const fallback = seedTypes(brush, linear, "#000000");

  it("keeps the fallback for missing or broken data", () => {
    expect(parseTypes(undefined, fallback)).toEqual(fallback);
    expect(parseTypes("x", fallback)).toEqual(fallback);
    expect(parseTypes({ ink: 3, blend: { size: 9 } }, fallback)).toEqual(fallback);
  });

  it("reads valid fields and clamps curve points into the square", () => {
    const out = parseTypes(
      {
        ink: { size: 9, opacity: "a", curve: { cp1: { x: 2, y: -1 }, cp2: { x: NaN, y: 0 } } },
      },
      fallback,
    );
    expect(out.ink).toEqual({
      ...fallback.ink,
      size: 9,
      curve: { cp1: { x: 1, y: 0 }, cp2: linear.cp2 },
    });
    expect(out.smooth).toEqual(fallback.smooth);
  });

  it("reads a hex colour and keeps the fallback for anything else", () => {
    const out = parseTypes(
      { ink: { color: "#12AbCd" }, dry: { color: "red" }, pencil: { color: 5 } },
      fallback,
    );
    expect(out.ink.color).toBe("#12AbCd");
    expect(out.dry.color).toBe("#000000");
    expect(out.pencil.color).toBe("#000000");
  });
});
