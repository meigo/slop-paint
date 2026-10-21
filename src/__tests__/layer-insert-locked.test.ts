import { describe, it, expect, beforeAll } from "vitest";
import type { LayerManager as LayerManagerType, LayerGroup } from "../layers";

// A locked group takes nothing in (a drop into it is refused, `dropTarget`), so new, duplicated and
// imported layers go beside it instead: they landed inside, locked, and couldn't be dragged out
// (2026-10-17 review, V4-c).

class FakeCanvas {
  width = 0;
  height = 0;
  getContext() {
    return new Proxy({}, { get: () => () => {} });
  }
}

let LayerManager: typeof LayerManagerType;
let lockedInTree: (typeof import("../layers"))["lockedInTree"];
beforeAll(async () => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => new FakeCanvas(),
  };
  ({ LayerManager, lockedInTree } = await import("../layers"));
});

/** Bottom-first [Background, G[Layer 1]] with G locked. */
function docWithLockedGroup() {
  const lm = new LayerManager(
    null as unknown as HTMLCanvasElement,
    new FakeCanvas().getContext() as unknown as CanvasRenderingContext2D,
    () => {},
  );
  const bg = lm.addLayer("Background");
  const l1 = lm.addLayer("Layer 1");
  const g = lm.groupActive() as LayerGroup;
  g.locked = true;
  return { lm, bg, l1, g };
}

describe("inserting beside a locked group", () => {
  it("Add layer with the locked group's row selected goes above the group", () => {
    const { lm, bg, g } = docWithLockedGroup();
    lm.activeId = g.id;
    const added = lm.addLayer();
    expect(lm.tree).toEqual([bg, g, added]);
    expect(lockedInTree(lm.tree, added.id)).toBe(false);
  });

  it("Add layer and Duplicate with a member selected go above the group", () => {
    const { lm, bg, l1, g } = docWithLockedGroup();
    lm.activeId = l1.id;
    const added = lm.addLayer();
    expect(lm.tree).toEqual([bg, g, added]);
    const dup = lm.duplicateLayer(l1.id)!;
    expect(lm.tree).toEqual([bg, g, dup, added]);
    expect(g.children).toEqual([l1]);
  });

  it("an import below a member goes below the group", () => {
    const { lm, bg, l1, g } = docWithLockedGroup();
    lm.activeId = l1.id;
    const ref = lm.addLayerBelow("[ignore]ref photo.png");
    expect(lm.tree).toEqual([bg, ref, g]);
  });

  it("an unlocked group still takes them in", () => {
    const { lm, l1, g } = docWithLockedGroup();
    g.locked = false;
    lm.activeId = l1.id;
    const added = lm.addLayer();
    expect(g.children).toEqual([l1, added]);
  });
});
