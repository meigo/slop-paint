/**
 * Flood fill (paint bucket) using a scanline algorithm.
 * Operates on raw ImageData for performance.
 */

import { dilateMask } from "./mask-ops";
import { clampGap, enclosedRegion } from "./fill-holes";

export interface FillOptions {
  /** Color tolerance for matching the clicked pixel's color (0-255) */
  tolerance?: number;
  /** Close breaks in the lines of up to about 2× this many pixels (0 = none; see `fillMask`). */
  gap?: number;
  /** Expand fill by this many pixels to cover antialiased edges. Fill draws behind existing content. */
  expand?: number;
  /** Soft edge: how many pixels (fractions too) the fill runs under the surrounding lines,
   *  behind them; 0 = the hard pixel edge (`climbDepth`, `fillCoverage`). */
  softEdge?: number;
}

/** The most Soft edge goes to, in device px. */
export const MAX_SOFT_EDGE = 2;

/**
 * Each pixel's distance from the tapped colour, 0–255: the largest channel difference, or the
 * alpha alone when the tap was on an empty pixel (an empty pixel's colour means nothing). What
 * `climbDepth` climbs. Pure.
 */
export function colourDistance(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  seed: { r: number; g: number; b: number; a: number },
): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const da = Math.abs(data[p + 3] - seed.a);
    out[i] =
      seed.a === 0
        ? da
        : Math.max(
            Math.abs(data[p] - seed.r),
            Math.abs(data[p + 1] - seed.g),
            Math.abs(data[p + 2] - seed.b),
            da,
          );
  }
  return out;
}

/**
 * How deep under the surrounding lines each pixel is (2026-10-02): 1 for the region itself, k + 1
 * for a pixel k steps into a line, 0 elsewhere. From the region's edge it steps to a neighbouring
 * pixel at least as far from the tapped colour as the one it came from (`dist`; 0 never counts),
 * at most `maxSteps` deep — so it climbs into a line only up to its darkest middle, never past it
 * into the space beyond, nor through a break (an empty pixel is 0). Pure.
 */
export function climbDepth(
  dist: Uint8Array,
  w: number,
  h: number,
  region: Uint8Array,
  maxSteps: number,
): Uint8Array {
  const depth = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let tail = 0;
  for (let i = 0; i < w * h; i++) {
    if (!region[i]) continue;
    depth[i] = 1;
    queue[tail++] = i;
  }
  for (let head = 0; head < tail; head++) {
    const p = queue[head];
    if (depth[p] > maxSteps) continue;
    const x = p % w;
    const floor = Math.max(dist[p], 1);
    const visit = (q: number) => {
      if (depth[q] || dist[q] < floor) return;
      depth[q] = depth[p] + 1;
      queue[tail++] = q;
    };
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (p >= w) visit(p - w);
    if (p < w * (h - 1)) visit(p + w);
  }
  return depth;
}

/**
 * The fill's coverage, 0–255, from `climbDepth`: the region solid, then `soft` px of the line
 * beside it — a pixel k steps in gets clamp(soft − k + 1, 0, 1), so 1 fills the line's first
 * pixel, 0.5 half of it, 1.5 one and a half. Drawn BEHIND the line, so its own antialiased edge
 * blends the two (the flood alone stops in a pixel staircase inside the line's soft edge). Pure.
 */
export function fillCoverage(depth: Uint8Array, soft: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(depth.length);
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i];
    if (d === 1) out[i] = 255;
    else if (d > 1) out[i] = Math.round(255 * Math.max(0, Math.min(1, soft - d + 2)));
  }
  return out;
}

/**
 * The pixels a bucket tap at (sx, sy) fills: 1 = fill. Pixels within `tolerance` of the tapped
 * one (all four channels) are fillable; the rest are walls. `null` for a tap off the canvas.
 *
 * `gap` (clamped to MAX_GAP, as Fill enclosed's Bridge) closes breaks in the walls of up to about
 * 2×gap px: the walls are thickened by `gap`, the flood runs in what's left, and the region is
 * grown back `gap` steps over fillable pixels only (`growWithin`) — so it still reaches the lines,
 * into sharp inside corners too, and pokes only about `gap` px out through a bridged break. A region too narrow to survive the thickening (the tap lands
 * inside it) is filled without bridging instead, so a small pocket still fills.
 */
