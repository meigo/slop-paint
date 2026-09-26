import { describe, it, expect } from "vitest";
import { adjacentRow, lockedInTree, type LayerNode } from "../layers";

// Plain nodes: lockedInTree only reads the tree's shape and lock flags, never the canvases.
const layer = (id: number, locked = false) =>
  ({ type: "layer", id, locked }) as unknown as LayerNode;
const group = (id: number, children: LayerNode[], locked = false) =>
  ({ type: "group", id, locked, children }) as unknown as LayerNode;

describe("lockedInTree", () => {
  const tree = [
    layer(1),
    layer(2, true),
    group(10, [layer(3), group(11, [layer(4)])], true),
    group(20, [layer(5)]),
  ];

  it("is the layer's own lock outside any locked group", () => {
    expect(lockedInTree(tree, 1)).toBe(false);
    expect(lockedInTree(tree, 2)).toBe(true);
    expect(lockedInTree(tree, 5)).toBe(false);
  });

  it("locks every member of a locked group, however deep", () => {
    expect(lockedInTree(tree, 3)).toBe(true);
    expect(lockedInTree(tree, 4)).toBe(true);
    expect(lockedInTree(tree, 11)).toBe(true);
  });

  it("is false for an id that is not in the tree", () => {
    expect(lockedInTree(tree, 99)).toBe(false);
  });
});

describe("adjacentRow", () => {
  // Tree is bottom-first; the panel lists top-first: G(10)[ 4, 3 ], 2, 1 — with G expanded.
  const g = (collapsed: boolean) =>
    ({ type: "group", id: 10, collapsed, children: [layer(3), layer(4)] }) as unknown as LayerNode;
  const tree = (collapsed: boolean) => [layer(1), layer(2), g(collapsed)];

  it("moves up and down the rows as the panel lists them", () => {
    expect(adjacentRow(tree(false), 2, "up")).toBe(3);
    expect(adjacentRow(tree(false), 3, "up")).toBe(4);
    expect(adjacentRow(tree(false), 4, "up")).toBe(10);
    expect(adjacentRow(tree(false), 10, "down")).toBe(4);
    expect(adjacentRow(tree(false), 2, "down")).toBe(1);
  });

  it("skips the members of a collapsed group", () => {
    expect(adjacentRow(tree(true), 2, "up")).toBe(10);
    expect(adjacentRow(tree(true), 10, "down")).toBe(2);
  });

  it("stays put at either end", () => {
    expect(adjacentRow(tree(false), 10, "up")).toBe(null);
    expect(adjacentRow(tree(false), 1, "down")).toBe(null);
  });
});
