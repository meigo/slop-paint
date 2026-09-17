import type { SelectionRect } from "./selection";

/** How far an internal paste is shifted from where it was copied, so it reads as a new copy. */
export const PASTE_OFFSET = 8;

/**
 * Where an external image lands: 1 image px = 1 document px, centred, scaled down (keeping aspect)
 * if it's larger than the document. Never scaled up.
 */
export function placeExternalImage(
  imgW: number,
  imgH: number,
  docW: number,
  docH: number,
): SelectionRect {
  const scale = Math.min(1, docW / imgW, docH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: (docW - w) / 2, y: (docH - h) / 2, w, h };
}

/** Where an internal copy lands: its original spot, nudged by PASTE_OFFSET but kept on the page. */
export function placeInternalPaste(rect: SelectionRect, docW: number, docH: number): SelectionRect {
  const x = Math.min(rect.x + PASTE_OFFSET, Math.max(0, docW - rect.w));
  const y = Math.min(rect.y + PASTE_OFFSET, Math.max(0, docH - rect.h));
  return { x, y, w: rect.w, h: rect.h };
}
