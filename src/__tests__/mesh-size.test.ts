import { describe, it, expect } from "vitest";
import { MESH_MAX, MESH_MIN, gridUntouched, meshStepBlock } from "../mesh-size";

describe("meshStepBlock", () => {
  it("steps up to the finest, keeping bends", () => {
    expect(meshStepBlock(MESH_MIN, 1, false)).toBe("");
    expect(meshStepBlock(MESH_MAX - 1, 1, false)).toBe("");
    expect(meshStepBlock(MESH_MAX, 1, true)).not.toBe("");
  });

  it("steps down only while unbent, and never below the coarsest", () => {
    expect(meshStepBlock(5, -1, true)).toBe("");
    expect(meshStepBlock(5, -1, false)).toMatch(/bend/);
    expect(meshStepBlock(MESH_MIN, -1, true)).toMatch(/Distort/);
  });
});

describe("gridUntouched", () => {
  const g = [
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    [
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ],
  ];
  const copy = () => g.map((r) => r.map((p) => ({ ...p })));

  it("is true for the same points, within rounding", () => {
    const c = copy();
    c[1][1].x += 1e-9;
    expect(gridUntouched(c, g)).toBe(true);
  });

  it("is false once a point moved, or the shape differs", () => {
    const c = copy();
    c[0][1].y = 3;
    expect(gridUntouched(c, g)).toBe(false);
    expect(gridUntouched(g.slice(0, 1), g)).toBe(false);
  });
});
