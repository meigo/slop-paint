/** What a row drag in the layer panel looks like (2026-10-01, copied from slop-vector-editor — see
 *  ../SLOP-LAYER-DRAG.md): the dragged row follows the pointer and its place in the list moves to the
 *  drop slot, the rows in between closing up — drawn over `layer-drop.ts`'s `dropTarget`, which alone decides where
 *  a drop lands.
 *  Pure: no DOM, so it is testable. Every position is in the list's CONTENT coordinates (client y −
 *  list top + scrollTop), measured once when the drag starts, so rows sliding aside never move
 *  the targets they are measured against. */
import type { RowBox } from "./layer-drop";

/** How far the pointer travels before a press on a grip becomes a drag, so a tap lifts nothing. */
export const DRAG_THRESHOLD_PX = 3;
/** One row's height, for the floating row. slop-paint's rows are ~29px, so the panel passes the
 *  dragged row's measured height; this is the default. */
export const ROW_PX = 32;
/** The band at the list's top and bottom edge that scrolls it, and the fastest step per frame. */
export const SCROLL_EDGE_PX = 32;
export const SCROLL_MAX_PX = 12;

export function pastThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

/** How far each row slides while dragging: from where it is to where `order` (the row ids, top
 *  first, after the drop — `layer-drop.ts` `rowOrderAfter`) puts it, stacking the rows by their
 *  own heights from the first row's top. So the dragged row's own place (its members too) moves to
 *  the drop slot and the rows it passes close up behind it, as slop-spine (2026-10-01) and
 *  SortableJS: no extra gap, the list keeps its height. Only rows that move are listed; an empty
 *  `order` (a refused position) slides nothing. Ids `order` lacks are skipped. */
export function slideOffsets(
  rows: readonly RowBox[],
  order: readonly number[],
): Map<number, number> {
  const out = new Map<number, number>();
  if (rows.length === 0 || order.length === 0) return out;
  const byId = new Map(rows.map((r) => [r.id, r]));
  let top = rows[0].top;
  for (const id of order) {
    const r = byId.get(id);
    if (!r) continue;
    if (Math.abs(top - r.top) > 0.5) out.set(id, top - r.top);
    top += r.bottom - r.top;
  }
  return out;
}

/** The floating row's top: the pointer less where on its row it was grabbed, kept inside the
 *  content so it cannot stretch the list (and so feed the auto-scroll) past its end. */
export function ghostTop(y: number, grab: number, contentHeight: number, rowPx = ROW_PX): number {
  return Math.min(Math.max(y - grab, 0), Math.max(contentHeight - rowPx, 0));
}

/** Pixels to scroll this frame for a pointer at client `y` over a list spanning `top`…`bottom`:
 *  negative near the top edge, positive near the bottom, faster the deeper into the band (or past
 *  it), zero elsewhere. */
export function autoScrollStep(y: number, top: number, bottom: number): number {
  const band = Math.min(SCROLL_EDGE_PX, (bottom - top) / 4);
  if (!(band > 0)) return 0;
  const depth = (d: number) => Math.min(d / band, 1) * SCROLL_MAX_PX;
  if (y < top + band) return -Math.ceil(depth(top + band - y));
  if (y > bottom - band) return Math.ceil(depth(y - (bottom - band)));
  return 0;
}
