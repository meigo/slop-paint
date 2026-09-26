import { describe, it, expect } from "vitest";
import { readPsd, writePsd, type Psd } from "ag-psd";

// Spike: can a Smart Object (the original file + its placement) survive an ag-psd write/read?
describe("PSD smart object round trip (ag-psd)", () => {
  it("keeps the placement and the embedded original file", () => {
    const w = 64,
      h = 32;
    const pixels = new Uint8ClampedArray(w * h * 4).fill(200);
    const original = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]); // PNG-ish bytes
    const id = "5e1f2c3a-0000-4000-8000-000000000001";
    const transform = [8, 4, 56, 4, 56, 28, 8, 28]; // tl, tr, br, bl corners on the page
    const psd: Psd = {
      width: w,
      height: h,
      imageData: { width: w, height: h, data: pixels },
      children: [
        {
          name: "[ignore]ref photo",
          top: 0,
          left: 0,
          imageData: { width: w, height: h, data: pixels },
          placedLayer: { id, type: "raster", transform, width: 400, height: 200 },
        },
      ],
      linkedFiles: [{ id, name: "photo.png", data: original }],
    };
    const buffer = writePsd(psd, { noBackground: true });
    // Pixels are not the question here (and decoding them needs a canvas in node).
    const back = readPsd(buffer, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    const layer = back.children![0];
    expect(layer.name).toBe("[ignore]ref photo");
    expect(layer.placedLayer?.id).toBe(id);
    expect(layer.placedLayer?.transform).toEqual(transform);
    expect(layer.placedLayer?.width).toBe(400);
    expect(back.linkedFiles?.[0].id).toBe(id);
    expect(back.linkedFiles?.[0].name).toBe("photo.png");
    expect([...(back.linkedFiles?.[0].data ?? [])]).toEqual([...original]);
  });
});
