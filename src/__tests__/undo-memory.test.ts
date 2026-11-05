import { describe, it, expect, beforeAll } from "vitest";
// @ts-expect-error Node's own module; the project has no @types/node
import v8 from "node:v8";
// @ts-expect-error as above
import vm from "node:vm";
import { history, pushLayersEdit, pushPixelEdit, structuralEdit } from "../undo";
import type { Layer, LayerManager } from "../layers";

// A pixel undo step must keep only its changed tiles. It kept BOTH whole-layer snapshots alive
// through a closure scope it shared (2026-10-17 review, V18-1): checked with a forced collection.

const W = 512;
const H = 256;
let gc: () => void;

beforeAll(() => {
  v8.setFlagsFromString("--expose-gc");
  gc = vm.runInNewContext("gc");
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

const image = (data: Uint8ClampedArray) => ({ data, width: W, height: H }) as ImageData;

/** A layer whose every snapshot differs from a blank `before` in one pixel. */
function rig() {
  const afters: WeakRef<object>[] = [];
  const layer = {} as Layer;
  const layers = {
    snapshotOf() {
      const d = image(new Uint8ClampedArray(W * H * 4));
      d.data[3] = 255;
      afters.push(new WeakRef(d));
      return d;
    },
    restoreTo() {},
  } as unknown as LayerManager;
  return { layer, layers, afters };
}

const collect = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise((r) => setTimeout(r, 0));
    gc();
  }
};

describe("pixel undo steps keep only their tiles", () => {
  it("pushPixelEdit drops the whole-layer snapshots", async () => {
    history.clear();
    const { layer, layers, afters } = rig();
    const befores: WeakRef<object>[] = [];
    // In a function of its own, so no local of this one still holds the last snapshot.
    const stroke = () => {
      const before = image(new Uint8ClampedArray(W * H * 4));
      befores.push(new WeakRef(before));
      pushPixelEdit(layers, layer, before);
    };
    for (let i = 0; i < 5; i++) stroke();
    await collect();
    expect(history.canUndo).toBe(true);
    expect(befores.filter((r) => r.deref()).length).toBe(0);
    expect(afters.filter((r) => r.deref()).length).toBe(0);
    history.clear();
  });

  it("pushLayersEdit drops them too", async () => {
    history.clear();
    const { layer, layers, afters } = rig();
    const befores: WeakRef<object>[] = [];
    const move = () => {
      const edits = Array.from({ length: 3 }, () => {
        const before = image(new Uint8ClampedArray(W * H * 4));
        before.data[(W * H - 1) * 4 + 3] = 255; // paint the move carries off the canvas
        befores.push(new WeakRef(before));
        return { layer, before };
      });
      pushLayersEdit(layers, edits, 3, 2);
    };
    move();
    await collect();
    expect(history.canUndo).toBe(true);
    expect(befores.filter((r) => r.deref()).length).toBe(0);
    expect(afters.filter((r) => r.deref()).length).toBe(0);
    history.clear();
  });

  // 2026-11-05: Merge down's step kept the lower layer whole, before and after (192 MB at
  // 4000×6000). Now its changed tiles only — counted, and the snapshots let go.
  it("structuralEdit with a pixel layer (Merge down) keeps only the changed tiles", async () => {
    history.clear();
    const target = { type: "layer", canvas: { width: W, height: H } } as unknown as Layer;
    const upper = { type: "layer", canvas: { width: 0, height: 0 } } as unknown as Layer;
    const snaps: WeakRef<object>[] = [];
    let merged = false;
    const layers = {
      captureStructure: () => ({ tree: merged ? [target] : [upper, target], activeId: 1 }),
      restoreStructure() {},
      restoreTo() {},
      // Before the merge blank; after it, one pixel painted.
      snapshotOf() {
        const d = image(new Uint8ClampedArray(W * H * 4));
        if (merged) d.data[3] = 255;
        snaps.push(new WeakRef(d));
        return d;
      },
    } as unknown as LayerManager;
    let bytes = 0;
    const push = history.push.bind(history);
    history.push = (c) => ((bytes = c.bytes ?? 0), push(c));
    try {
      structuralEdit(
        layers,
        () => (merged = true),
        () => target,
      );
    } finally {
      history.push = push;
    }
    expect(bytes).toBe(2 * 64 * 64 * 4); // one tile, both sides
    await collect();
    expect(history.canUndo).toBe(true);
    expect(snaps.length).toBe(2);
    expect(snaps.filter((r) => r.deref()).length).toBe(0);
    history.clear();
  });
});
