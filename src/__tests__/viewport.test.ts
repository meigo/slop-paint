import { describe, it, expect, beforeEach } from "vitest";
import { Viewport, clampZoom, rotationDegrees, wheelZoomFactor } from "../viewport";

// Minimal DOM mock
function createMockElements() {
  const parent = {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
  };
  const target = {
    style: { transform: "", transformOrigin: "" },
    parentElement: parent,
  };
  return target as unknown as HTMLElement;
}

describe("Viewport", () => {
  let vp: Viewport;

  beforeEach(() => {
    vp = new Viewport(createMockElements());
  });

  it("starts at zoom 1, no pan", () => {
    expect(vp.zoom).toBe(1);
    expect(vp.panX).toBe(0);
    expect(vp.panY).toBe(0);
  });

  it("screenToCanvas at zoom 1 is identity", () => {
    const p = vp.screenToCanvas(100, 200);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(200);
  });

  it("screenToCanvas at zoom 2 halves coordinates", () => {
    vp.setZoom(2);
    // After setZoom(2) centered at viewport center (400, 300):
    // panX = 400 - 400*2 = -400, panY = 300 - 300*2 = -300
    const p = vp.screenToCanvas(400, 300);
    // Center should map to center
    expect(p.x).toBeCloseTo(400);
    expect(p.y).toBeCloseTo(300);
  });

  it("screenToCanvas at zoom 2, top-left", () => {
    vp.setZoom(2);
    const p = vp.screenToCanvas(0, 0);
    // At zoom 2 centered: panX=-400, panY=-300
    // x = (0 - (-400)) / 2 = 200
    // y = (0 - (-300)) / 2 = 150
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(150);
  });

  it("pan offsets canvas coordinates", () => {
    vp.panX = 50;
    vp.panY = 100;
    const p = vp.screenToCanvas(150, 200);
    // x = (150 - 50) / 1 = 100, y = (200 - 100) / 1 = 100
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(100);
  });

  it("resetView returns to default", () => {
    vp.setZoom(3);
    vp.panX = 100;
    vp.panY = 200;
    vp.resetView();
    expect(vp.zoom).toBe(1);
    expect(vp.panX).toBe(0);
    expect(vp.panY).toBe(0);
  });

  it("zoom is clamped to min/max", () => {
    vp.setZoom(0.001);
    expect(vp.zoom).toBeGreaterThanOrEqual(0.1);
    vp.setZoom(100);
    expect(vp.zoom).toBeLessThanOrEqual(20);
  });

  it("zoomAt keeps point under cursor fixed", () => {
    // Zoom in at point (200, 150)
    const before = vp.screenToCanvas(200, 150);
    vp.zoomAt(200, 150, 1.1); // zoom in
    const after = vp.screenToCanvas(200, 150);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  it("panBy moves the view by a screen delta without zooming", () => {
    const zoom = vp.zoom;
    const before = vp.screenToCanvas(200, 150);
    vp.panBy(30, -20);
    const after = vp.screenToCanvas(230, 130);
    expect(vp.zoom).toBe(zoom);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it("canvasToScreen is the inverse of screenToCanvas", () => {
    vp.setZoom(1.7);
    vp.panX = 30;
    vp.panY = -45;
    vp.rotation = 0.6;
    for (const [sx, sy] of [
      [0, 0],
      [123, 456],
      [800, 600],
      [-50, 200],
    ]) {
      const c = vp.screenToCanvas(sx, sy);
      const s = vp.canvasToScreen(c.x, c.y);
      expect(s.x).toBeCloseTo(sx, 6);
      expect(s.y).toBeCloseTo(sy, 6);
    }
  });

  it("pan start/update/end works", () => {
    vp.startPan(100, 100);
    expect(vp.panning).toBe(true);
    vp.updatePan(150, 120);
    expect(vp.panX).toBe(50);
    expect(vp.panY).toBe(20);
    vp.endPan();
    expect(vp.panning).toBe(false);
  });
});

describe("wheelZoomFactor", () => {
  it("follows a trackpad pinch's small deltas instead of 10% each", () => {
    // 30 Chrome pinch events of −2: e^0.6 ≈ 1.82 (a fixed 10% per event gave 17×)
    let z = 1;
    for (let i = 0; i < 30; i++) z *= wheelZoomFactor(-2);
    expect(z).toBeCloseTo(Math.exp(0.6), 5);
  });

  it("zooms a mouse notch about 10%, either way", () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(1.105, 3);
    expect(wheelZoomFactor(100)).toBeCloseTo(0.905, 3);
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(1.105, 3); // Firefox: 3 lines
  });

  it("zooms nothing for deltaY 0", () => {
    expect(wheelZoomFactor(0)).toBe(1);
  });
});

describe("clampZoom", () => {
  it("keeps a zoom inside 10%–2000%", () => {
    expect(clampZoom(1, 0.05)).toBe(0.1);
    expect(clampZoom(1, 30)).toBe(20);
    expect(clampZoom(1, 2)).toBe(2);
  });

  it("a fitted zoom below the floor: zooming out stays put, zooming in works", () => {
    // Fit put an 8192 px document at ~8%: Ctrl+- and the wheel jumped it IN to 10%.
    expect(clampZoom(0.08, 0.08 / 1.2)).toBe(0.08);
    expect(clampZoom(0.08, 0.09)).toBe(0.09);
    expect(clampZoom(0.08, 0.2)).toBe(0.2);
  });
});

describe("rotationDegrees", () => {
  const rad = (d: number) => (d * Math.PI) / 180;
  it("wraps a turn off into (−180, 180]", () => {
    expect(rotationDegrees(rad(340))).toBe(-20);
    expect(rotationDegrees(rad(-340))).toBe(20);
    expect(rotationDegrees(rad(360))).toBe(0);
    expect(rotationDegrees(rad(-180))).toBe(180);
    expect(rotationDegrees(rad(180))).toBe(180);
    expect(rotationDegrees(rad(735))).toBe(15);
  });
  it("leaves an in-range angle as whole degrees", () => {
    expect(rotationDegrees(rad(-90))).toBe(-90);
    expect(rotationDegrees(rad(12.4))).toBe(12);
    expect(Object.is(rotationDegrees(rad(-0.2)), 0)).toBe(true);
  });
});