export function fillMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tolerance: number,
  gap = 0,
): Uint8Array | null {
  if (sx < 0 || sx >= w || sy < 0 || sy >= h) return null;
  const s = (sy * w + sx) * 4;
  const fillable = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    fillable[i] =
      Math.abs(data[p] - data[s]) <= tolerance &&
      Math.abs(data[p + 1] - data[s + 1]) <= tolerance &&
      Math.abs(data[p + 2] - data[s + 2]) <= tolerance &&
      Math.abs(data[p + 3] - data[s + 3]) <= tolerance
        ? 1
        : 0;
  }
  const r = clampGap(gap);
  if (r > 0) {
    const walls = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) walls[i] = fillable[i] ? 0 : 1;
    const thick = dilateMask(walls, w, h, r);
    const start = sy * w + sx;
    if (!thick[start]) {
      const open = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) open[i] = thick[i] ? 0 : 1;
      return growWithin(flood(open, w, h, start), fillable, w, h, r);
    }
  }
  return flood(fillable, w, h, sy * w + sx);
}

/** Grow `region` by `steps` 8-connected steps, only into `allowed` pixels. Square steps reach a
 *  corner a round dilation of the same radius misses (it left the inside corners of a box unfilled
 *  by ~0.4×gap), and staying on `allowed` pixels at each step — never squeezing diagonally between
 *  two wall pixels — means it never crosses a line. */
function growWithin(
  region: Uint8Array,
  allowed: Uint8Array,
  w: number,
  h: number,
  steps: number,
): Uint8Array {
  let edge: number[] = [];
  for (let i = 0; i < w * h; i++) if (region[i]) edge.push(i);
  for (let s = 0; s < steps && edge.length; s++) {
    const next: number[] = [];
    for (const i of edge) {
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const n = ny * w + nx;
          if (region[n] || !allowed[n]) continue;
          // A diagonal step between two wall pixels would slip through a 1px diagonal line.
          if (dx && dy && !allowed[y * w + nx] && !allowed[ny * w + x]) continue;
          region[n] = 1;
          next.push(n);
        }
      }
    }
    edge = next;
  }
  return region;
}

/** The 4-connected region of `open` pixels around `start` (1 = in it). */
function flood(open: Uint8Array, w: number, h: number, start: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (!open[start]) return out;
  out[start] = 1;
  const stack = [start];
  const visit = (n: number) => {
    if (out[n] || !open[n]) return;
    out[n] = 1;
    stack.push(n);
  };
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i + w < w * h) visit(i + w);
  }
  return out;
}

export function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColor: { r: number; g: number; b: number; a: number },
  options: FillOptions = {},
) {
  const tolerance = options.tolerance ?? 32;
  const expand = options.expand ?? 0;

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const sx = Math.round(startX);
  const sy = Math.round(startY);
  if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;

  // Don't fill if clicking on the same color
  const startIdx = (sy * w + sx) * 4;
  if (
    Math.abs(data[startIdx] - fillColor.r) <= tolerance &&
    Math.abs(data[startIdx + 1] - fillColor.g) <= tolerance &&
    Math.abs(data[startIdx + 2] - fillColor.b) <= tolerance &&
    Math.abs(data[startIdx + 3] - fillColor.a) <= tolerance
  ) {
    return;
  }

  // --- Pass 1: the region to fill ---
  const mask = fillMask(data, w, h, sx, sy, tolerance, options.gap ?? 0)!;

  // --- Pass 2: Expand the mask by N pixels (morphological dilation) ---
  let finalMask = mask;
  if (expand > 0) {
    finalMask = dilateMask(mask, w, h, expand);
  }

  // Coverage per pixel, 0–255. With Soft edge the fill also runs under the lines to their ridge
  // and fades out there, drawn BEHIND them; the tapped region itself stays solid.
  const soft = options.softEdge ?? 0;
  const seed = {
    r: data[startIdx],
    g: data[startIdx + 1],
    b: data[startIdx + 2],
    a: data[startIdx + 3],
  };
  const depth = climbDepth(
    soft > 0 ? colourDistance(data, w, h, seed) : new Uint8Array(w * h),
    w,
    h,
    finalMask,
    Math.ceil(soft),
  );
  const cover = fillCoverage(depth, soft);

  // --- Pass 3: Apply fill behind existing content ---
  if (expand > 0) {
    // Draw fill to a temp canvas, then composite behind existing content
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext("2d")!;
    const tempData = tempCtx.createImageData(w, h);
    const td = tempData.data;

    for (let i = 0; i < w * h; i++) {
      if (cover[i]) {
        const pi = i * 4;
        td[pi] = fillColor.r;
        td[pi + 1] = fillColor.g;
        td[pi + 2] = fillColor.b;
        td[pi + 3] = Math.round((fillColor.a * cover[i]) / 255);
      }
    }
    tempCtx.putImageData(tempData, 0, 0);

    // Draw fill behind existing content using destination-over
    ctx.save();
    ctx.resetTransform();
    ctx.globalCompositeOperation = "destination-over";
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.restore();
  } else {
    // No expand — write directly to the image data: the tapped region takes the fill colour; what
    // Soft edge adds under the lines goes BEHIND them (the line stays on top: no halo over it).
    for (let i = 0; i < w * h; i++) {
      const c = cover[i];
      if (!c) continue;
      const pi = i * 4;
      if (finalMask[i]) {
        data[pi] = fillColor.r;
        data[pi + 1] = fillColor.g;
        data[pi + 2] = fillColor.b;
        data[pi + 3] = fillColor.a;
        continue;
      }
      const sa = (fillColor.a / 255) * (c / 255);
      const da = data[pi + 3] / 255;
      const oa = da + sa * (1 - da);
      if (oa <= 0) continue;
      data[pi] = Math.round((data[pi] * da + fillColor.r * sa * (1 - da)) / oa);
      data[pi + 1] = Math.round((data[pi + 1] * da + fillColor.g * sa * (1 - da)) / oa);
      data[pi + 2] = Math.round((data[pi + 2] * da + fillColor.b * sa * (1 - da)) / oa);
      data[pi + 3] = Math.round(oa * 255);
    }
    ctx.putImageData(imageData, 0, 0);
  }
}

