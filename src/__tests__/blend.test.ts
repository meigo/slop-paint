import { describe, it, expect } from "vitest";
import { BLEND_MODES, blendLabel, canDraw, canvasOp, layerBlendFromPsd } from "../blend";

describe("blend modes", () => {
  it("offers the five, by Photoshop name", () => {
    expect(BLEND_MODES.map((b) => b.label)).toEqual([
      "Normal",
      "Multiply",
      "Screen",
      "Overlay",
      "Add",
    ]);
    expect(BLEND_MODES.map((b) => b.psd)).toEqual([
      "normal",
      "multiply",
      "screen",
      "overlay",
      "linear dodge",
    ]);
  });

  it("draws each through the canvas's own operation", () => {
    expect(canvasOp(undefined)).toBe("source-over");
    expect(canvasOp("normal")).toBe("source-over");
    expect(canvasOp("multiply")).toBe("multiply");
    expect(canvasOp("screen")).toBe("screen");
    expect(canvasOp("overlay")).toBe("overlay");
    expect(canvasOp("linear dodge")).toBe("lighter"); // Add
  });

  it("draws a PSD's other modes when the canvas has them, else as normal", () => {
    expect(canvasOp("soft light")).toBe("soft-light");
    expect(canvasOp("color dodge")).toBe("color-dodge");
    expect(canDraw("soft light")).toBe(true);
    expect(canvasOp("vivid light")).toBe("source-over");
    expect(canDraw("vivid light")).toBe(false);
  });

  it("labels the five by their menu names and others by their own", () => {
    expect(blendLabel(undefined)).toBe("Normal");
    expect(blendLabel("linear dodge")).toBe("Add");
    expect(blendLabel("soft light")).toBe("Soft light");
  });

  it("stores normal (and a group's pass through) as no mode", () => {
    expect(layerBlendFromPsd(undefined)).toBeUndefined();
    expect(layerBlendFromPsd("normal")).toBeUndefined();
    expect(layerBlendFromPsd("pass through")).toBeUndefined();
    expect(layerBlendFromPsd("multiply")).toBe("multiply");
    expect(layerBlendFromPsd("vivid light")).toBe("vivid light"); // kept for the PSD
  });
});
