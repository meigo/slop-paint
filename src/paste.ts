import type { SelectionRect } from "./selection";
import { buildName } from "./spine-tags";

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

/** A reference image is an ordinary layer, faint so the drawing on top reads over it. */
export const REFERENCE_OPACITY = 60;

/** Name for a reference layer made from `fileName` (extension dropped) or a paste: `[ignore]` so
 *  Spine's PSD import skips it, and "ref" so it reads as one in the layer list. */
export function referenceLayerName(fileName?: string): string {
  const base = (fileName ?? "").replace(/\.[^.]+$/, "").trim();
  return buildName(base ? `ref ${base}` : "ref", ["ignore"]);
}

const IMAGE_PATH = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;

/**
 * The address of the image a clipboard carries when it doesn't carry the image itself — as when
 * Chrome on iPad copies an image from Midjourney (why is unconfirmed — perhaps a WebP), which it won't
 * hand over as an image. Taken from an `<img>` in the HTML, else a URL in the uri-list or plain
 * text whose path ends in an image extension (so copying a page's link fetches nothing). `null`
 * when there is none, or it isn't http(s).
 */
export function imageUrlFromClipboard(html: string, uriList: string, plain: string): string | null {
  const src = /<img\b[^>]*?\ssrc\s*=\s*(["'])(.*?)\1/i.exec(html)?.[2]?.replace(/&amp;/g, "&");
  if (src && /^https?:\/\//i.test(src)) return src;
  const uri = uriList.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#"));
  for (const candidate of [uri, plain]) {
    const text = candidate?.trim();
    if (!text || !/^https?:\/\/\S+$/i.test(text)) continue;
    try {
      if (IMAGE_PATH.test(new URL(text).pathname)) return text;
    } catch {
      /* not a URL */
    }
  }
  return null;
}
