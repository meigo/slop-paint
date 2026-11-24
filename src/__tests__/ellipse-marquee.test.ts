import { describe, it, expect } from "vitest";
import { dragBox, ellipsePoints } from "../ellipse-marquee";

describe("ellipsePoints", () => {
  it("puts every point on the ellipse inside the box", () => {
    const box = { x: 10, y: 20, w: 200, h: 80 };
    const pts = ellipsePoints(box);
    for (const p of pts) {
      const u = (p.x - 110) / 100;
      const v = (p.y - 60) / 40;
      expect(u * u + v * v).toBeCloseTo(1, 9);
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(10, 9);
    expect(Math.max(...xs)).toBeCloseTo(210, 9);
    expect(Math.min(...ys)).toBeCloseTo(20, 9);
    expect(Math.max(...ys)).toBeCloseTo(100, 9);
  });

  it("uses about one point per page px of outline, a multiple of 4, within limits", () => {
    expect(ellipsePoints({ x: 0, y: 0, w: 2, h: 2 }).length).toBe(16);
    const n = ellipsePoints({ x: 0, y: 0, w: 100, h: 100 }).length;
    expect(n).toBe(316); // π·100 → 315 rounded up to a multiple of 4
    expect(ellipsePoints({ x: 0, y: 0, w: 8000, h: 8000 }).length).toBe(1024);
  });
});

describe("dragBox", () => {
  it("spans the two points in any direction", () => {
    expect(dragBox({ x: 50, y: 40 }, { x: 10, y: 90 }, false, null)).toEqual({
      x: 10,
      y: 40,
      w: 40,
      h: 50,
    });
  });

  it("with circle, is a square on the longer side, toward the pointer", () => {
    expect(dragBox({ x: 50, y: 50 }, { x: 80, y: 60 }, true, null)).toEqual({
      x: 50,
      y: 50,
      w: 30,
      h: 30,
    });
    expect(dragBox({ x: 50, y: 50 }, { x: 40, y: 10 }, true, null)).toEqual({
      x: 10,
      y: 10,
      w: 40,
      h: 40,
    });
  });

  it("with circle, stays on the page", () => {
    // 90 px across, but only 20 px of page below the start.
    expect(dragBox({ x: 10, y: 80 }, { x: 100, y: 100 }, true, { w: 200, h: 100 })).toEqual({
      x: 10,
      y: 80,
      w: 20,
      h: 20,
    });
  });
});
