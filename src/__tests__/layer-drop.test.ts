import { describe, it, expect } from "vitest";
import { dragBlock, dropTarget, rowOrderAfter, type RowBox } from "../lib/layer-drop";
import { moveNode, type LayerNode } from "../layers";

// Plain nodes: the drop rule reads only the tree's shape and its lock/visible/collapsed flags.
const layer = (id: number) => ({ type: "layer", id, locked: false, visible: true }) as LayerNode;
const group = (
  id: number,
  children: LayerNode[],
  flags: { locked?: boolean; visible?: boolean; collapsed?: boolean } = {},
) =>
  ({
    type: "group",
    id,
    children,
    locked: flags.locked ?? false,
    visible: flags.visible ?? true,
    collapsed: flags.collapsed ?? false,
  }) as unknown as LayerNode;

/** The rows the panel would render for `tree`, 10px each, top first. */
function rowsOf(tree: LayerNode[]): RowBox[] {
  const rows: RowBox[] = [];
  const list = (nodes: LayerNode[]) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      rows.push({ kind: n.type, id: n.id, top: rows.length * 10, bottom: rows.length * 10 + 10 });
      if (n.type === "group" && !n.collapsed) list(n.children);
    }
  };
  list(tree);
  return rows;
}
const shape = (nodes: LayerNode[]): unknown[] =>
  nodes.map((n) => (n.type === "group" ? [n.id, ...shape(n.children)] : n.id));

// Bottom-first [1, 2, G10[3, 4], 5]; rows top first: 5 (0–10), G10 (10–20), 4 (20–30), 3 (30–40),
// 2 (40–50), 1 (50–60).
const make = (flags = {}) => [layer(1), layer(2), group(10, [layer(3), layer(4)], flags), layer(5)];

/** Drop `id` at `y` and commit it as the panel does; the resulting shape, or null when refused. */
function dropAt(tree: LayerNode[], id: number, y: number) {
  const d = dropTarget(tree, rowsOf(tree), y, id);
  if (!d) return null;
  expect(moveNode(tree, id, d.parentId, d.index)).toBe(true);
  return shape(tree);
}

describe("dropTarget", () => {
  it("reorders among siblings: upper half above a row, lower half below it", () => {
    expect(dropAt(make(), 1, 2)).toEqual([2, [10, 3, 4], 5, 1]);
    expect(dropAt(make(), 5, 58)).toEqual([5, 1, 2, [10, 3, 4]]);
    expect(dropAt(make(), 5, 43)).toEqual([1, 2, 5, [10, 3, 4]]);
  });

  it("drops into a group: on a member's row, or the lower half of the header (at the top)", () => {
    expect(dropAt(make(), 1, 33)).toEqual([2, [10, 3, 1, 4], 5]);
    expect(dropAt(make(), 5, 17)).toEqual([1, 2, [10, 3, 4, 5]]);
  });

  it("the upper half of a group's header puts the node above the group, outside it", () => {
    expect(dropAt(make(), 1, 12)).toEqual([2, [10, 3, 4], 1, 5]);
  });

  it("takes a member out of its group", () => {
    expect(dropAt(make(), 4, 2)).toEqual([1, 2, [10, 3], 5, 4]);
    expect(dropAt(make(), 3, 70)).toEqual([3, 1, 2, [10, 4], 5]);
  });

  it("a collapsed group takes a drop on its header only", () => {
    const tree = make({ collapsed: true });
    // Rows: 5, G10 (collapsed), 2, 1.
    expect(dropAt(tree, 1, 17)).toEqual([2, [10, 3, 4, 1], 5]);
  });

  it("moves a whole group", () => {
    expect(dropAt(make(), 10, 2)).toEqual([1, 2, 5, [10, 3, 4]]);
  });

  it("refuses a group into itself or onto its own members", () => {
    const tree = make();
    const rows = rowsOf(tree);
    expect(dropTarget(tree, rows, 17, 10)).toBeNull(); // its own header's lower half
    expect(dropTarget(tree, rows, 23, 10)).toBeNull(); // its member's row
  });

  it("refuses a locked group, and anything inside one", () => {
    const tree = make({ locked: true });
    const rows = rowsOf(tree);
    expect(dropTarget(tree, rows, 17, 1)).toBeNull();
    expect(dropTarget(tree, rows, 33, 1)).toBeNull();
    // Beside it is fine.
    expect(dropTarget(tree, rows, 12, 1)).not.toBeNull();
    const nested = [layer(1), group(20, [group(21, [layer(2)])], { locked: true })];
    expect(dropTarget(nested, rowsOf(nested), 17, 1)).toBeNull(); // into G21, inside locked G20
  });

  it("takes a drop into a hidden group, as layers can leave one", () => {
    expect(dropAt(make({ visible: false }), 5, 17)).toEqual([1, 2, [10, 3, 4, 5]]);
    expect(dropAt(make({ visible: false }), 1, 33)).toEqual([2, [10, 3, 1, 4], 5]);
  });

  it("refuses a drop that changes nothing", () => {
    const tree = make();
    const rows = rowsOf(tree);
    expect(dropTarget(tree, rows, 42, 2)).toBeNull(); // its own row, upper half
    expect(dropTarget(tree, rows, 47, 2)).toBeNull(); // its own row, lower half
    expect(dropTarget(tree, rows, 52, 2)).toBeNull(); // the row below, upper half: same gap
    expect(dropTarget(tree, [], 0, 2)).toBeNull();
  });
});

describe("rowOrderAfter", () => {
  // Rows now: 5, G10, 4, 3, 2, 1.
  it("lists the rows as they will be after the drop, a moved group with its members", () => {
    const tree = make();
    expect(rowOrderAfter(tree, 1, { parentId: null, index: 4 })).toEqual([1, 5, 10, 4, 3, 2]);
    expect(rowOrderAfter(tree, 10, { parentId: null, index: 0 })).toEqual([5, 2, 1, 10, 4, 3]);
    expect(rowOrderAfter(tree, 5, { parentId: 10, index: 2 })).toEqual([10, 5, 4, 3, 2, 1]);
  });

  it("shows a node dropped into a collapsed group just under its header, and leaves the tree", () => {
    const tree = make({ collapsed: true });
    // Rows now: 5, G10, 2, 1 (members hidden).
    expect(rowOrderAfter(tree, 1, { parentId: 10, index: 2 })).toEqual([5, 10, 1, 2]);
    expect(shape(tree)).toEqual([1, 2, [10, 3, 4], 5]);
  });
});

describe("dragBlock", () => {
  it("refuses to drag a member of a locked group, not the group or a locked layer", () => {
    const tree = [
      { ...layer(1), locked: true } as LayerNode,
      group(10, [layer(3), group(11, [layer(4)])], { locked: true }),
    ];
    expect(dragBlock(tree, 3)).not.toBe("");
    expect(dragBlock(tree, 4)).not.toBe(""); // inherited from G10
    expect(dragBlock(tree, 10)).toBe("");
    expect(dragBlock(tree, 1)).toBe("");
  });
});
