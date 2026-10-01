/** Where a row dragged in the layer panel lands (2026-10-01, after slop-vector-editor's
 *  `layer-drop.ts`; see ../SLOP-LAYER-DRAG.md). Pure: the panel measures the rows, this decides,
 *  and the panel draws the rows' slides, the destination's lines and the commit from the one
 *  result, so what is shown is what lands. */
import {
  hiddenInTree,
  locateNode,
  lockedInTree,
  moveAllowed,
  moveNode,
  type LayerNode,
} from "../layers";

/** A rendered row, in display order (top first), in the list's content coordinates. A group's row
 *  is its header; a collapsed group's members aren't rendered, so they have no row. */
export type RowBox = { kind: "layer" | "group"; id: number; top: number; bottom: number };
/** What `moveNode` takes: the parent (null = the root) and the index in its children as they are. */
export type Drop = { parentId: number | null; index: number };

const mid = (r: RowBox) => (r.top + r.bottom) / 2;

/** The drop for node `dragId` with the pointer at content `y`, or null when it is refused: into a
 *  locked or hidden group (or one inside such a group — the node would become something you can't
 *  draw on or see), a group into its own subtree, or a move that changes nothing.
 *
 *  The upper half of a row puts the node above it, as its sibling; the lower half of a layer row
 *  below it. The lower half of a GROUP's row puts it into that group, at the top. Past the last row, it goes to the bottom of the root, which is the way out of a group
 *  that ends the list. */
export function dropTarget(
  tree: LayerNode[],
  rows: readonly RowBox[],
  y: number,
  dragId: number,
): Drop | null {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  let drop: Drop;
  if (y >= last.bottom) {
    drop = { parentId: null, index: 0 };
  } else {
    const row = rows.find((r) => y >= r.top && y < r.bottom) ?? rows[0];
    const at = locateNode(tree, row.id);
    if (!at) return null;
    const node = at.siblings[at.index];
    const upper = y < mid(row);
    if (!upper && node.type === "group") {
      drop = { parentId: node.id, index: node.children.length };
    } else {
      drop = { parentId: at.group?.id ?? null, index: upper ? at.index + 1 : at.index };
    }
  }
  const into = drop.parentId;
  if (into !== null && (lockedInTree(tree, into) || hiddenInTree(tree, into))) return null;
  if (!moveAllowed(tree, dragId, drop.parentId, drop.index)) return null;
  return drop;
}

/** Why node `id` can't be dragged at all, or "": a member of a locked group can't leave it or be
 *  reordered in it, as the group's lock locks every member. Its own lock doesn't stop it moving
 *  (that lock is on its pixels). */
export function dragBlock(tree: LayerNode[], id: number): string {
  const at = locateNode(tree, id);
  return at?.group && lockedInTree(tree, at.group.id)
    ? "It's in a locked group — unlock the group to move it"
    : "";
}

/** The rendered rows' ids, top first, as they would be after `drop` — what the panel slides the
 *  rows to while dragging (2026-10-01, as slop-spine: the dragged row's own place moves to the
 *  slot, the rows it passes close up, the list keeps its height). Worked out on a copy of the
 *  tree's shape. A collapsed group lists no members, except the dragged node landing in it, which
 *  shows just under the header (where it lands: the group's top). */
export function rowOrderAfter(tree: LayerNode[], dragId: number, drop: Drop): number[] {
  type Shape = { type: LayerNode["type"]; id: number; collapsed: boolean; children: Shape[] };
  const copy = (nodes: LayerNode[]): Shape[] =>
    nodes.map((n) => ({
      type: n.type,
      id: n.id,
      collapsed: n.type === "group" && n.collapsed,
      children: n.type === "group" ? copy(n.children) : [],
    }));
  const shape = copy(tree);
  moveNode(shape as unknown as LayerNode[], dragId, drop.parentId, drop.index);
  const ids: number[] = [];
  const list = (nodes: Shape[]) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      ids.push(n.id);
      if (n.type !== "group") continue;
      list(n.collapsed ? n.children.filter((c) => c.id === dragId) : n.children);
    }
  };
  list(shape);
  return ids;
}
