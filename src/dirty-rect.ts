/** A box in document units (x0, y0 inclusive; x1, y1 exclusive). */
export type Box = { x0: number; y0: number; x1: number; y1: number };
/** A rectangle in whole canvas (device) pixels. */
export type PxRect = { x: number; y: number; w: number; h: number };

/** How far a stroke's paint can reach past its points, in document units: twice the widest width
 *  (half of it is the radius, the rest covers Ink's Pool, wobble and antialiasing) plus 16. */
export function strokePad(maxWidth: number): number {
  return 2 * maxWidth + 16;
}

/** The bounds of `points[from…]`, grown by `pad`; null when there are none. */
export function pointsBox(
  points: readonly { x: number; y: number }[],
  pad: number,
  from = 0,
): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = Math.max(0, from); i < points.length; i++) {
    const p = points[i];
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (x0 > x1) return null;
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/** `box` in whole canvas pixels at `dpr` (grown outward to whole pixels), clipped to a `w` × `h`
 *  canvas; null when nothing of it is on the canvas. */
export function deviceRect(box: Box, dpr: number, w: number, h: number): PxRect | null {
  const x0 = Math.max(0, Math.floor(box.x0 * dpr));
  const y0 = Math.max(0, Math.floor(box.y0 * dpr));
  const x1 = Math.min(w, Math.ceil(box.x1 * dpr));
  const y1 = Math.min(h, Math.ceil(box.y1 * dpr));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
