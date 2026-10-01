/**
 * Stamp-based brush engine.
 * Draws incrementally — only new points since last call.
 */

import type { InputPoint } from "./input";
import type { BrushSettings } from "./brush";
import { widthRange } from "./brush";
import { getTip, type BrushType } from "./brush-textures";

export interface StampBrushSettings extends BrushSettings {
  brushType: BrushType;
}

/** Pencil grades, hardest first, as on real graphite pencils (2026-10-01). */
export const PENCIL_GRADES = ["4H", "2H", "HB", "2B", "4B", "6B", "8B"] as const;
export type PencilGrade = (typeof PENCIL_GRADES)[number];

/** What a grade does to the Pencil: `strength` scales every stamp's alpha (a hard pencil is
 *  lighter), `floor` is how dark the lightest touch already is (a soft one is dark even when barely
 *  pressed; the stamp's pressure alpha runs `floor` → 1), `grain` how much paper shows through the
 *  tip (soft graphite fills the paper's tooth). HB is the Pencil as it was: strength 1, floor 0.5
 *  (the stamp engine's old `0.5 + p × 0.5`), grain 1. An unknown grade is HB. */
export function pencilGrade(grade: string | undefined): {
  strength: number;
  floor: number;
  grain: number;
} {
  switch (grade) {
    case "4H":
      return { strength: 0.55, floor: 0.3, grain: 1.3 };
    case "2H":
      return { strength: 0.75, floor: 0.4, grain: 1.15 };
    case "2B":
      return { strength: 1, floor: 0.62, grain: 0.8 };
    case "4B":
      return { strength: 1, floor: 0.72, grain: 0.6 };
    case "6B":
      return { strength: 1, floor: 0.8, grain: 0.45 };
    case "8B":
      return { strength: 1, floor: 0.88, grain: 0.3 };
    default:
      return { strength: 1, floor: 0.5, grain: 1 };
  }
}

/**
 * Below this box size a 64px tip downsamples to alpha 0 (Chrome samples a couple of texels in the
 * transparent corner), so the stamp draws nothing at all. Measured in slop-animator.
 */
export const MIN_STAMP_PX = 2;

/**
 * The box to stamp into, and how far to fade it. A width under the floor is drawn AT the floor
 * with alpha scaled down in proportion, so a thin stroke fades instead of disappearing.
 */
export function stampFootprint(width: number): { drawSize: number; alphaScale: number } {
  const w = Math.max(0, width);
  if (w >= MIN_STAMP_PX) return { drawSize: w, alphaScale: 1 };
  return { drawSize: MIN_STAMP_PX, alphaScale: w / MIN_STAMP_PX };
}

// Track how many points we've already drawn for incremental stamping
let lastStampCount = 0;
/** Distance travelled since the last stamp, carried across segments AND calls (each pointermove
 *  is one call): reset per call, it stamped at least once per input segment, whatever the size. */
let sinceLastStamp = 0;

/**
 * Where to stamp along one segment of length `segLen`, `step` apart, when `since` has been
 * travelled since the last stamp: the positions, and the distance left over for the next segment.
 */
export function spaceStamps(
  segLen: number,
  step: number,
  since: number,
): { positions: number[]; since: number } {
  const positions: number[] = [];
  for (let pos = Math.max(0, step - since); pos <= segLen; pos += step) positions.push(pos);
  const last = positions[positions.length - 1];
  return { positions, since: last === undefined ? since + segLen : segLen - last };
}
let tintedTip: HTMLCanvasElement | null = null;
let tintedColor = "";
let tintedType: BrushType | null = null;
let tintedGrain = 1;

export function resetStampState() {
  lastStampCount = 0;
  sinceLastStamp = 0;
  tintedTip = null;
}

function getTintedTip(type: BrushType, color: string, grain = 1): HTMLCanvasElement {
  if (tintedTip && tintedColor === color && tintedType === type && tintedGrain === grain) {
    return tintedTip;
  }

  const tip = getTip(type, grain);
  const cvs = document.createElement("canvas");
  cvs.width = tip.width;
  cvs.height = tip.height;
  const ctx = cvs.getContext("2d")!;
  ctx.drawImage(tip, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, cvs.width, cvs.height);

  tintedTip = cvs;
  tintedColor = color;
  tintedType = type;
  tintedGrain = grain;
  return cvs;
}

/**
 * Draw new stamps incrementally onto ctx.
 * Call resetStampState() at stroke start.
 */
export function drawStampStrokeIncremental(
  ctx: CanvasRenderingContext2D,
  points: InputPoint[],
  settings: StampBrushSettings,
  sizeRange: number = 1.0,
  spacing: number = 0.15,
) {
  if (points.length === 0) return;

  const { min: minSize, max: maxSize } = widthRange(settings.size, sizeRange);
  // The Pencil's grade (HB for every other tip: the original numbers).
  const grade = pencilGrade(settings.brushType === "pencil" ? settings.pencilGrade : undefined);
  const tip = getTintedTip(settings.brushType, settings.color, grade.grain);
  // A mouse has no pressure (reported 0): its width is already the nominal one, and its alpha
  // mustn't take the light-pressure half either — mouse stamps drew at half the chosen opacity.
  const hasPressure = points[0].hasPressure ?? true;
  const pressureAlpha = (p: number) =>
    grade.strength * (hasPressure ? grade.floor + p * (1 - grade.floor) : 1);

  ctx.save();
  if (settings.isEraser) {
    ctx.globalCompositeOperation = "destination-out";
  } else if (settings.alphaLock) {
    ctx.globalCompositeOperation = "source-atop";
  } else if (settings.drawBehind) {
    ctx.globalCompositeOperation = "destination-over";
  } else {
    ctx.globalCompositeOperation = "source-over";
  }

  // Only process points we haven't stamped yet
  const startIdx = Math.max(0, lastStampCount - 1);
  const newPoints = points.slice(startIdx);

  if (newPoints.length < 2 && lastStampCount > 0) {
    ctx.restore();
    return;
  }

  // If first stroke point, stamp it
  if (lastStampCount === 0 && newPoints.length > 0) {
    const p = newPoints[0];
    const { drawSize, alphaScale } = stampFootprint(minSize + p.pressure * (maxSize - minSize));
    ctx.globalAlpha = (settings.opacity / 100) * pressureAlpha(p.pressure) * alphaScale;
    ctx.drawImage(tip, p.x - drawSize / 2, p.y - drawSize / 2, drawSize, drawSize);
    sinceLastStamp = 0;
  }

  // Stamp along new segments
  for (let i = 1; i < newPoints.length; i++) {
    const prev = newPoints[i - 1];
    const curr = newPoints[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen === 0) continue;

    const avgSize = minSize + ((prev.pressure + curr.pressure) / 2) * (maxSize - minSize);
    const stepSize = Math.max(1, avgSize * spacing);

    const spaced = spaceStamps(segLen, stepSize, sinceLastStamp);
    for (const pos of spaced.positions) {
      const t = pos / segLen;
      const x = prev.x + dx * t;
      const y = prev.y + dy * t;
      const p = prev.pressure + (curr.pressure - prev.pressure) * t;
      const { drawSize, alphaScale } = stampFootprint(minSize + p * (maxSize - minSize));
      ctx.globalAlpha = (settings.opacity / 100) * pressureAlpha(p) * alphaScale;
      ctx.drawImage(tip, x - drawSize / 2, y - drawSize / 2, drawSize, drawSize);
    }
    sinceLastStamp = spaced.since;
  }

  lastStampCount = points.length;
  ctx.restore();
}