export function hexToRgba(
  hex: string,
  opacity: number,
): { r: number; g: number; b: number; a: number } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = Math.round((opacity / 100) * 255);
  return { r, g, b, a };
}

/** "#rrggbb" from 0–255 channels (the inverse of hexToRgba's colour part). */
export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Pixel-identical check, used to skip an undo step for a fill that changed nothing. */
export function sameImageData(a: ImageData, b: ImageData): boolean {
  const x = a.data;
  const y = b.data;
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/**
 * Every region the ink on `canvas` encloses, as a device-px mask — READ-ONLY, so the caller can ask
 * "is there anything to fill?" before it touches the document. `area` 0 means nothing was enclosed
 * (an open outline, or art that is already solid), which the caller must report rather than
 * silently no-op: a no-op and a successful fill of an already-white interior look identical.
 */
export function enclosedFillRegion(
  canvas: HTMLCanvasElement,
  opts: { gap?: number; expand?: number } = {},
): { region: Uint8Array; area: number } {
  const w = canvas.width,
    h = canvas.height;
  if (w === 0 || h === 0) return { region: new Uint8Array(0), area: 0 };
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, w, h);
  return enclosedRegion(data, w, h, { gap: opts.gap, expand: opts.expand });
}

/**
 * Paint `region` (device px, sized to the ctx's canvas) in one pass BEHIND existing content (e.g. white under a black outline).
 *
 * Always composites with destination-over, unlike `floodFill`, which only takes that path when
 * `expand > 0`. Painting behind is the point here, not an artefact of the expand pass.
 */
export function fillRegionBehind(
  ctx: CanvasRenderingContext2D,
  region: Uint8Array,
  fillColor: { r: number; g: number; b: number; a: number },
  softEdge = 0,
): void {
  const w = ctx.canvas.width,
    h = ctx.canvas.height;
  if (w === 0 || h === 0 || region.length < w * h) return;

  const temp = document.createElement("canvas");
  temp.width = w;
  temp.height = h;
  const tctx = temp.getContext("2d")!;
  const img = tctx.createImageData(w, h);
  const td = img.data;
  // Soft edge, as the bucket's: run under the lines to their ridge (climbing the alpha, as the
  // enclosed areas are empty) and fade out there.
  const dist =
    softEdge > 0
      ? colourDistance(ctx.getImageData(0, 0, w, h).data, w, h, { r: 0, g: 0, b: 0, a: 0 })
      : new Uint8Array(w * h);
  const cover = fillCoverage(climbDepth(dist, w, h, region, Math.ceil(softEdge)), softEdge);
  for (let i = 0; i < w * h; i++) {
    if (!cover[i]) continue;
    const pi = i * 4;
    td[pi] = fillColor.r;
    td[pi + 1] = fillColor.g;
    td[pi + 2] = fillColor.b;
    td[pi + 3] = Math.round((fillColor.a * cover[i]) / 255);
  }
  tctx.putImageData(img, 0, 0);

  ctx.save();
  ctx.resetTransform(); // the region is in device px; the caller's CTM must not scale it
  ctx.globalCompositeOperation = "destination-over";
  ctx.drawImage(temp, 0, 0);
  ctx.restore();
}
