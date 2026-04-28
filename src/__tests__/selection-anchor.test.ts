import { describe, it, expect } from "vitest";
import { computeAnchor, type AnchorInput } from "../selection-anchor";

const identityMap = (p: { x: number; y: number }) => ({ x: p.x, y: p.y });

function baseInput(overrides: Partial<AnchorInput> = {}): AnchorInput {
  return {
    bboxDoc: [
      { x: 200, y: 200 },
      { x: 400, y: 200 },
      { x: 400, y: 400 },
      { x: 200, y: 400 },
    ],
    docToScreen: identityMap,
    panelSize: { w: 200, h: 40 },
    viewport: { w: 800, h: 600 },
    margin: 12,
    ...overrides,
  };
}

describe("computeAnchor", () => {
  it("centers above the bbox when there is room", () => {
    const r = computeAnchor(baseInput());
    expect(r.side).toBe("above");
    // bbox center x = 300, panel width 200 → x = 300 - 100 = 200
    expect(r.x).toBe(200);
    // bbox top = 200, margin = 12, panel h = 40 → y = 200 - 12 - 40 = 148
    expect(r.y).toBe(148);
  });

  it("flips below when bbox top is too close to viewport top", () => {
    const r = computeAnchor(
      baseInput({
        bboxDoc: [
          { x: 200, y: 5 },
          { x: 400, y: 5 },
          { x: 400, y: 100 },
          { x: 200, y: 100 },
        ],
      }),
    );
    expect(r.side).toBe("below");
    // bbox bottom = 100, margin = 12 → y = 112
    expect(r.y).toBe(112);
  });

  it("clamps x at the left edge when bbox is near the left", () => {
    const r = computeAnchor(
      baseInput({
        bboxDoc: [
          { x: 0, y: 200 },
          { x: 50, y: 200 },
          { x: 50, y: 300 },
          { x: 0, y: 300 },
        ],
      }),
    );
    // bbox center = 25, would put panel at -75; clamp to margin 12
    expect(r.x).toBe(12);
  });

  it("clamps x at the right edge when bbox is near the right", () => {
    const r = computeAnchor(
      baseInput({
        bboxDoc: [
          { x: 750, y: 200 },
          { x: 800, y: 200 },
          { x: 800, y: 300 },
          { x: 750, y: 300 },
        ],
      }),
    );
    // viewport.w - panel.w - margin = 800 - 200 - 12 = 588
    expect(r.x).toBe(588);
  });

  it("derives screen-space AABB from a rotated quad in doc space", () => {
    // 45° rotation around origin via docToScreen
    const cos = Math.cos(Math.PI / 4);
    const sin = Math.sin(Math.PI / 4);
    const rotate = (p: { x: number; y: number }) => ({
      x: p.x * cos - p.y * sin + 400, // shift to keep on-screen
      y: p.x * sin + p.y * cos + 100,
    });
    const r = computeAnchor(
      baseInput({
        bboxDoc: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        docToScreen: rotate,
      }),
    );
    // Rotated corners in screen space:
    //   (0,0)     → (400, 100)
    //   (100,0)   → (~470.71, ~170.71)
    //   (100,100) → (400, ~241.42)
    //   (0,100)   → (~329.29, ~170.71)
    // AABB: minX ≈ 329.29, maxX ≈ 470.71, minY = 100, maxY ≈ 241.42
    // Center x ≈ 400, panel w 200 → x ≈ 300
    expect(r.x).toBeCloseTo(300, 1);
    // minY = 100; would place above at y = 100 - 12 - 40 = 48 (still positive) → above
    expect(r.side).toBe("above");
    expect(r.y).toBe(48);
  });

  it("clamps to top margin when both above and below would be off-screen", () => {
    const r = computeAnchor(
      baseInput({
        bboxDoc: [
          { x: 200, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 600 },
          { x: 200, y: 600 },
        ],
        viewport: { w: 800, h: 100 }, // tiny viewport, bbox fills it
      }),
    );
    // Above: y = 0 - 12 - 40 = -52 (off-screen)
    // Below: y = 600 + 12 = 612 (off-screen, viewport.h = 100)
    // Should clamp to top margin
    expect(r.y).toBe(12);
  });
});
