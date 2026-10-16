import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { history, pushLayersEdit, pushPixelEdit } from "../undo";
import type { Layer, LayerManager } from "../layers";

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
    pushLayersEdit(layers, [
      { layer, before: image() },
      { layer, before: image() },
    ]);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it("pushes a step when one of them changed", () => {
    const { layer, layers } = rig(image());
    const changed = image();
    changed.data[3] = 255;
    pushLayersEdit(layers, [
      { layer, before: image() },
      { layer, before: changed },
    ]);
    expect(history.canUndo).toBe(true);
  });
});
