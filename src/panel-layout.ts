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

/** Width (px) toolbar row 1 needs: tools, undo/redo, zoom readout and the four menus, measured at
 *  about 735. Row 1 cannot wrap or scroll (either would clip its menus), so re-measure this when a
 *  tool button or menu is added there. */
export const TOOLBAR_ROW1_WIDTH = 740;

/** Whether the layer panel can run full height beside the toolbar rows, or must sit below them
 *  because row 1 would no longer fit next to it (a portrait iPad at the default panel width). */
export function panelBesideToolbar(viewportW: number, panelW: number): boolean {
  return viewportW - panelW >= TOOLBAR_ROW1_WIDTH;
}
