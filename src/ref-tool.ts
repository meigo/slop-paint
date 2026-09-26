/** Selecting a reference layer switches to the Select tool, and selecting away hands the tool back
 *  (as slop-animator, 2026-09-26, where it is the Transform tool). A reference can only be
 *  transformed, so leaving Brush lit while its handles are up made the toolbar claim a tool that did
 *  nothing and hid Flip / Keep proportions (Select's options row). Pure: App calls it only when "is
 *  the active layer a reference" CHANGES, never on a tool change, so a tool the artist picks while on
 *  a reference is theirs. */

/** Tools a switch never hands back to: both are one-shots that hand themselves back when done, so
 *  returning to one would re-arm a finished command. */
const ONE_SHOT = new Set(["eyedropper", "outline"]);
/** Tools whose options row already holds the transform controls: nothing to switch. */
const TRANSFORM_ROW = new Set(["select", "lasso"]);

export interface RefToolState<T extends string> {
  tool: T;
  /** The tool to hand back to on leaving the reference; null when there is nothing to hand back. */
  before: T | null;
}

export function refFocusChange<T extends string>(
  onRef: boolean,
  tool: T,
  before: T | null,
  fallback: T,
): RefToolState<T> {
  if (onRef) {
    // Already on Select/Lasso: nothing was switched, so nothing is owed back.
    if (TRANSFORM_ROW.has(tool)) return { tool, before: null };
    return { tool: "select" as T, before: ONE_SHOT.has(tool) ? fallback : tool };
  }
  // Hand back only if still on the Select the switch chose — another tool picked meanwhile is the
  // artist's own choice and stays.
  if (before !== null && tool === "select") return { tool: before, before: null };
  return { tool, before: null };
}
