import { describe, it, expect } from "vitest";
import {
  groupNodes,
  layersToMove,
  layersLeftAfter,
  removeNodes,
  rowOrder,
  topSelection,
  type LayerGroup,
  type LayerNode,
} from "../layers";

const layer = (id: number) => ({ type: "layer", id }) as unknown as LayerNode;
const group = (id: number, children: LayerNode[]) =>
  ({ type: "group", id, children }) as unknown as LayerNode;
const newGroup = () => ({ type: "group", id: 99, children: [] }) as unknown as LayerGroup;
const shape = (nodes: LayerNode[]): unknown[] =>
  nodes.map((n) => (n.type === "group" ? [n.id, ...shape(n.children)] : n.id));

// Bottom-first [1, 2, G10[3, 4], 5]; the panel lists 5, G10, 4, 3, 2, 1.
const make = () => [layer(1), layer(2), group(10, [layer(3), layer(4)]), layer(5)];

describe("rowOrder / topSelection", () => {
  it("lists rows top first, a group before its members", () => {
    expect(rowOrder(make())).toEqual([5, 10, 4, 3, 2, 1]);
  });

  it("drops members of a selected group and unknown ids, top first", () => {
    expect(topSelection(make(), [1, 4, 10, 3, 99])).toEqual([10, 1]);
    expect(topSelection(make(), [2, 5])).toEqual([5, 2]);
  });
});

describe("removeNodes", () => {
  it("removes the selected nodes, a group with its members", () => {
    const tree = make();
    expect(removeNodes(tree, [5, 10, 3])).toBe(2);
    expect(shape(tree)).toEqual([1, 2]);
  });

  it("counts the drawing layers that would be left", () => {
    expect(layersLeftAfter(make(), [10])).toBe(3);
    expect(layersLeftAfter(make(), [1, 2, 5, 10])).toBe(0);
    expect(layersLeftAfter(make(), [3, 4, 1])).toBe(2);
  });
});

describe("groupNodes", () => {
  it("groups siblings in the topmost one's place, keeping their order", () => {
    const tree = make();
    expect(groupNodes(tree, [1, 5], newGroup())).toBe(true);
    expect(shape(tree)).toEqual([2, [10, 3, 4], [99, 1, 5]]);
  });

  it("gathers nodes from different groups, in stacking order", () => {
    const tree = make();
    expect(groupNodes(tree, [3, 2], newGroup())).toBe(true);
    // The topmost is 3 (inside G10), so the new group sits there and takes 2 along below 3.
    expect(shape(tree)).toEqual([1, [10, [99, 2, 3], 4], 5]);
  });

  it("takes a selected group whole, ignoring its selected members", () => {
    const tree = make();
    expect(groupNodes(tree, [10, 4, 1], newGroup())).toBe(true);
    expect(shape(tree)).toEqual([2, [99, 1, [10, 3, 4]], 5]);
  });

  it("does nothing when nothing selected is in the tree", () => {
    const tree = make();
    expect(groupNodes(tree, [42], newGroup())).toBe(false);
    expect(shape(tree)).toEqual(shape(make()));
  });
});

describe("layersToMove", () => {
  // Plain nodes with lock/visible flags: [1, 2, G10[3, 4], 5].
  const node = (id: number, flags: { locked?: boolean; visible?: boolean } = {}) =>
    ({ type: "layer", id, locked: false, visible: true, ...flags }) as unknown as LayerNode;
  const grp = (
    id: number,
    children: LayerNode[],
    flags: { locked?: boolean; visible?: boolean } = {},
  ) =>
    ({
      type: "group",
      id,
      children,
      locked: false,
      visible: true,
      ...flags,
    }) as unknown as LayerNode;

  it("takes the picked layers, and every layer inside a picked group, top first", () => {
    const tree = [node(1), node(2), grp(10, [node(3), node(4)]), node(5)];
    expect(layersToMove(tree, [10, 1])).toEqual({ ids: [4, 3, 1], locked: 0, hidden: 0 });
    expect(layersToMove(tree, [5])).toEqual({ ids: [5], locked: 0, hidden: 0 });
  });

  it("leaves locked and hidden layers, by their own flag or their group's, and counts them", () => {
    const tree = [
      node(1, { locked: true }),
      node(2, { visible: false }),
      grp(10, [node(3), node(4)], { locked: true }),
      grp(20, [node(6)], { visible: false }),
      node(5),
    ];
    expect(layersToMove(tree, [1, 2, 10, 20, 5])).toEqual({ ids: [5], locked: 3, hidden: 2 });
  });
});
