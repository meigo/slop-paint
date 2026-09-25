import getStroke from "perfect-freehand";
import type { InputPoint } from "./input";

/** Pen pressure span, same as slop-animator's Press slider. 1 draws at a constant width. */
export const PRESS_MIN = 1;
export const PRESS_MAX = 8;
export const PRESS_DEFAULT = 3;

/** Snap to the slider's 0.5 step and keep a saved value inside the Press range. */
export function clampPress(n: number): number {
  if (!Number.isFinite(n)) return PRESS_DEFAULT;
  const stepped = Math.round(n * 2) / 2;
  return Math.min(PRESS_MAX, Math.max(PRESS_MIN, stepped));
}

/**
 * Pressure → width. `size` is the nominal width: light pressure thins to `size / sizeRange`
 * (floored at 0.5px), full pressure widens to `size * sizeRange`. `sizeRange === 1` is a
 * constant width — the mouse path, which has no pressure.
 */
export function widthRange(size: number, sizeRange: number): { min: number; max: number } {
  const floored = Math.max(0.5, size);
  return { min: Math.max(0.5, floored / sizeRange), max: floored * sizeRange };
}

/**
 * perfect-freehand's `smoothing` is a DECIMATION DISTANCE: an outline point is dropped unless it
 * is farther than `pfSize * smoothing` from the last kept one. `pfSize` comes from the stroke's
 * MAXIMUM radius, so where the stroke is thin the spacing can exceed its own width; both walls
 * then bridge that run with chords that cross, and the nonzero fill leaves a hole (dashed
 * strokes at high Size range). Capping the spacing at the thinnest width the stroke actually
 * reaches fixes it without over-correcting strokes that never get thin. Ported from
 * slop-animator, where it removed 89% of gap cases in a parameter sweep.
 */
export function decimationSmoothing(
  smoothing: number,
  minStrokeWidth: number,
  pfSize: number,
): number {
  if (!(pfSize > 0)) return Math.max(0, smoothing);
  const cap = Math.max(0, minStrokeWidth) / pfSize;
  return Math.max(0, Math.min(smoothing, cap));
}

export interface BrushSettings {
  size: number;
  color: string;
  opacity: number;
  smoothing: number;
  isEraser: boolean;
  drawBehind: boolean;
  alphaLock: boolean;
  /** Calligraphy nib only: angle in degrees, and how flat the nib is (0 = round). */
  nibAngle?: number;
  nibFlatness?: number;
  /** Ink only: 0-100, how much the mark swells where the nib lingers (0 = off). */
  dwellPool?: number;
  /** Taper the stroke's ends to a point instead of capping them (Smooth brush). */
  taper?: boolean;
}

/**
 * Convert perfect-freehand output points to an SVG path string,
 * then fill it on the canvas for smooth, pressure-sensitive strokes.
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  points: InputPoint[],
  settings: BrushSettings,
  done: boolean = false,
  sizeRange: number = 1.0,
) {
  if (points.length === 0) return;

  const strokePoints = strokeOutline(
    points,
    settings.size,
    settings.smoothing,
    sizeRange,
    done,
    settings.taper ?? false,
  );
  if (strokePoints.length < 2) return;

  ctx.save();

  if (settings.isEraser) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
  } else if (settings.alphaLock) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = settings.opacity / 100;
  } else if (settings.drawBehind) {
    ctx.globalCompositeOperation = "destination-over";
    ctx.globalAlpha = settings.opacity / 100;
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = settings.opacity / 100;
  }

  ctx.fillStyle = settings.color;
  ctx.beginPath();

  const path = getSvgPathFromStroke(strokePoints);
  const path2d = new Path2D(path);
  ctx.fill(path2d);

  ctx.restore();
}

/** The filled outline polygon for a smooth stroke (pure — no canvas). */
export function strokeOutline(
  points: InputPoint[],
  size: number,
  smoothing: number,
  sizeRange: number,
  done: boolean,
  taper: boolean = false,
): number[][] {
  // We map pressure → size ourselves and tell pf thinning=1 so it uses our mapped pressure directly.
  const { min: minSize, max: maxSize } = widthRange(size, sizeRange);
  let minStrokeWidth = Infinity;
  const inputPoints = points.map((p) => {
    const desiredSize = minSize + p.pressure * (maxSize - minSize);
    if (desiredSize < minStrokeWidth) minStrokeWidth = desiredSize;
    const mappedPressure = maxSize > 0 ? desiredSize / maxSize : 1;
    return [p.x, p.y, mappedPressure];
  });

  // perfect-freehand's `size` is a RADIUS basis (diameter = 2 * size * pressure), so pass half:
  // the rendered diameter then equals desiredSize, matching the stamp engine and the size cursor.
  const pfSize = maxSize / 2;

  return getStroke(inputPoints, {
    size: pfSize,
    thinning: 1,
    smoothing: decimationSmoothing(smoothing / 100, minStrokeWidth, pfSize),
    streamline: 0.3,
    start: { taper, cap: !taper },
    end: { taper, cap: !taper },
    last: done,
    // Always use our supplied (mapped) pressure. perfect-freehand's simulatePressure
    // is velocity-based and would override our size mapping, leaving the cursor
    // (which reflects the envelope) out of sync with the rendered stroke.
    simulatePressure: false,
  });
}

/**
 * Turn an array of points into a smooth SVG path using quadratic curves.
 * This is the standard approach from the perfect-freehand docs.
 */
function getSvgPathFromStroke(points: number[][]): string {
  if (points.length === 0) return "";

  const max = points.length - 1;

  return points
    .reduce((acc, point, i, arr) => {
      if (i === 0) {
        return `M ${point[0]},${point[1]} Q`;
      }

      const mid = [
        (point[0] + arr[Math.min(i + 1, max)][0]) / 2,
        (point[1] + arr[Math.min(i + 1, max)][1]) / 2,
      ];

      return `${acc} ${point[0]},${point[1]} ${mid[0]},${mid[1]}`;
    }, "")
    .concat(" Z");
}
