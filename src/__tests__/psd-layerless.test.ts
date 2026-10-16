// loadPsd on a PSD with no drawing layer (only an empty group, or a layer section with 0 records).
// Node has no DOM: a fake canvas stands in, for ag-psd and for the layers loadPsd creates.
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { writePsd, initializeCanvas } from "ag-psd";
import { loadPsd } from "../export-psd";
import { LayerManager } from "../layers";

function fakeCanvas(width: number, height: number) {
  const image = (w: number, h: number) => ({
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4),
  });
  const ctx = {
    createImageData: image,
    getImageData: (_x: number, _y: number, w: number, h: number) => image(w, h),
    putImageData: () => {},
    drawImage: () => {},
    scale: () => {},
  };
  return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
}
initializeCanvas(fakeCanvas as never);

const g = globalThis as { document?: unknown };
const hadDocument = "document" in g;
beforeAll(() => {
  g.document = { createElement: () => fakeCanvas(0, 0) };
});
afterAll(() => {
  if (!hadDocument) delete g.document;
});

function manager() {
  const m = new LayerManager(
    null as unknown as HTMLCanvasElement,
    null as unknown as CanvasRenderingContext2D,
    () => {},
  );
  // The document that was open before, at another size, with its layer (id 2) active.
  m.tree = [{ type: "layer", id: 2, name: "Old" } as never];
  m.activeId = 2;
  m.docWidth = 100;
  m.docHeight = 100;
  return m;
}

/** A minimal RGB PSD whose layer-info section is present but holds 0 layer records. */
function zeroRecordPsd(w: number, h: number): ArrayBuffer {
  const bytes: number[] = [];
  const u8 = (v: number) => bytes.push(v & 0xff);
  const u16 = (v: number) => (u8(v >> 8), u8(v));
  const u32 = (v: number) => (u16(v >>> 16), u16(v));
  for (const c of "8BPS") u8(c.charCodeAt(0));
  u16(1); // version
  for (let i = 0; i < 6; i++) u8(0);
  u16(3); // channels
  u32(h);
  u32(w);
  u16(8); // depth
  u16(3); // RGB
  u32(0); // color mode data
  u32(0); // image resources
  u32(6); // layer & mask info: the layer info section below, nothing else
  u32(2); //   layer info length
  u16(0); //   layer count 0
  u16(0); // composite: raw
  for (let i = 0; i < 3 * w * h; i++) u8(200);
  return new Uint8Array(bytes).buffer;
}

describe("loadPsd without a drawing layer", () => {
  it("a PSD of one empty group gets an empty layer, active, at the file's size", () => {
    const buf = writePsd(
      { width: 8, height: 6, children: [{ name: "[slot] arm", children: [] }] },
      { generateThumbnail: false },
    );
    const m = manager();
    expect(loadPsd(buf, m, 1)).toEqual({ width: 8, height: 6 });
    expect(m.tree.map((n) => n.type)).toEqual(["group", "layer"]);
    const layer = m.active;
    expect(layer).toBeDefined();
    expect(layer.id).toBe(m.tree[1].id);
    expect([layer.canvas.width, layer.canvas.height]).toEqual([8, 6]);
    expect([m.docWidth, m.docHeight]).toEqual([100, 100]); // the caller sets the new size
  });

  it("a PSD whose layer section has 0 records opens as its flat image", () => {
    const m = manager();
    expect(loadPsd(zeroRecordPsd(4, 3), m, 1)).toEqual({ width: 4, height: 3 });
    expect(m.tree.length).toBe(1);
    expect(m.active.name).toBe("Background");
    expect([m.active.canvas.width, m.active.canvas.height]).toEqual([4, 3]);
  });
});
