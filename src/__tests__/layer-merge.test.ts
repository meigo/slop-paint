import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { LayerManager as LayerManagerType } from "../layers";
import type * as Undo from "../undo";

// Merge down keeps what is seen: the lower layer's opacity would also fade what lands on it, so
// it is baked into its pixels and the layer becomes 100% — and undo brings the opacity back.

/** A canvas whose context records what is drawn with which operation and fill. */
class FakeCanvas {
  width = 4;
  height = 4;
  ops: string[] = [];
  private ctx = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "",
    save() {},
    restore() {},
    scale() {},
    resetTransform() {},
    setTransform() {},
    fillRect: () =>
      this.ops.push(`fill ${this.ctx.globalCompositeOperation} ${this.ctx.fillStyle}`),
    drawImage: () => this.ops.push(`draw ${this.ctx.globalAlpha}`),
    getImageData: () => ({ data: new Uint8ClampedArray(64), width: 4, height: 4 }),
    putImageData() {},
  };
  getContext() {
    return this.ctx;
  }
}

let LayerManager: typeof LayerManagerType;
let undo: typeof Undo;
beforeAll(async () => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => new FakeCanvas(),
  };
  ({ LayerManager } = await import("../layers"));
  undo = await import("../undo");
});
beforeEach(() => undo.history.clear());

function twoLayers() {
  const lm = new LayerManager(
    null as unknown as HTMLCanvasElement,
    new FakeCanvas().getContext() as unknown as CanvasRenderingContext2D,
    () => {},
  );
  const below = lm.addLayer("Below");
  const above = lm.addLayer("Above");
  return { lm, below, above, ops: (below.canvas as unknown as FakeCanvas).ops };
}

describe("mergeDown", () => {
  it("bakes the lower layer's opacity into its pixels, then draws the upper at its own", () => {
    const { lm, below, above, ops } = twoLayers();
    below.opacity = 40;
    above.opacity = 50;
    expect(lm.mergeDown(above.id)).toBe(true);
    expect(below.opacity).toBe(100);
    expect(ops).toEqual(["fill destination-in rgba(0, 0, 0, 0.4)", "draw 0.5"]);
  });

  it("leaves a 100% lower layer's pixels as they are", () => {
    const { lm, above, ops } = twoLayers();
    lm.mergeDown(above.id);
    expect(ops).toEqual(["draw 1"]);
  });

  it("undo gives the lower layer its opacity back, redo takes it again", () => {
    const { lm, below, above } = twoLayers();
    below.opacity = 40;
    undo.structuralEdit(
      lm,
      () => lm.mergeDown(above.id),
      () => below,
    );
    undo.history.undo();
    expect(below.opacity).toBe(40);
    undo.history.redo();
    expect(below.opacity).toBe(100);
  });
});
