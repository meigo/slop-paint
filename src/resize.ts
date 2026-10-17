/** Document resize helpers (2026-10-02): the ratio lock and the steps of a large downscale. Pure. */

export const MAX_DOC_PX = 8192;

const clampDoc = (n: number) => Math.max(1, Math.min(MAX_DOC_PX, Math.round(n)));

/** A side typed in the New / Resize dialog, rounded, or null when it isn't one: empty or
 *  unparsable (Svelte's number binding gives null for ''), or outside 1…8192 once rounded. The
 *  dialogs refuse it with a reason: they used to clamp, so an emptied field made a 1-px side and
 *  Resize cropped every layer to it, with the undo history gone. */
export function docSide(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= 1 && n <= MAX_DOC_PX ? n : null;
}

/** The other side for `value` with the ratio locked: `value` × `to` / `from`, where `from` and
 *  `to` are the document's current sides (so the ratio never drifts as you type), clamped to
 *  1…8192 px. */
export function linkedSize(value: number, from: number, to: number): number {
  if (!(from > 0) || !Number.isFinite(value)) return clampDoc(to);
  return clampDoc((value * to) / from);
}

/**
 * The sizes to shrink through, ending at the target: halve while the next halving still stays at
 * or above it, then the target. One `drawImage` from far larger reads only a few source pixels per
 * destination pixel and aliases (the stamp brushes' tip had the same problem); halving averages
 * properly. Growing or a shrink under 2× is a single step.
 */
export function halvingSteps(
  fromW: number,
  fromH: number,
  toW: number,
  toH: number,
): { w: number; h: number }[] {
  const steps: { w: number; h: number }[] = [];
  let w = fromW;
  let h = fromH;
  while (w / 2 >= toW && h / 2 >= toH && (w / 2 > toW || h / 2 > toH)) {
    w = Math.max(toW, Math.round(w / 2));
    h = Math.max(toH, Math.round(h / 2));
    steps.push({ w, h });
  }
  const last = steps[steps.length - 1];
  if (!last || last.w !== toW || last.h !== toH) steps.push({ w: toW, h: toH });
  return steps;
}

/**
 * The layer resolution Sharp layers uses on a screen of `screenDpr`: the nearest WHOLE ratio, at
 * least 1. Saves scale layers down to document pixels and opening scales them back up
 * nearest-neighbour, which returns exactly the saved pixels only at a whole ratio; at the raw 1.25,
 * 1.5 or 1.75 (Windows scaling, browser zoom) every save and reload softened every layer a little
 * more, and below 1 (zoomed out) opening dropped rows of pixels. Rounding rather than flooring, so
 * 1.5 and 1.75 screens still get sharper layers (2×) instead of none.
 */
export function layerPixelRatio(screenDpr: number): number {
  return Number.isFinite(screenDpr) ? Math.max(1, Math.round(screenDpr)) : 1;
}
