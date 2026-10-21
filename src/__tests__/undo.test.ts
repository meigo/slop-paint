import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { history, pushLayersEdit, pushPixelEdit } from "../undo";
import type { Layer, LayerManager, RefPlacement } from "../layers";

// An edit that changed no pixel must push no step: an empty step wipes redo and makes the next
// undo appear to do nothing (Move of empty layers, a stroke or Clear on an empty layer).

const W = 128;
const H = 64;

beforeAll(() => {
  // Node has no ImageData; undo.ts only constructs it and reads data/width/height.
  (globalThis as unknown as { ImageData: unknown }).ImageData ??= class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
});

beforeEach(() => history.clear());

const image = (data = new Uint8ClampedArray(W * H * 4)) =>
  ({ data, width: W, height: H }) as ImageData;

/** A manager whose layers' snapshots are whatever `now` holds. */
function rig(now: ImageData) {
  const layer = {} as Layer;
  const layers = { snapshotOf: () => now, restoreTo() {} } as unknown as LayerManager;
  return { layer, layers };
}

/** One step on the redo stack, to see whether a push wipes it. */
function withRedo() {
  history.push({ undo() {}, redo() {} });
  history.undo();
  expect(history.canRedo).toBe(true);
}

describe("pushPixelEdit", () => {
  it("pushes nothing when no pixel changed", () => {
    const { layer, layers } = rig(image());
    withRedo();
    expect(pushPixelEdit(layers, layer, image())).toBe(false);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it("pushes a step when a pixel changed", () => {
    const after = image();
    after.data[3] = 255;
    const { layer, layers } = rig(after);
    expect(pushPixelEdit(layers, layer, image())).toBe(true);
    expect(history.canUndo).toBe(true);
  });
});

describe("pushLayersEdit", () => {
  it("pushes nothing when no layer changed", () => {
    const { layer, layers } = rig(image());
    withRedo();
    pushLayersEdit(
      layers,
      [
        { layer, before: image() },
        { layer, before: image() },
      ],
      5,
      0,
    );
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it("pushes a step when one of them changed", () => {
    const { layer, layers } = rig(image());
    const changed = image();
    changed.data[3] = 255;
    pushLayersEdit(
      layers,
      [
        { layer, before: image() },
        { layer, before: changed },
      ],
      5,
      0,
    );
    expect(history.canUndo).toBe(true);
  });

  // V18-1: a Move kept both sides of every tile it touched — a few full layers passed the whole
  // budget. Now it keeps only the paint pushed off the canvas, and shifts the rest back.
  it("keeps only the inked tiles pushed off the canvas, and shifts back and forth", () => {
    const calls: string[] = [];
    const layer = {} as Layer;
    const layers = {
      shiftPixels: (_l: Layer, dx: number, dy: number) => calls.push(`shift ${dx},${dy}`),
      restoreTo: (_l: Layer, d: ImageData, x: number, y: number) =>
        calls.push(`put ${x},${y} ${d.width}x${d.height} a${d.data[3]}`),
    } as unknown as LayerManager;
    // A layer painted all over, moved 10 px right and 3 px down.
    const before = image(new Uint8ClampedArray(W * H * 4).fill(255));
    let bytes = 0;
    const push = history.push.bind(history);
    history.push = (c) => ((bytes = c.bytes ?? 0), push(c));
    try {
      pushLayersEdit(layers, [{ layer, before }], 10, 3);
    } finally {
      history.push = push;
    }
    // The right 10 columns (full height) and the bottom 3 rows (the rest of the width).
    expect(bytes).toBe((10 * H + (W - 10) * 3) * 4);
    history.undo();
    expect(calls).toEqual([
      "shift -10,-3",
      "put 118,0 10x64 a255",
      "put 0,61 64x3 a255",
      "put 64,61 54x3 a255",
    ]);
    calls.length = 0;
    history.redo();
    expect(calls).toEqual(["shift 10,3"]);
  });

  it("keeps nothing for paint that stays on the canvas", () => {
    const layer = {} as Layer;
    const layers = { shiftPixels() {}, restoreTo() {} } as unknown as LayerManager;
    const before = image();
    before.data[(10 * W + 10) * 4 + 3] = 255; // one pixel near the top left, moved right
    let bytes = -1;
    const push = history.push.bind(history);
    history.push = (c) => ((bytes = c.bytes ?? 0), push(c));
    try {
      pushLayersEdit(layers, [{ layer, before }], 20, 0);
    } finally {
      history.push = push;
    }
    expect(history.canUndo).toBe(true);
    expect(bytes).toBe(0);
  });

  it("re-draws a reference from its original instead of keeping pixels", () => {
    const drawn: unknown[] = [];
    const refBefore = { src: {}, corners: [] } as unknown as RefPlacement;
    const refAfter = { src: {}, corners: [] } as unknown as RefPlacement;
    const layer = { ref: refAfter } as Layer;
    const layers = {
      renderRef: (l: Layer) => drawn.push(l.ref),
      shiftPixels() {
        throw new Error("a re-drawn reference isn't shifted");
      },
    } as unknown as LayerManager;
    pushLayersEdit(layers, [{ layer, refBefore, redrawn: true }], 4, 4);
    history.undo();
    history.redo();
    expect(drawn).toEqual([refBefore, refAfter]);
  });
});
