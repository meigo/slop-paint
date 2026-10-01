/** Where a row dragged in the layer panel lands (2026-10-01, after slop-vector-editor's
 *  `layer-drop.ts`; see ../SLOP-LAYER-DRAG.md). Pure: the panel measures the rows, this decides,
 *  and the panel draws the gap, the outline and the commit from the one result, so what is shown
 *  is what lands. */
import { hiddenInTree, locateNode, lockedInTree, moveAllowed, type LayerNode } from "../layers";

/** A rendered row, in display order (top first), in the list's content coordinates. A group's row
 *  is its header; a collapsed group's members aren't rendered, so they have no row. */
export type RowBox = { kind: "layer" | "group"; id: number; top: number; bottom: number };
/** `parentId` (null = the root) and `index` are what `moveNode` takes; `line` is where the gap
 *  opens. */
export type Drop = { parentId: number | null; index: number; line: number };

const mid = (r: RowBox) => (r.top + r.bottom) / 2;

/** The drop for node `dragId` with the pointer at content `y`, or null when it is refused: into a
 *  locked or hidden group (or one inside such a group — the node would become something you can't
 *  draw on or see), a group into its own subtree, or a move that changes nothing.
 *
 *  The upper half of a row puts the node above it, as its sibling; the lower half of a layer row
 *  below it. The lower half of a GROUP's row puts it into that group, at the top — for an expanded
 *  group the gap then opens between the header and its first member, for a collapsed one under the
 *  header. Past the last row, it goes to the bottom of the root, which is the way out of a group
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
    drop = { parentId: null, index: 0, line: last.bottom };
  } else {
    const row = rows.find((r) => y >= r.top && y < r.bottom) ?? rows[0];
    const at = locateNode(tree, row.id);
    if (!at) return null;
    const node = at.siblings[at.index];
    const upper = y < mid(row);
    if (!upper && node.type === "group") {
      drop = { parentId: node.id, index: node.children.length, line: row.bottom };
    } else {
      drop = {
        parentId: at.group?.id ?? null,
        index: upper ? at.index + 1 : at.index,
        line: upper ? row.top : row.bottom,
      };
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
