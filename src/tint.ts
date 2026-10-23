/**
 * Layer tint (pure; 2026-10-23): a layer drawn in ONE colour, keeping its shape — Clip Studio's
 * Layer Colour, Photoshop's Color Overlay — to recolour line art without touching its pixels.
 * Flat: every pixel takes the tint and keeps its alpha, so grey shading inside a line is lost (the
 * user's choice: lines are mostly flat ink). `Layer.tint` holds it as "#rrggbb"; absent = none.
 *
 * In the project PSD it is a Color Overlay effect (`effects.solidFill`), so Photoshop shows it
 * too; the Spine export bakes it into the pixels instead (Spine reads pixels).
 */

import type { LayerEffectsInfo } from "ag-psd";
import { rgbToHex } from "./fill";

/** A tint as a layer stores it: "#rrggbb", lower-case, or undefined for anything else. */
export function normalizeTint(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : undefined;
}

/** The project PSD's Color Overlay for a tint: on, Normal, 100%. */
export function tintEffects(tint: string): LayerEffectsInfo {
  const t = normalizeTint(tint)!;
  return {
    solidFill: [
      {
        enabled: true,
        present: true,
        showInDialog: true,
        blendMode: "normal",
        color: {
          r: parseInt(t.slice(1, 3), 16),
          g: parseInt(t.slice(3, 5), 16),
          b: parseInt(t.slice(5, 7), 16),
        },
        opacity: 1,
      },
    ],
  };
}

/**
 * A layer's tint from a PSD's effects: its first enabled Color Overlay in RGB, unless the
 * effects are switched off as a whole. Its opacity and blend mode aren't read (a tint is flat and
 * full), and other effects are dropped, as every effect was before.
 */
export function tintFromPsd(effects: LayerEffectsInfo | undefined): string | undefined {
  if (!effects || effects.disabled) return undefined;
  const fill = effects.solidFill?.find((f) => f.enabled !== false);
  const c = fill?.color;
  if (!c) return undefined;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  if ("r" in c) return rgbToHex(clamp(c.r), clamp(c.g), clamp(c.b));
  if ("fr" in c) return rgbToHex(clamp(c.fr * 255), clamp(c.fg * 255), clamp(c.fb * 255));
  return undefined; // HSB, CMYK, Lab, grey: not converted
}

/** Draw `source` onto `ctx` (its own size, transform reset by the caller) in `tint`: replaces
 *  what `ctx` held, so it suits a scratch canvas. */
export function drawTinted(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  w: number,
  h: number,
  tint: string,
) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(source, 0, 0, w, h);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
