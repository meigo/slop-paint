/** The Ellipse marquee (2026-11-24): an ellipse is stored as a closed polygon in the selection's
 *  lasso slot, so clip, copy, cut, fill, filters and transforms take it with no code of their own.
 *  Pure, tested. */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Most and fewest outline points. One per page px of perimeter between them: at 1024 points a
 *  4000-px circle's sides bulge by ~0.02 px from the true curve. */
const MAX_POINTS = 1024;
const MIN_POINTS = 16;

/** The ellipse inside `box`, as a closed polygon (last point not repeated), clockwise on screen
 *  from the right-hand middle. */
export function ellipsePoints(box: Box): { x: number; y: number }[] {
  const rx = box.w / 2;
  const ry = box.h / 2;
  const cx = box.x + rx;
  const cy = box.y + ry;
  // Ramanujan's perimeter approximation.
  const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  // A multiple of 4, so the box's four side midpoints are points: the outline reaches the box.
  const n = Math.max(MIN_POINTS, Math.min(MAX_POINTS, 4 * Math.ceil(perimeter / 4)));
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
}

/** The box a drag from `start` to `p` makes; with `circle` (Shift) a square on the longer side,
 *  growing toward `p`, cut so it stays on the page (both points are already on it). */
export function dragBox(
  start: { x: number; y: number },
  p: { x: number; y: number },
  circle: boolean,
  page: { w: number; h: number } | null,
): Box {
  const dx = p.x - start.x;
  const dy = p.y - start.y;
  if (!circle) {
    return {
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(dx),
      h: Math.abs(dy),
    };
  }
  let side = Math.max(Math.abs(dx), Math.abs(dy));
  if (page) {
    side = Math.min(
      side,
      dx >= 0 ? page.w - start.x : start.x,
      dy >= 0 ? page.h - start.y : start.y,
    );
  }
  return {
    x: dx >= 0 ? start.x : start.x - side,
    y: dy >= 0 ? start.y : start.y - side,
    w: side,
    h: side,
  };
}
