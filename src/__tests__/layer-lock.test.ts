import { describe, it, expect } from "vitest";
import {
  adjacentRow,
  hiddenInTree,
  lockedInTree,
  wrapInGroup,
  type LayerGroup,
  type LayerNode,
} from "../layers";

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

describe("wrapInGroup", () => {
  const newGroup = () => group(99, []) as LayerGroup;
  const ids = (nodes: LayerNode[]): unknown[] =>
    nodes.map((n) => (n.type === "group" ? [n.id, ids(n.children)] : n.id));

  it("puts a top-level layer into the group, in its place", () => {
    const tree = [layer(1), layer(2), layer(3)];
    expect(wrapInGroup(tree, 2, newGroup())).toBe(true);
    expect(ids(tree)).toEqual([1, [99, [2]], 3]);
  });

  it("wraps a layer inside a group without leaving that group", () => {
    const tree = [layer(1), group(10, [layer(3), layer(4)])];
    expect(wrapInGroup(tree, 4, newGroup())).toBe(true);
    expect(ids(tree)).toEqual([1, [10, [3, [99, [4]]]]]);
  });

  it("wraps a whole group, nesting it", () => {
    const tree = [group(10, [layer(3)]), layer(1)];
    expect(wrapInGroup(tree, 10, newGroup())).toBe(true);
    expect(ids(tree)).toEqual([[99, [[10, [3]]]], 1]);
  });

  it("leaves the tree alone for an id that isn't in it", () => {
    const tree = [layer(1)];
    expect(wrapInGroup(tree, 42, newGroup())).toBe(false);
    expect(ids(tree)).toEqual([1]);
  });
});

describe("hiddenInTree", () => {
  const node = (id: number, visible: boolean, children?: LayerNode[]) =>
    (children
      ? { type: "group", id, visible, children }
      : { type: "layer", id, visible }) as unknown as LayerNode;
  const tree = [
    node(1, true),
    node(2, false),
    node(10, false, [node(3, true)]),
    node(20, true, [node(4, true)]),
  ];

  it("is the layer's own visibility outside a hidden group", () => {
    expect(hiddenInTree(tree, 1)).toBe(false);
    expect(hiddenInTree(tree, 2)).toBe(true);
    expect(hiddenInTree(tree, 4)).toBe(false);
  });

  it("hides every member of a hidden group", () => {
    expect(hiddenInTree(tree, 3)).toBe(true);
  });
});
