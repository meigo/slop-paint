/** Document resize helpers (2026-10-02): the ratio lock and the steps of a large downscale. Pure. */

export const MAX_DOC_PX = 8192;

const clampDoc = (n: number) => Math.max(1, Math.min(MAX_DOC_PX, Math.round(n)));

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
