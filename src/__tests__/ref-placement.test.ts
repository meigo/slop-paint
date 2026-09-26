import { describe, it, expect } from "vitest";
import {
  cornersFromRect,
  cornersFromMatrix,
  matrixFromCorners,
  toPsdTransform,
  fromPsdTransform,
  fitDecodedSize,
  newRefId,
  smartObjectFor,
  refFromPlaced,
} from "../ref-placement";

const rect = { x: 10, y: 20, w: 200, h: 100 };

describe("ref placement", () => {
  it("places the image's own box onto the page corners and back", () => {
    const corners = cornersFromRect(rect);
    expect(corners).toEqual([
      { x: 10, y: 20 },
      { x: 210, y: 20 },
      { x: 210, y: 120 },
      { x: 10, y: 120 },
    ]);
    // A 400×200 original shown at half size at (10, 20).
    const m = matrixFromCorners(400, 200, corners);
    expect(m).toEqual({ a: 0.5, b: 0, c: 0, d: 0.5, e: 10, f: 20 });
    // The float shows the original's box under that matrix: its corners land back on the page's.
    expect(cornersFromMatrix({ x: 0, y: 0, w: 400, h: 200 }, m)).toEqual(corners);
  });

  it("keeps a rotation", () => {
    // Rotated 90°: tl at (100, 0), the top edge running down the page.
    const corners = [
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 80, y: 40 },
      { x: 80, y: 0 },
    ] as const;
    const m = matrixFromCorners(40, 20, [...corners]);
    const back = cornersFromMatrix({ x: 0, y: 0, w: 40, h: 20 }, m);
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(corners[i].x);
      expect(p.y).toBeCloseTo(corners[i].y);
    });
  });

  it("maps to and from Photoshop's placed-layer transform (tl, tr, br, bl flattened)", () => {
    const corners = cornersFromRect(rect);
    const t = toPsdTransform(corners);
    expect(t).toEqual([10, 20, 210, 20, 210, 120, 10, 120]);
    expect(fromPsdTransform(t)).toEqual(corners);
    expect(fromPsdTransform([1, 2, 3])).toBeNull();
  });
});

describe("fitDecodedSize", () => {
  it("keeps a small original as it is", () => {
    expect(fitDecodedSize(1200, 800)).toEqual({ w: 1200, h: 800 });
  });

  it("caps the long side at 4096, keeping the aspect", () => {
    expect(fitDecodedSize(8192, 1024)).toEqual({ w: 4096, h: 512 });
  });

  it("keeps the area under iPad's canvas limit", () => {
    const { w, h } = fitDecodedSize(4096, 4096);
    expect(w * h).toBeLessThanOrEqual(16_000_000);
    expect(w).toBe(h);
  });
});

describe("newRefId", () => {
  it("makes a UUID-shaped id", () => {
    expect(newRefId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("Smart Object mapping", () => {
  const ref = {
    src: {
      id: "abc",
      name: "photo.png",
      bytes: new Uint8Array([1, 2, 3]),
      width: 400,
      height: 200,
    },
    corners: cornersFromRect({ x: 10, y: 20, w: 200, h: 100 }),
  };

  it("writes the placement and the original file, matched by id", () => {
    const { placedLayer, linkedFile } = smartObjectFor(ref);
    expect(placedLayer).toEqual({
      id: "abc",
      type: "raster",
      transform: [10, 20, 210, 20, 210, 120, 10, 120],
      width: 400,
      height: 200,
    });
    expect(linkedFile).toEqual({ id: "abc", name: "photo.png", data: ref.src.bytes });
  });

  it("reads them back into a reference waiting to be decoded", () => {
    const { placedLayer, linkedFile } = smartObjectFor(ref);
    const back = refFromPlaced(placedLayer, [linkedFile]);
    expect(back?.corners).toEqual(ref.corners);
    expect(back?.src).toEqual({ ...ref.src, image: null });
  });

  it("is null for a placed layer whose file is missing or whose transform is broken", () => {
    const { placedLayer } = smartObjectFor(ref);
    expect(refFromPlaced(placedLayer, [])).toBeNull();
    expect(
      refFromPlaced({ ...placedLayer, transform: [1] }, [smartObjectFor(ref).linkedFile]),
    ).toBeNull();
    expect(refFromPlaced(undefined, [])).toBeNull();
  });
});
