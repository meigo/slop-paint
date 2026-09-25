/** Layout geometry for the resizable layer panel (pure; no DOM). From slop-animator. */

/** Below this the layer detail row wraps to several lines and the name column stops being useful.
 *  It is a floor, not a target — the row is `flex-wrap` by design, so narrower degrades rather than
 *  clips. 180 of usable content PLUS the 4px strip reserved for the resize grip — the guarantee is
 *  about content width, so the reserved strip has to be added on top of it. */
export const MIN_PANEL_WIDTH = 184;
/** Tailwind `w-70`, the fixed width the panel had before it became resizable. */
export const DEFAULT_PANEL_WIDTH = 280;

/** Clamp a proposed layer-panel width (px) to [MIN, 50% of the viewport], MIN always winning —
 *  so a narrow window can never
 *  strand the panel wider than the screen and leave the canvas with nothing. */
export function clampPanelWidth(px: number, viewportW: number): number {
  const max = Math.max(MIN_PANEL_WIDTH, Math.round(viewportW * 0.5));
  return Math.max(MIN_PANEL_WIDTH, Math.min(px, max));
}

/** Width (px) the widest tool-options row (toolbar row 2) needs: the brush row, measured at 949
 *  (eraser 909, outline 886, fill 808, select 539). The rows wrap rather than clip, but a wrapped
 *  row is taller and moves the canvas, so re-measure this when a control is added to one. */
export const TOOL_OPTIONS_WIDTH = 960;

/** Whether the layer panel can sit beside the tool-options row (toolbar row 1 always spans the full
 *  width), or must start below it because the row would wrap next to it (iPad at the default
 *  panel width). */
export function panelBesideToolOptions(viewportW: number, panelW: number): boolean {
  return viewportW - panelW >= TOOL_OPTIONS_WIDTH;
}
