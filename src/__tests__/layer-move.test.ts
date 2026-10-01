import { describe, it, expect } from "vitest";
import { isWithin, locateNode, moveNode, type LayerNode } from "../layers";

// Plain nodes: moveNode only reads the tree's shape, never the canvases.
const layer = (id: number) => ({ type: "layer", id }) as unknown as LayerNode;
const group = (id: number, children: LayerNode[]) =>
  ({ type: "group", id, children }) as unknown as LayerNode;

/** The tree's shape as ids, bottom-first, a group as [id, ...members]. */
const shape = (nodes: LayerNode[]): unknown[] =>
  nodes.map((n) => (n.type === "group" ? [n.id, ...shape(n.children)] : n.id));

// Bottom-first: 1, 2, G10[3, G11[4]], 5 — the panel lists 5, G10, G11, 4, 3, 2, 1.
const make = () => [layer(1), layer(2), group(10, [layer(3), group(11, [layer(4)])]), layer(5)];

describe("locateNode / isWithin", () => {
  it("finds a node's array, index and group", () => {
    const tree = make();
    const at = locateNode(tree, 4)!;
    expect(at.index).toBe(0);
    expect(at.group?.id).toBe(11);
    expect(locateNode(tree, 5)!.group).toBeNull();
    expect(locateNode(tree, 99)).toBeNull();
  });

  it("knows a group's subtree, itself included", () => {
    const tree = make();
    expect(isWithin(tree, 4, 10)).toBe(true);
    expect(isWithin(tree, 11, 10)).toBe(true);
    expect(isWithin(tree, 10, 10)).toBe(true);
    expect(isWithin(tree, 10, 11)).toBe(false);
    expect(isWithin(tree, 1, 10)).toBe(false);
  });
});

describe("moveNode", () => {
  it("reorders within the root, the index counted before the node leaves", () => {
    const up = make();
    expect(moveNode(up, 1, null, 4)).toBe(true); // to the top
    expect(shape(up)).toEqual([2, [10, 3, [11, 4]], 5, 1]);
    const down = make();
    expect(moveNode(down, 5, null, 0)).toBe(true); // to the bottom
    expect(shape(down)).toEqual([5, 1, 2, [10, 3, [11, 4]]]);
    const mid = make();
    expect(moveNode(mid, 1, null, 3)).toBe(true); // just above the group
    expect(shape(mid)).toEqual([2, [10, 3, [11, 4]], 1, 5]);
  });

  it("moves into a group, at any depth, and back out", () => {
    const tree = make();
    expect(moveNode(tree, 5, 11, 1)).toBe(true); // into G11, above 4
    expect(shape(tree)).toEqual([1, 2, [10, 3, [11, 4, 5]]]);
    expect(moveNode(tree, 4, null, 0)).toBe(true); // out to the root's bottom
    expect(shape(tree)).toEqual([4, 1, 2, [10, 3, [11, 5]]]);
  });

  it("moves a whole group with its members", () => {
    const tree = make();
    expect(moveNode(tree, 11, null, 4)).toBe(true);
    expect(shape(tree)).toEqual([1, 2, [10, 3], 5, [11, 4]]);
  });

  it("refuses a group into itself or its own subtree, and leaves the tree alone", () => {
    const tree = make();
    expect(moveNode(tree, 10, 10, 0)).toBe(false);
    expect(moveNode(tree, 10, 11, 0)).toBe(false);
    expect(shape(tree)).toEqual(shape(make()));
  });

  it("refuses a move that changes nothing, a missing id, a layer as parent, a bad index", () => {
    const tree = make();
    expect(moveNode(tree, 2, null, 1)).toBe(false); // its own place
    expect(moveNode(tree, 2, null, 2)).toBe(false); // just above itself: the same place
    expect(moveNode(tree, 99, null, 0)).toBe(false);
    expect(moveNode(tree, 2, 99, 0)).toBe(false);
    expect(moveNode(tree, 2, 5, 0)).toBe(false);
    expect(moveNode(tree, 2, null, 9)).toBe(false);
    expect(moveNode(tree, 2, null, -1)).toBe(false);
    expect(shape(tree)).toEqual(shape(make()));
  });
});
