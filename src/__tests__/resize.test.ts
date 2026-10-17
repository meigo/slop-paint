import { describe, it, expect } from "vitest";
import { docSide, halvingSteps, layerPixelRatio, linkedSize, MAX_DOC_PX } from "../resize";

describe("linkedSize", () => {
  it("keeps the document's ratio", () => {
    expect(linkedSize(960, 1920, 1080)).toBe(540); // width → height
    expect(linkedSize(1080, 1080, 1920)).toBe(1920); // height → width
    expect(linkedSize(1000, 1920, 1080)).toBe(563); // rounded
  });

  it("clamps to 1…8192", () => {
    expect(linkedSize(1, 1920, 1080)).toBe(1);
    expect(linkedSize(8192, 1080, 1920)).toBe(MAX_DOC_PX);
  });

  it("falls back to the other side for a bad input", () => {
    expect(linkedSize(Number.NaN, 1920, 1080)).toBe(1080);
    expect(linkedSize(500, 0, 1080)).toBe(1080);
  });
});

describe("docSide", () => {
  it("rounds a typed side", () => {
    expect(docSide(1920)).toBe(1920);
    expect(docSide(511.6)).toBe(512);
    expect(docSide(1)).toBe(1);
    expect(docSide(MAX_DOC_PX)).toBe(MAX_DOC_PX);
  });

  it("refuses an empty, zero, negative or too large side instead of clamping it", () => {
    expect(docSide(null)).toBeNull(); // '' through Svelte's number binding
    expect(docSide(undefined)).toBeNull();
    expect(docSide(Number.NaN)).toBeNull();
    expect(docSide(0)).toBeNull();
    expect(docSide(0.4)).toBeNull(); // rounds to 0
    expect(docSide(-3)).toBeNull();
    expect(docSide(MAX_DOC_PX + 1)).toBeNull();
  });
});

describe("halvingSteps", () => {
  it("halves down to a large shrink, then lands on the target", () => {
    expect(halvingSteps(4000, 2000, 500, 250)).toEqual([
      { w: 2000, h: 1000 },
      { w: 1000, h: 500 },
      { w: 500, h: 250 },
    ]);
    expect(halvingSteps(1920, 1080, 300, 200)).toEqual([
      { w: 960, h: 540 },
      { w: 480, h: 270 },
      { w: 300, h: 200 },
    ]);
  });

  it("is one step for growing or a shrink under 2×", () => {
    expect(halvingSteps(800, 600, 1600, 1200)).toEqual([{ w: 1600, h: 1200 }]);
    expect(halvingSteps(800, 600, 500, 400)).toEqual([{ w: 500, h: 400 }]);
  });

  it("never shrinks a side below its target, when only one side shrinks a lot", () => {
    const steps = halvingSteps(4000, 1000, 500, 900);
    for (const s of steps) {
      expect(s.w).toBeGreaterThanOrEqual(500);
      expect(s.h).toBeGreaterThanOrEqual(900);
    }
    expect(steps.at(-1)).toEqual({ w: 500, h: 900 });
  });
});

describe("layerPixelRatio", () => {
  it("keeps whole ratios", () => {
    expect([1, 2, 3].map(layerPixelRatio)).toEqual([1, 2, 3]);
  });

  it("rounds a fractional screen (Windows scaling, browser zoom) to a whole ratio", () => {
    expect([1.25, 1.5, 1.75, 2.2, 1.8].map(layerPixelRatio)).toEqual([1, 2, 2, 2, 2]);
  });

  it("is never below 1: a zoomed-out page doesn't keep layers under document pixels", () => {
    expect([0.5, 0.9, 0, NaN].map(layerPixelRatio)).toEqual([1, 1, 1, 1]);
  });

  // The reason for whole ratios: a save shrinks a layer to document pixels (bilinear) and opening
  // grows it back nearest-neighbour. 1-D model of both.
  it("a save + open round trip returns exactly the saved pixels at a whole ratio, not at 1.5", () => {
    const nearestUp = (src: number[], n: number) =>
      Array.from(
        { length: n },
        (_, i) => src[Math.min(src.length - 1, Math.floor((i * src.length) / n))],
      );
    const bilinearDown = (src: number[], n: number) =>
      Array.from({ length: n }, (_, j) => {
        const u = ((j + 0.5) * src.length) / n - 0.5;
        const i0 = Math.max(0, Math.floor(u));
        const i1 = Math.min(src.length - 1, i0 + 1);
        const f = u - Math.floor(u);
        return Math.round((1 - f) * src[i0] + f * src[i1]);
      });
    const doc = [0, 255, 0, 0, 128, 255, 255, 0, 64, 0, 255, 32];
    const trip = (ratio: number) => {
      const n = Math.round(doc.length * ratio);
      return bilinearDown(nearestUp(doc, n), doc.length);
    };
    expect(trip(layerPixelRatio(1.5))).toEqual(doc);
    expect(trip(3)).toEqual(doc);
    expect(trip(1.5)).not.toEqual(doc);
  });
});
