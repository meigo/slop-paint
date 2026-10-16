import { describe, it, expect, beforeAll } from "vitest";
import type { LayerManager as LayerManagerType, RefPlacement } from "../layers";

// `activeRef` is what the reference tool follow, its handles, Flip and the text edit read. With a
// GROUP row selected `active` falls back to the bottom layer, and a reference there took the tool
// to Select and showed handles moving a layer nobody had picked (2026-10-17 review, V4-b).

class FakeCanvas {
  width = 0;
  height = 0;
  getContext() {
    return new Proxy({}, { get: () => () => {} });
  }
}

let LayerManager: typeof LayerManagerType;
beforeAll(async () => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => new FakeCanvas(),
  };
  ({ LayerManager } = await import("../layers"));
});

function docWithBottomReference() {
  const lm = new LayerManager(
    null as unknown as HTMLCanvasElement,
    new FakeCanvas().getContext() as unknown as CanvasRenderingContext2D,
    () => {},
  );
  lm.addLayer("Background");
  const l1 = lm.addLayer("Layer 1");
  lm.activeId = lm.flatLayers()[0].id;
  const ref = lm.addLayerBelow("[ignore]ref photo.png"); // as an import with Background active
  ref.ref = { src: {}, corners: [] } as unknown as RefPlacement;
  lm.activeId = l1.id;
  const group = lm.groupActive()!;
  return { lm, ref, l1, group };
}

describe("LayerManager.activeRef", () => {
  it("is the active row when it is a reference", () => {
    const { lm, ref } = docWithBottomReference();
    lm.activeId = ref.id;
    expect(lm.activeRef).toBe(ref);
  });

  it("is null on a plain layer", () => {
    const { lm, l1 } = docWithBottomReference();
    lm.activeId = l1.id;
    expect(lm.activeRef).toBeNull();
  });

  it("is null on a group row, though `active` falls back to the bottom reference", () => {
    const { lm, ref, group } = docWithBottomReference();
    lm.activeId = group.id;
    expect(lm.active).toBe(ref);
    expect(lm.activeRef).toBeNull();
  });
});
