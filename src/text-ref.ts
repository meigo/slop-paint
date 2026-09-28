/**
 * Building a text reference's source: load its font, lay it out, draw the raster copy that the
 * handles and the PSD use. The layer itself is re-drawn from the layout (`LayerManager.renderRef`),
 * so the raster's resolution never shows on the canvas.
 */
// Each package declares its family with per-subset unicode ranges; the browser fetches a file
// only when text needs it (`document.fonts.load` below).
import "@fontsource/comic-neue/400.css";
import "@fontsource/comic-neue/700.css";
import "@fontsource/bangers/400.css";
import "@fontsource/patrick-hand/400.css";
import type { RefSource } from "./layers";
import { fitDecodedSize, newRefId } from "./ref-placement";
import { readPngText, withPngText } from "./png-text";
import {
  drawTextLayout,
  fontCss,
  layoutText,
  normalizeTextSpec,
  type FontMetrics,
  type TextSpec,
} from "./text-layout";

/** The `tEXt` keyword the settings travel under in the embedded PNG. */
const PNG_KEY = "slop-paint-text";
/** The raster copy is drawn at this many pixels per layout unit (less if that would be huge). */
const RASTER_SCALE = 2;

function measureCtx(): CanvasRenderingContext2D {
  return document.createElement("canvas").getContext("2d")!;
}

function fontMetrics(ctx: CanvasRenderingContext2D, size: number): FontMetrics {
  const all = ctx.measureText("Hxg");
  return {
    // `fontBoundingBox*` is missing on old browsers; these fallbacks are typical of Latin fonts.
    ascent: all.fontBoundingBoxAscent || size * 0.9,
    descent: all.fontBoundingBoxDescent || size * 0.25,
    capHeight: ctx.measureText("H").actualBoundingBoxAscent || size * 0.7,
    xHeight: ctx.measureText("x").actualBoundingBoxAscent || size * 0.5,
  };
}

/** A reference source for `spec`: its layout, a raster copy, and that copy as a PNG carrying the
 *  spec (the Smart Object's embedded file). Waits for the font, so the layout measures it. */
export async function buildTextSource(spec: TextSpec, id: string = newRefId()): Promise<RefSource> {
  const css = fontCss(spec);
  // The sample covers the metrics' letters too; a font that fails to load falls back silently.
  await document.fonts.load(css, `${spec.text}Hxg`).catch(() => {});
  const ctx = measureCtx();
  ctx.font = css;
  const layout = layoutText(spec, (l) => ctx.measureText(l).width, fontMetrics(ctx, spec.size));

  const size = fitDecodedSize(
    Math.ceil(layout.width * RASTER_SCALE),
    Math.ceil(layout.height * RASTER_SCALE),
  );
  const image = document.createElement("canvas");
  image.width = size.w;
  image.height = size.h;
  const ictx = image.getContext("2d")!;
  ictx.scale(size.w / layout.width, size.h / layout.height);
  drawTextLayout(ictx, spec, layout);

  const png = dataUrlBytes(image.toDataURL("image/png"));
  return {
    id,
    name: "text.png",
    bytes: withPngText(png, PNG_KEY, JSON.stringify(spec)),
    width: size.w,
    height: size.h,
    image,
    text: { spec, layout },
  };
}

/** The settings embedded in a text reference's PNG, or null for any other image. */
export function textSpecFromPng(bytes: Uint8Array): TextSpec | null {
  const json = readPngText(bytes, PNG_KEY);
  if (json === null) return null;
  try {
    return normalizeTextSpec(JSON.parse(json));
  } catch {
    return null;
  }
}

function dataUrlBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(",") + 1));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
