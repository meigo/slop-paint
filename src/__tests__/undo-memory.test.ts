import { describe, it, expect, beforeAll } from "vitest";
// @ts-expect-error Node's own module; the project has no @types/node
import v8 from "node:v8";
// @ts-expect-error as above
import vm from "node:vm";
import { history, pushLayersEdit, pushPixelEdit } from "../undo";
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
        befores.push(new WeakRef(before));
        return { layer, before };
      });
      pushLayersEdit(layers, edits);
    };
    move();
    await collect();
    expect(history.canUndo).toBe(true);
    expect(befores.filter((r) => r.deref()).length).toBe(0);
    expect(afters.filter((r) => r.deref()).length).toBe(0);
    history.clear();
  });
});
