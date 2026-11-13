// One-off filters (Filter menu): pure per-pixel maths on unpremultiplied RGBA, as `getImageData`
// gives it. App previews them into the layers and keeps the result as one undo step; nothing here
// is live. Gaussian blur, Drop shadow, Glow and Halftone's dots reach into transparent pixels, up
// to `filterReach` px, so App works on the ink's bounds grown by that; every other filter keeps a
// fully transparent pixel transparent.

export type Paper = "transparent" | "white";

export type LevelsSpec = {
  kind: "levels";
  inBlack: number; // 0–253
  inWhite: number; // inBlack + 2 … 255
  gamma: number; // midtones, Photoshop's: > 1 lightens
  outBlack: number; // 0–255
  outWhite: number; // 0–255 (may be below outBlack: inverts)
};
export type HueSatSpec = {
  kind: "hueSat";
  hue: number; // −180…180 degrees
  saturation: number; // −100…100
  lightness: number; // −100…100
};
/** `smooth`: antialias the cut (Threshold and Posterize): a pixel the cut runs through gets a
 *  share of each side, by how far it lies from the cut — else every pixel takes one side (jagged). */
export type ThresholdSpec = { kind: "threshold"; level: number; paper: Paper; smooth: boolean };
export type HalftoneSpec = {
  kind: "halftone";
  cell: number; // screen period in DOCUMENT px (App scales it to the layer's device px)
  angle: number; // degrees
  shape: "dots" | "lines";
  ink: "black" | "colour";
  paper: Paper;
};
/** `colours`: 2–32, picked from the layer. `alphaSteps`: 0 keeps the alpha, else 2–32 levels of it
 *  (transparent one of them), picked from the layer's own as the colours are. */
export type PosterizeSpec = {
  kind: "posterize";
  colours: number;
  alphaSteps: number;
  smooth: boolean;
};
export type BlurSpec = { kind: "blur"; radius: number }; // σ in DOCUMENT px, 0.2–BLUR_MAX
/** Removes `colour` (GIMP's Color to Alpha): each pixel the least alpha that, over `colour`,
 *  looks as it did. */
export type ColourToAlphaSpec = { kind: "colourToAlpha"; colour: string }; // "#rrggbb"
/** Unsharp mask: `amount` % (0–500) of the difference from a blur of σ `radius` DOCUMENT px. */
export type SharpenSpec = { kind: "sharpen"; amount: number; radius: number };
/** Behind the paint: its shape in `colour` at `opacity` % (0–100), blurred by σ `blur` DOCUMENT
 *  px (0–SHADOW_BLUR_MAX), `distance` DOCUMENT px (0–SHADOW_DISTANCE_MAX) away from the light at
 *  `angle` degrees (Photoshop's: 120 = light from the upper left, the shadow falls down-right). */
export type ShadowSpec = {
  kind: "shadow";
  colour: string;
  opacity: number;
  blur: number;
  distance: number;
  angle: number;
};
/** Behind the paint: its shape in `colour` at `opacity` %, blurred by σ `size` DOCUMENT px and
 *  strengthened by `spread` % (0–100: how far it stays solid before fading). */
export type GlowSpec = {
  kind: "glow";
  colour: string;
  opacity: number;
  size: number;
  spread: number;
};
export type FilterSpec =
  | LevelsSpec
  | HueSatSpec
  | PosterizeSpec
  | ThresholdSpec
  | ColourToAlphaSpec
  | HalftoneSpec
  | BlurSpec
  | SharpenSpec
  | ShadowSpec
  | GlowSpec;
export type FilterKind = FilterSpec["kind"];

export const FILTER_DEFAULTS: { [K in FilterKind]: Extract<FilterSpec, { kind: K }> } = {
  levels: { kind: "levels", inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
  hueSat: { kind: "hueSat", hue: 0, saturation: 0, lightness: 0 },
  posterize: { kind: "posterize", colours: 6, alphaSteps: 0, smooth: true },
  threshold: { kind: "threshold", level: 128, paper: "transparent", smooth: true },
  halftone: {
    kind: "halftone",
    cell: 8,
    angle: 45,
    shape: "dots",
    ink: "black",
    paper: "transparent",
  },
  blur: { kind: "blur", radius: 2 },
  colourToAlpha: { kind: "colourToAlpha", colour: "#ffffff" },
  sharpen: { kind: "sharpen", amount: 100, radius: 1 },
  shadow: { kind: "shadow", colour: "#000000", opacity: 60, blur: 4, distance: 8, angle: 120 },
  glow: { kind: "glow", colour: "#ffffff", opacity: 75, size: 8, spread: 0 },
};

/** Gaussian blur's largest radius (σ), in document px. */
export const BLUR_MAX = 64;
/** Halftone's largest cell, in document px. */
export const HALFTONE_CELL_MAX = 48;
/** Sharpen's largest radius (σ), in document px. */
export const SHARPEN_MAX = 10;
/** Drop shadow's and Glow's largest blur (σ), and the shadow's largest distance, in document px. */
export const SHADOW_BLUR_MAX = 64;
export const SHADOW_DISTANCE_MAX = 200;

export const FILTER_TITLES: Record<FilterKind, string> = {
  levels: "Levels",
  hueSat: "Hue/Saturation",
  posterize: "Posterize",
  threshold: "Threshold",
  halftone: "Halftone",
  blur: "Gaussian blur",
  colourToAlpha: "Colour to alpha",
  sharpen: "Sharpen",
  shadow: "Drop shadow",
  glow: "Glow",
};

/** Entries in Hue/Saturation's colour table (a power of two). */
const HUE_CACHE = 1 << 14;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Rec. 601 luma, 0–255. */
export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Levels as a lookup table for one channel value. */
export function levelsLut(s: LevelsSpec): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const span = Math.max(1, s.inWhite - s.inBlack);
  const inv = 1 / Math.max(0.01, s.gamma);
  for (let i = 0; i < 256; i++) {
    const t = Math.pow(clamp01((i - s.inBlack) / span), inv);
    lut[i] = Math.round(s.outBlack + (s.outWhite - s.outBlack) * t);
  }
  return lut;
}

// --- Posterize ---
// The layer's own colours, reduced to `colours` of them (k-means on a colour histogram, distances in
// OKLab, so the groups are the ones the eye sees). Each palette colour is the mean of the paint it
// stands for, so a flat fill keeps its colour; Photoshop's per-channel steps (0, 85, 170, 255 at 4)
// moved every colour to the nearest corner of a grid instead — a yellow to a lemon, a red to a pink.

/** A group whose most common colour holds this share of it takes that colour exactly. */
const DOMINANT = 0.25;

const SRGB_TO_LINEAR = (() => {
  const t = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

/** Linear light of an sRGB value (0–255, may be fractional), interpolated in the table. */
function lin(v: number): number {
  const i = Math.floor(v);
  const f = v - i;
  return i >= 255 ? SRGB_TO_LINEAR[255] : SRGB_TO_LINEAR[i] * (1 - f) + SRGB_TO_LINEAR[i + 1] * f;
}

/** OKLab of an sRGB colour (0–255 each, may be fractional) into `out` at `o`. */
function oklab(r: number, g: number, b: number, out: Float64Array, o: number) {
  const R = lin(r),
    G = lin(g),
    B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  out[o] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[o + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675778 * s;
}

/**
 * Up to `colours` colours standing for the painted pixels of `pixels` (weighted by alpha), as
 * [r, g, b, …] (0–255, rounded). Several buffers (layers) give ONE palette for all of them.
 * Deterministic: the same pixels give the same palette.
 */
export function posterizePalette(
  pixels: Uint8ClampedArray | Uint8ClampedArray[],
  colours: number,
): Uint8ClampedArray {
  const k = Math.max(1, Math.round(colours));
  // A 15-bit histogram: weight and colour sums per bin, so a bin's colour is its pixels' mean.
  const BINS = 1 << 15;
  const wt = new Float64Array(BINS);
  const sum = new Float64Array(BINS * 3);
  for (const rgba of Array.isArray(pixels) ? pixels : [pixels])
    for (let p = 0; p < rgba.length; p += 4) {
      const a = rgba[p + 3];
      if (!a) continue;
      const r = rgba[p],
        g = rgba[p + 1],
        b = rgba[p + 2];
      const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      wt[bin] += a;
      sum[bin * 3] += r * a;
      sum[bin * 3 + 1] += g * a;
      sum[bin * 3 + 2] += b * a;
    }
  const used: number[] = [];
  for (let i = 0; i < BINS; i++) if (wt[i]) used.push(i);
  const n = used.length;
  if (!n) return new Uint8ClampedArray(0);
  const W = new Float64Array(n),
    rgb = new Float64Array(n * 3),
    lab = new Float64Array(n * 3);
  for (let j = 0; j < n; j++) {
    const i = used[j];
    W[j] = wt[i];
    for (let c = 0; c < 3; c++) rgb[j * 3 + c] = sum[i * 3 + c] / wt[i];
    oklab(rgb[j * 3], rgb[j * 3 + 1], rgb[j * 3 + 2], lab, j * 3);
  }
  const K = Math.min(k, n);
  const cen = new Float64Array(K * 3);
  const d2 = new Float64Array(n).fill(Infinity);
  // Seeds: the heaviest colour, then each time the colour with the most weight × distance² from
  // the seeds so far (k-means++, without the dice).
  let pick = 0;
  for (let j = 1; j < n; j++) if (W[j] > W[pick]) pick = j;
  for (let c = 0; c < K; c++) {
    cen.set(lab.subarray(pick * 3, pick * 3 + 3), c * 3);
    let best = -1;
    for (let j = 0; j < n; j++) {
      const dl = lab[j * 3] - cen[c * 3],
        da = lab[j * 3 + 1] - cen[c * 3 + 1],
        db = lab[j * 3 + 2] - cen[c * 3 + 2];
      const d = dl * dl + da * da + db * db;
      if (d < d2[j]) d2[j] = d;
      const score = W[j] * d2[j];
      if (score > best) {
        best = score;
        pick = j;
      }
    }
  }
  // Lloyd's steps until no colour changes group.
  const group = new Int32Array(n).fill(-1);
  const acc = new Float64Array(K * 4);
  for (let iter = 0; iter < 30; iter++) {
    let moved = false;
    acc.fill(0);
    for (let j = 0; j < n; j++) {
      let g = 0,
        bd = Infinity;
      for (let c = 0; c < K; c++) {
        const dl = lab[j * 3] - cen[c * 3],
          da = lab[j * 3 + 1] - cen[c * 3 + 1],
          db = lab[j * 3 + 2] - cen[c * 3 + 2];
        const d = dl * dl + da * da + db * db;
        if (d < bd) {
          bd = d;
          g = c;
        }
      }
      if (group[j] !== g) moved = true;
      group[j] = g;
      acc[g * 4] += W[j];
      for (let q = 0; q < 3; q++) acc[g * 4 + 1 + q] += lab[j * 3 + q] * W[j];
    }
    if (!moved) break;
    for (let c = 0; c < K; c++)
      if (acc[c * 4]) for (let q = 0; q < 3; q++) cen[c * 3 + q] = acc[c * 4 + 1 + q] / acc[c * 4];
  }
  // Each group's colour, as painted: its most common colour when that is at least a quarter of it
  // (a flat fill keeps its exact colour — the mean drifted toward its soft edge's blend), else the
  // mean of its paint (a gradient's group has no colour of its own). Empty groups are dropped.
  const out: number[] = [];
  const tot = new Float64Array(K * 4);
  const top = new Int32Array(K).fill(-1);
  for (let j = 0; j < n; j++) {
    const g = group[j];
    tot[g * 4] += W[j];
    for (let q = 0; q < 3; q++) tot[g * 4 + 1 + q] += rgb[j * 3 + q] * W[j];
    if (top[g] < 0 || W[j] > W[top[g]]) top[g] = j;
  }
  for (let c = 0; c < K; c++) {
    if (!tot[c * 4]) continue;
    const t = top[c];
    for (let q = 0; q < 3; q++)
      out.push(
        Math.round(
          W[t] >= DOMINANT * tot[c * 4] ? rgb[t * 3 + q] : tot[c * 4 + 1 + q] / tot[c * 4],
        ),
      );
  }
  return new Uint8ClampedArray(out);
}

/**
 * Alpha stepped as the colours are: `steps` levels, one of them transparent (fixed, so faint pixels
 * drop out instead of being lifted into sight) and the rest picked from the layer's painted alphas
 * by k-means (a group takes its most common alpha when that is at least a quarter of it, so paint
 * laid at 60% stays 60%). Several buffers (layers) give one table for all. As a table: alpha →
 * stepped alpha.
 */
export function alphaStepLut(
  pixels: Uint8ClampedArray | Uint8ClampedArray[],
  steps: number,
): Uint8ClampedArray {
  const hist = new Float64Array(256);
  for (const rgba of Array.isArray(pixels) ? pixels : [pixels])
    for (let p = 3; p < rgba.length; p += 4) if (rgba[p]) hist[rgba[p]]++;
  const values: number[] = [];
  for (let a = 1; a < 256; a++) if (hist[a]) values.push(a);
  const K = Math.min(Math.max(1, Math.round(steps) - 1), values.length);
  // Centres: index 0 is the fixed transparent level, 1…K are free.
  const cen = [0];
  const d2 = values.map((a) => a * a);
  for (let c = 0; c < K; c++) {
    let pick = -1,
      best = -1;
    for (let j = 0; j < values.length; j++) {
      const score = hist[values[j]] * d2[j];
      if (score > best) {
        best = score;
        pick = j;
      }
    }
    if (best <= 0) break;
    cen.push(values[pick]);
    for (let j = 0; j < values.length; j++)
      d2[j] = Math.min(d2[j], (values[j] - values[pick]) ** 2);
  }
  const nearest = (a: number) => {
    let g = 0;
    for (let c = 1; c < cen.length; c++) if (Math.abs(a - cen[c]) < Math.abs(a - cen[g])) g = c;
    return g;
  };
  for (let iter = 0; iter < 30; iter++) {
    const sw = new Float64Array(cen.length),
      sa = new Float64Array(cen.length);
    for (const a of values) {
      const g = nearest(a);
      sw[g] += hist[a];
      sa[g] += hist[a] * a;
    }
    let moved = false;
    for (let c = 1; c < cen.length; c++) {
      if (!sw[c]) continue;
      const m = sa[c] / sw[c];
      if (Math.abs(m - cen[c]) > 1e-6) moved = true;
      cen[c] = m;
    }
    if (!moved) break;
  }
  // Each free group's level, as for the colours: its most common alpha if it dominates, else the mean.
  const tot = new Float64Array(cen.length),
    sum = new Float64Array(cen.length),
    top = new Int32Array(cen.length).fill(-1);
  for (const a of values) {
    const g = nearest(a);
    tot[g] += hist[a];
    sum[g] += hist[a] * a;
    if (top[g] < 0 || hist[a] > hist[top[g]]) top[g] = a;
  }
  const level = cen.map((_, c) =>
    c === 0 || !tot[c]
      ? 0
      : Math.round(hist[top[c]] >= DOMINANT * tot[c] ? top[c] : sum[c] / tot[c]),
  );
  const lut = new Uint8ClampedArray(256);
  for (let a = 1; a < 256; a++) lut[a] = level[nearest(a)];
  return lut;
}

// --- Gaussian blur ---
/** Below this σ (device px) the blur is a no-op; up to `KERNEL_MAX_SIGMA` it is an exact sampled
 *  Gaussian, above that three box blurs whose widths are picked to give σ (Kovesi's method) — the
 *  same cost at any radius. */
const MIN_SIGMA = 0.25;
const KERNEL_MAX_SIGMA = 3;

export type BlurPlan =
  | { kind: "none"; reach: 0 }
  | { kind: "kernel"; weights: Float32Array; reach: number }
  | { kind: "boxes"; radii: number[]; reach: number };

/** How to blur by σ device px, and how far (px) the blur reaches. */
export function blurPlan(sigma: number): BlurPlan {
  if (!(sigma >= MIN_SIGMA)) return { kind: "none", reach: 0 };
  if (sigma <= KERNEL_MAX_SIGMA) {
    const r = Math.ceil(3 * sigma);
    const weights = new Float32Array(2 * r + 1);
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += weights[i + r] = Math.exp((-i * i) / (2 * sigma * sigma));
    for (let i = 0; i < weights.length; i++) weights[i] /= sum;
    return { kind: "kernel", weights, reach: r };
  }
  const n = 3;
  let wl = Math.floor(Math.sqrt((12 * sigma * sigma) / n + 1));
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const radii = [0, 1, 2].map((i) => ((i < m ? wl : wu) - 1) / 2);
  return { kind: "boxes", radii, reach: radii[0] + radii[1] + radii[2] };
}

/** How far (device px) a filter can move paint: what App grows its working area by. */
export function filterReach(spec: FilterSpec, dpr = 1): number {
  switch (spec.kind) {
    case "blur":
      return blurPlan(spec.radius * dpr).reach;
    case "sharpen":
      return blurPlan(spec.radius * dpr).reach;
    case "glow":
      return blurPlan(spec.size * dpr).reach;
    case "threshold":
    case "posterize":
      return spec.smooth ? EDGE_R + 1 : 0; // the cut's slope is read from pixels round it
    case "halftone":
      // Dots are sampled per cell, and a cell holding paint can reach ~1.42 cells past it (its
      // centre up to 0.71 cell out, its corners 0.71 cell further at 45°): read whole, or its empty
      // pixels go uncounted and the dot comes out too big (2026-11-11 review).
      return spec.shape === "dots" ? Math.ceil(1.5 * spec.cell * dpr) + 2 : 0;
    case "shadow": {
      const { dx, dy } = shadowOffset(spec, dpr);
      return blurPlan(spec.blur * dpr).reach + Math.max(Math.abs(dx), Math.abs(dy));
    }
    default:
      return 0;
  }
}

/** Each kind's settings at its furthest reach (the dialog's slider maxima; the shadow at 0°, where
 *  its offset is the whole distance along one axis). `filterMaxReach` is `filterReach` of these, so
 *  the two can't drift apart: a reach past the max reads outside the snapshot App keeps. */
const MAX_REACH_SPECS: Partial<Record<FilterKind, FilterSpec>> = {
  blur: { ...FILTER_DEFAULTS.blur, radius: BLUR_MAX },
  sharpen: { ...FILTER_DEFAULTS.sharpen, radius: SHARPEN_MAX },
  glow: { ...FILTER_DEFAULTS.glow, size: SHADOW_BLUR_MAX },
  shadow: {
    ...FILTER_DEFAULTS.shadow,
    blur: SHADOW_BLUR_MAX,
    distance: SHADOW_DISTANCE_MAX,
    angle: 0,
  },
  threshold: { ...FILTER_DEFAULTS.threshold, smooth: true },
  posterize: { ...FILTER_DEFAULTS.posterize, smooth: true },
  halftone: { ...FILTER_DEFAULTS.halftone, shape: "dots", cell: HALFTONE_CELL_MAX },
};

/** The most `filterReach` can be for `kind` at any setting: App keeps that much round the ink. */
export function filterMaxReach(kind: FilterKind, dpr = 1): number {
  const spec = MAX_REACH_SPECS[kind];
  return spec ? filterReach(spec, dpr) : 0;
}

/** A rectangle in whole canvas (device) pixels. */
type PxRect = { x: number; y: number; w: number; h: number };

/** Where a filter reaching `reach` px can change anything: the ink's bounds grown by the reach,
 *  inside the layer (`cw` × `ch`), and with a marquee its box grown by the reach too (the blur reads
 *  paint just outside the marquee; the write is clipped to it). Null when that is empty. */
export function filterRect(
  ink: PxRect,
  marquee: PxRect | null,
  cw: number,
  ch: number,
  reach: number,
): PxRect | null {
  let x0 = Math.max(0, ink.x - reach),
    y0 = Math.max(0, ink.y - reach),
    x1 = Math.min(cw, ink.x + ink.w + reach),
    y1 = Math.min(ch, ink.y + ink.h + reach);
  if (marquee) {
    x0 = Math.max(x0, marquee.x - reach);
    y0 = Math.max(y0, marquee.y - reach);
    x1 = Math.min(x1, marquee.x + marquee.w + reach);
    y1 = Math.min(y1, marquee.y + marquee.h + reach);
  }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

export const sameRect = (a: PxRect | null, b: PxRect | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/** Where a drop shadow falls, in whole device px: away from the light (y down). */
export function shadowOffset(s: ShadowSpec, dpr = 1): { dx: number; dy: number } {
  const a = (s.angle * Math.PI) / 180;
  return {
    dx: Math.round(-Math.cos(a) * s.distance * dpr),
    dy: Math.round(Math.sin(a) * s.distance * dpr),
  };
}

/** "#rrggbb" as [r, g, b] (0–255); black for anything else. */
export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** GIMP's Color to Alpha for one pixel (0–255 each): the least alpha (0–1) that, over `key`,
 *  gives `rgb`, and the colour it takes, into `out` [r, g, b, alpha]. */
export function colourToAlphaPixel(
  r: number,
  g: number,
  b: number,
  key: readonly [number, number, number],
  out: number[],
) {
  // Plain locals, no array: this runs per pixel on every preview frame.
  const cr = r / 255,
    cg = g / 255,
    cb = b / 255;
  const kr = key[0] / 255,
    kg = key[1] / 255,
    kb = key[2] / 255;
  const alpha = Math.max(channelAlpha(cr, kr), channelAlpha(cg, kg), channelAlpha(cb, kb));
  if (alpha < 1e-6) {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    out[3] = 0;
    return;
  }
  out[0] = Math.round(((cr - kr) / alpha + kr) * 255);
  out[1] = Math.round(((cg - kg) / alpha + kg) * 255);
  out[2] = Math.round(((cb - kb) / alpha + kb) * 255);
  out[3] = alpha;
}

/** The least alpha (0–1) that, over key value `k`, gives value `c` (both 0–1). */
function channelAlpha(c: number, k: number): number {
  return c > k ? (c - k) / (1 - k) : c < k ? (k - c) / k : 0;
}

/** A horizontal pass over `w`×`h` floats, the edge value repeated past either end — at the canvas
 *  edge that keeps paint touching it solid, and elsewhere App's working area ends in transparent
 *  pixels (or out of the blur's reach). `boxR`: a box of that radius; else the plan's kernel. */
function blurRows(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  plan: BlurPlan,
  boxR: number,
) {
  const last = w - 1;
  if (plan.kind === "kernel") {
    const wts = plan.weights,
      r = plan.reach;
    for (let y = 0; y < h; y++) {
      const base = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) {
          const q = x + k;
          acc += wts[k + r] * src[base + (q < 0 ? 0 : q > last ? last : q)];
        }
        dst[base + x] = acc;
      }
    }
    return;
  }
  const r = boxR,
    inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const base = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[base + (k < 0 ? 0 : k > last ? last : k)];
    for (let x = 0; x < w; x++) {
      dst[base + x] = sum * inv;
      const add = x + r + 1,
        drop = x - r;
      sum += src[base + (add > last ? last : add)] - src[base + (drop < 0 ? 0 : drop)];
    }
  }
}

/** The vertical pass, walked ROW by row (a running sum per column, or whole rows weighted): going
 *  down each column jumps a row's length per value, which missed the cache on every read — a
 *  12-megapixel blur took ~7 s in WebKit that way. `colSum` holds at least `w` values. */
function blurCols(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  plan: BlurPlan,
  boxR: number,
  colSum: Float64Array,
) {
  const last = h - 1;
  const row = (y: number) => (y < 0 ? 0 : y > last ? last : y) * w;
  if (plan.kind === "kernel") {
    const wts = plan.weights,
      r = plan.reach;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      dst.fill(0, o, o + w);
      for (let k = -r; k <= r; k++) {
        const wt = wts[k + r],
          i = row(y + k);
        for (let x = 0; x < w; x++) dst[o + x] += wt * src[i + x];
      }
    }
    return;
  }
  const r = boxR,
    inv = 1 / (2 * r + 1);
  colSum.fill(0, 0, w);
  for (let k = -r; k <= r; k++) {
    const i = row(k);
    for (let x = 0; x < w; x++) colSum[x] += src[i + x];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w,
      add = row(y + r + 1),
      drop = row(y - r);
    for (let x = 0; x < w; x++) {
      dst[o + x] = colSum[x] * inv;
      colSum[x] += src[add + x] - src[drop + x];
    }
  }
}

/** Blur one channel (`w`×`h` floats) in place; `tmp` holds at least as many. */
export function blurChannel(
  a: Float32Array,
  w: number,
  h: number,
  plan: BlurPlan,
  tmp: Float32Array,
) {
  if (plan.kind === "none") return;
  const colSum = new Float64Array(w);
  if (plan.kind === "kernel") {
    blurRows(a, tmp, w, h, plan, 0);
    blurCols(tmp, a, w, h, plan, 0, colSum);
    return;
  }
  for (const r of plan.radii) {
    if (r < 1) continue;
    blurRows(a, tmp, w, h, plan, r);
    blurCols(tmp, a, w, h, plan, r, colSum);
  }
}

/** Float work buffers, kept between previews: a slider drag re-runs the blur every frame, and three
 *  layer-sized arrays a frame churned the collector. Let go by `releaseFilterBuffers`. */
let blurBufs: Float32Array[] = [];
function blurBuffers(n: number): Float32Array[] {
  if (blurBufs.length !== 3 || blurBufs[0].length < n)
    blurBufs = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  return blurBufs.map((b) => b.subarray(0, n));
}
/** Halftone dots' per-cell planes (`halftoneDots`). */
let dotBufs = new Float32Array(0);
export function releaseFilterBuffers() {
  blurBufs = [];
  dotBufs = new Float32Array(0);
}

/** Luma histogram of the painted pixels, each counted by its alpha (a faint edge counts little). */
export function lumaHistogram(rgba: Uint8ClampedArray): Float64Array {
  const h = new Float64Array(256);
  for (let p = 0; p < rgba.length; p += 4) {
    const a = rgba[p + 3];
    if (a) h[Math.round(luma(rgba[p], rgba[p + 1], rgba[p + 2]))] += a / 255;
  }
  return h;
}

/** OKLab → sRGB (0–1 per channel, unclamped, into `out`); whether it lies inside sRGB. */
function oklabToRgb(L: number, a: number, b: number, out: Float64Array): boolean {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  out[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const E = 1e-7;
  return (
    out[0] >= -E &&
    out[0] <= 1 + E &&
    out[1] >= -E &&
    out[1] <= 1 + E &&
    out[2] >= -E &&
    out[2] <= 1 + E
  );
}

/** Linear light (0–1) to an sRGB byte. */
function toSrgbByte(v: number): number {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(c * 255);
}

/** The most chroma sRGB can show at OKLCH lightness `L` and hue `h` (radians). */
function maxChroma(L: number, h: number, tmp: Float64Array): number {
  const ca = Math.cos(h),
    sa = Math.sin(h);
  let lo = 0,
    hi = 0.5;
  for (let i = 0; i < 20; i++) {
    const c = (lo + hi) / 2;
    if (oklabToRgb(L, c * ca, c * sa, tmp)) lo = c;
    else hi = c;
  }
  return lo;
}

const HS_LAB = new Float64Array(3);
const HS_RGB = new Float64Array(3);

/**
 * One pixel's Hue/Saturation/Lightness shift, rgb 0–255 in and out (written to `out`), in OKLCH
 * (2026-11-11): lightness there is what the eye sees. In HSL (as Photoshop's), lightness is (max +
 * min) / 2 — a red/blue blend's purple, as bright as the red to the eye, went to a grey 20 darker
 * than either end at −100 saturation, and the blue beside that valley read as a glowing rim; a hue
 * turn changed how light colours look (yellow to blue went dark). Hue turns the hue angle;
 * saturation scales chroma down to grey (−100) or moves it toward the most sRGB can show at that
 * lightness and hue (+100); lightness moves toward black or white. A colour sRGB can't show loses
 * chroma, keeping its lightness and hue.
 */
export function hueSatPixel(
  r: number,
  g: number,
  b: number,
  s: HueSatSpec,
  out: number[] | Uint8ClampedArray,
  o = 0,
): void {
  if (!s.hue && !s.saturation && !s.lightness) {
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    return;
  }
  oklab(r, g, b, HS_LAB, 0);
  let L = HS_LAB[0];
  const C = Math.hypot(HS_LAB[1], HS_LAB[2]);
  const grey = C < 1e-4;
  const h = Math.atan2(HS_LAB[2], HS_LAB[1]) + (s.hue * Math.PI) / 180;
  const kl = s.lightness / 100;
  L = clamp01(kl < 0 ? L * (1 + kl) : L + (1 - L) * kl);
  const ks = s.saturation / 100;
  // The gamut's edge is searched for only when needed: a saturation boost, or a result outside.
  let c = grey ? 0 : C * (ks < 0 ? 1 + ks : 1);
  if (ks > 0 && !grey) {
    const cap = maxChroma(L, h, HS_RGB);
    c = C + (Math.max(cap, C) - C) * ks;
    if (c > cap) c = cap;
  }
  if (!oklabToRgb(L, c * Math.cos(h), c * Math.sin(h), HS_RGB)) {
    c = Math.min(c, maxChroma(L, h, HS_RGB));
    oklabToRgb(L, c * Math.cos(h), c * Math.sin(h), HS_RGB);
  }
  out[o] = toSrgbByte(HS_RGB[0]);
  out[o + 1] = toSrgbByte(HS_RGB[1]);
  out[o + 2] = toSrgbByte(HS_RGB[2]);
}

/** Share of a unit cell a centred disc of radius `r` (in cells) covers, its parts beyond the cell's
 *  sides cut off (neighbouring dots cover those). */
function discInCell(r: number): number {
  if (r <= 0.5) return Math.PI * r * r;
  if (r >= Math.SQRT1_2) return 1;
  const seg = r * r * Math.acos(0.5 / r) - 0.5 * Math.sqrt(r * r - 0.25);
  return Math.PI * r * r - 4 * seg;
}

/** Dot radius in cells for each tone in 1/1024 steps (`discInCell` inverted by bisection). */
const DOT_LUT = (() => {
  const lut = new Float64Array(1025);
  for (let i = 0; i <= 1024; i++) {
    const t = i / 1024;
    let lo = 0,
      hi = Math.SQRT1_2;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (discInCell(mid) < t) lo = mid;
      else hi = mid;
    }
    lut[i] = hi;
  }
  return lut;
})();

/**
 * The radius (px) of a halftone dot covering `tone` (0–1) of its cell: exact areas, the dots
 * overlapping into a solid past π/4. Near 1 it grows by up to half a pixel more, so a solid tone
 * leaves no antialiased specks at the cell corners.
 */
export function dotRadius(tone: number, cell: number): number {
  const t = clamp01(tone);
  const f = t * 1024,
    i = Math.min(1023, Math.floor(f));
  const r = DOT_LUT[i] + (DOT_LUT[i + 1] - DOT_LUT[i]) * (f - i);
  return cell * r + Math.max(0, (t - 0.95) / 0.05) * 0.5;
}

/** How much of the pixel [d − ½, d + ½] (1-D, px) a band [−hw, hw] covers. */
function bandCover(d: number, hw: number): number {
  return clamp01(Math.min(hw, d + 0.5) - Math.max(-hw, d - 0.5));
}

/** Coverage (0–1) of the halftone screen at device pixel (x, y) for a tone. The screen is anchored
 *  to the canvas, so it lines up from layer to layer and across separate runs. */
export function halftoneCoverage(
  x: number,
  y: number,
  tone: number,
  cell: number,
  cos: number,
  sin: number,
  shape: "dots" | "lines",
): number {
  if (tone <= 0) return 0;
  if (tone >= 1) return 1;
  const px = x + 0.5,
    py = y + 0.5;
  if (shape === "lines") {
    const v = (-px * sin + py * cos) / cell;
    const d = Math.abs(v - Math.round(v)) * cell; // to the nearest line's middle, ≤ cell / 2
    const hw = (tone * cell) / 2;
    return Math.min(1, bandCover(d, hw) + bandCover(cell - d, hw));
  }
  const u = (px * cos + py * sin) / cell;
  const v = (-px * sin + py * cos) / cell;
  const d = Math.hypot(u - Math.round(u), v - Math.round(v)) * cell;
  const r = dotRadius(tone, cell);
  // Antialiased edge; a dot under a pixel across is drawn fainter, not as a half-grey pixel.
  return clamp01(r - d + 0.5) * Math.min(1, 2 * r);
}

/** One pixel of halftone output: ink (`r`, `g`, `b`) covering `c` of it, over transparent paper or
 *  white at the pixel's own alpha `a` (0–255). Alpha lock: no more alpha than `a`. */
function halftoneInk(
  out: Uint8ClampedArray,
  p: number,
  r: number,
  g: number,
  b: number,
  c: number,
  a: number,
  white: boolean,
  alphaLock: boolean,
) {
  const pa = a / 255;
  if (alphaLock) c = Math.min(c, pa);
  if (white) {
    // Solid ink over white paper at the layer's own alpha.
    const oa = c + pa * (1 - c);
    if (oa <= 0) {
      out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
      return;
    }
    const k = (1 - c) * pa * 255;
    out[p] = Math.round((r * c + k) / oa);
    out[p + 1] = Math.round((g * c + k) / oa);
    out[p + 2] = Math.round((b * c + k) / oa);
    out[p + 3] = Math.round(oa * 255);
  } else {
    out[p] = r;
    out[p + 1] = g;
    out[p + 2] = b;
    out[p + 3] = Math.round(c * 255);
  }
}

/**
 * Halftone dots, ONE tone and ONE colour per dot (2026-11-11, the user's ask): each pixel adds its
 * tone (darkness × alpha, as on white) and colour to the screen cell it lies in, and each cell then
 * draws a round dot of that cell's mean tone (`dotRadius`) in its alpha-weighted mean colour. Per
 * pixel, a dot over a change of tone came out half big, half small, and its colour shifted across
 * it. A pixel is covered by the deepest of the four dots round it (dots past half tone overlap their
 * neighbours). A dot may reach past the paint by its radius, as printed screens do; App's area grows
 * by `filterReach`, so each cell is read whole.
 */
function halftoneDots(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  w: number,
  h: number,
  ox: number,
  oy: number,
  cell: number,
  cos: number,
  sin: number,
  black: boolean,
  white: boolean,
  alphaLock: boolean,
) {
  // Screen coordinates (in cells) of the area's corners: the lattice points it needs, plus one.
  const uv = (x: number, y: number) => [(x * cos + y * sin) / cell, (-x * sin + y * cos) / cell];
  let i0 = Infinity,
    j0 = Infinity,
    i1 = -Infinity,
    j1 = -Infinity;
  for (const [x, y] of [
    [ox, oy],
    [ox + w, oy],
    [ox, oy + h],
    [ox + w, oy + h],
  ]) {
    const [u, v] = uv(x, y);
    i0 = Math.min(i0, Math.floor(u) - 1);
    j0 = Math.min(j0, Math.floor(v) - 1);
    i1 = Math.max(i1, Math.ceil(u) + 1);
    j1 = Math.max(j1, Math.ceil(v) + 1);
  }
  const ni = i1 - i0 + 1,
    nj = j1 - j0 + 1;
  const nc = ni * nj;
  // Per cell: pixel count, tone sum, alpha sum, and alpha-weighted colour sums; then the dot's
  // radius and whether it passes half a cell. Kept between previews (`dotBufs`, as the blur's): new
  // arrays every frame were ~160 MB a slider tick at a small cell on a full 4000×6000 layer.
  if (dotBufs.length < nc * 8) dotBufs = new Float32Array(nc * 8);
  dotBufs.fill(0, 0, nc * 8);
  const plane = (i: number) => dotBufs.subarray(i * nc, (i + 1) * nc);
  const cnt = plane(0),
    tone = plane(1),
    al = plane(2),
    cr = plane(3),
    cg = plane(4),
    cb = plane(5);
  for (let y = 0, p = 0; y < h; y++) {
    const py = oy + y + 0.5;
    for (let x = 0; x < w; x++, p += 4) {
      const px = ox + x + 0.5;
      const k =
        (Math.round((-px * sin + py * cos) / cell) - j0) * ni +
        (Math.round((px * cos + py * sin) / cell) - i0);
      cnt[k]++;
      const a = src[p + 3];
      if (!a) continue;
      const r = src[p],
        g = src[p + 1],
        b = src[p + 2];
      tone[k] += (1 - luma(r, g, b) / 255) * (a / 255);
      al[k] += a;
      cr[k] += r * a;
      cg[k] += g * a;
      cb[k] += b * a;
    }
  }
  // Each cell's dot radius and colour, and whether the dot passes half a cell (overlaps).
  const rad = plane(6);
  const big = plane(7); // 0 or 1
  for (let k = 0; k < nc; k++) {
    if (!cnt[k] || !al[k]) continue;
    rad[k] = dotRadius(tone[k] / cnt[k], cell);
    big[k] = rad[k] + 0.5 > cell / 2 ? 1 : 0;
    if (!black) {
      cr[k] /= al[k];
      cg[k] /= al[k];
      cb[k] /= al[k];
    }
  }
  for (let y = 0, p = 0; y < h; y++) {
    const py = oy + y + 0.5;
    for (let x = 0; x < w; x++, p += 4) {
      const px = ox + x + 0.5;
      const u = (px * cos + py * sin) / cell,
        v = (-px * sin + py * cos) / cell;
      const fu = Math.floor(u),
        fv = Math.floor(v);
      // The four lattice points round the pixel: the deepest dot covering it wins. Unless one of
      // them is big enough to pass half a cell (and overlap), only the nearest can cover it.
      const ka = (fv - j0) * ni + (fu - i0);
      let c = 0,
        best = -Infinity,
        kb = -1;
      if (big[ka] | big[ka + 1] | big[ka + ni] | big[ka + ni + 1]) {
        for (let dj = 0; dj <= 1; dj++) {
          for (let di = 0; di <= 1; di++) {
            const k = ka + dj * ni + di;
            const r = rad[k];
            if (!r) continue;
            const du = u - fu - di,
              dv = v - fv - dj;
            const d = Math.sqrt(du * du + dv * dv) * cell;
            const cov = clamp01(r - d + 0.5) * Math.min(1, 2 * r);
            if (cov > c) c = cov;
            if (cov > 0 && r - d > best) {
              best = r - d;
              kb = k;
            }
          }
        }
      } else {
        const di = u - fu < 0.5 ? 0 : 1,
          dj = v - fv < 0.5 ? 0 : 1;
        const k = ka + dj * ni + di;
        const r = rad[k];
        if (r) {
          const du = u - fu - di,
            dv = v - fv - dj;
          const d = Math.sqrt(du * du + dv * dv) * cell;
          c = clamp01(r - d + 0.5) * Math.min(1, 2 * r);
          if (c > 0) kb = k;
        }
      }
      const a = src[p + 3];
      if (kb < 0) {
        halftoneInk(out, p, 0, 0, 0, 0, a, white, alphaLock);
        continue;
      }
      halftoneInk(
        out,
        p,
        black ? 0 : Math.round(cr[kb]),
        black ? 0 : Math.round(cg[kb]),
        black ? 0 : Math.round(cb[kb]),
        c,
        a,
        white,
        alphaLock,
      );
    }
  }
}

/** How far (px) round a pixel the smooth cut reads the field. A slow blend in 8 bits holds runs of
 *  2–3 equal pixels: read between neighbours, the slope was often 0 and the cut could only fall at
 *  a run's end — Posterize's smooth edges came out as stepped as hard ones. */
const EDGE_R = 2;

/**
 * Which pixels lie within EDGE_R px (a square round them) of a change of `label` — the only ones a
 * smooth cut can make partial. One pass marking each change, then a box max across and down.
 */
export function edgeBand(label: Int8Array | Uint8Array, w: number, h: number): Uint8Array {
  const mark = new Uint8Array(w * h);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      if (x < w - 1 && label[i] !== label[i + 1]) mark[i] = mark[i + 1] = 1;
      if (y < h - 1 && label[i] !== label[i + w]) mark[i] = mark[i + w] = 1;
    }
  }
  const tmp = new Uint8Array(w * h);
  const R = EDGE_R;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = Math.max(0, x - R); k <= Math.min(w - 1, x + R) && !v; k++) v = mark[row + k];
      tmp[row + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = Math.max(0, y - R); k <= Math.min(h - 1, y + R) && !v; k++) v = tmp[k * w + x];
      mark[y * w + x] = v;
    }
  }
  return mark;
}

/**
 * How much of pixel (`x`, `y`) of a `w`×`h` area lies on the positive side of the cut where the
 * field `f` crosses 0 (`f(j)` for pixel index j; NaN: no value there, left out). The field is taken
 * as linear: the cut lies f / slope px away, so the pixel's share is 0.5 + that, clamped. The slope
 * is read across ±EDGE_R px. The value is the mean of the square round the pixel (exact for a
 * linear field, and it smooths out an 8-bit blend's runs) when that agrees with the pixel's own to
 * within 1.5 px of slope; else the pixel's own — a 1-px line isn't averaged away, and a cut through
 * a hard step (slope smaller than the step) leaves both sides whole.
 */
export function fieldShare(
  x: number,
  y: number,
  w: number,
  h: number,
  f: (j: number) => number,
): number {
  const R = EDGE_R;
  const f0 = f(y * w + x);
  // The square's samples: their mean, and the means of its outer columns and rows (the slope).
  let sum = 0,
    n = 0,
    lS = 0,
    lN = 0,
    rS = 0,
    rN = 0,
    uS = 0,
    uN = 0,
    dS = 0,
    dN = 0;
  for (let dy = -R; dy <= R; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= h) continue;
    for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= w) continue;
      const v = f(yy * w + xx);
      if (v !== v) continue;
      sum += v;
      n++;
      if (dx === -R) {
        lS += v;
        lN++;
      } else if (dx === R) {
        rS += v;
        rN++;
      }
      if (dy === -R) {
        uS += v;
        uN++;
      } else if (dy === R) {
        dS += v;
        dN++;
      }
    }
  }
  const mean = n ? sum / n : f0;
  const grad = (aS: number, aN: number, bS: number, bN: number) =>
    aN && bN
      ? (bS / bN - aS / aN) / (2 * R)
      : bN
        ? (bS / bN - mean) / R
        : aN
          ? (mean - aS / aN) / R
          : 0;
  const slope = Math.hypot(grad(lS, lN, rS, rN), grad(uS, uN, dS, dN));
  const v = Math.abs(mean - f0) <= 1.5 * slope ? mean : f0;
  if (slope < 1e-9) return v > 0 ? 1 : v < 0 ? 0 : 0.5;
  return clamp01(0.5 + v / slope);
}

/**
 * Posterize's smooth edges, over the hard result in `out`: a pixel within EDGE_R px of another
 * palette colour (`edgeBand`) gets a mix of its colour and that one, by how far the border between
 * them (equal OKLab distance to both: a plane through colour space, so a field linear in the
 * pixel's OKLab) lies from it — `fieldShare`. Alpha steps likewise: the cut halfway between two
 * levels, read on the source alpha. Transparent pixels stay transparent. Each colour's OKLab is
 * worked out once, through a direct-mapped table.
 */
function posterizeEdges(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  w: number,
  h: number,
  pal: Uint8ClampedArray,
  palLab: Float64Array,
  near: Int8Array,
  aLut: Uint8ClampedArray | null,
) {
  const m = w * h;
  const idx = new Int8Array(m).fill(-1);
  const lvl = aLut ? new Uint8Array(m) : null;
  for (let i = 0, p = 0; i < m; i++, p += 4) {
    if (src[p + 3])
      idx[i] = near[((src[p] >> 3) << 10) | ((src[p + 1] >> 3) << 5) | (src[p + 2] >> 3)];
    if (lvl) lvl[i] = aLut![src[p + 3]];
  }
  const colourBand = edgeBand(idx, w, h);
  const alphaBand = lvl ? edgeBand(lvl, w, h) : null;
  const keys = new Int32Array(HUE_CACHE).fill(-1);
  const vals = new Float64Array(HUE_CACHE * 3);
  /** Index of pixel j's OKLab in `vals`. */
  const labOf = (j: number) => {
    const q = j * 4;
    const k = (src[q] << 16) | (src[q + 1] << 8) | src[q + 2];
    const slot = (Math.imul(k, 0x9e3779b1) >>> 16) & (HUE_CACHE - 1);
    if (keys[slot] !== k) {
      keys[slot] = k;
      oklab(src[q], src[q + 1], src[q + 2], vals, slot * 3);
    }
    return slot * 3;
  };
  // d²(x, c2) − d²(x, c1) = x · 2(c1 − c2) + |c2|² − |c1|²: linear in x.
  let nx = 0,
    ny = 0,
    nz = 0,
    k0 = 0,
    l1 = 0,
    l2 = 0;
  const colourField = (j: number) => {
    if (idx[j] < 0) return NaN;
    const o = labOf(j);
    return vals[o] * nx + vals[o + 1] * ny + vals[o + 2] * nz + k0;
  };
  const alphaField = (j: number) => (src[j * 4 + 3] - (l1 + l2) / 2) * (l1 > l2 ? 1 : -1);
  const R = EDGE_R;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const c1 = idx[i];
      if (c1 < 0) continue;
      const p = i * 4;
      if (colourBand[i]) {
        // The other side: of the palette colours within R px, the one nearest this pixel's own.
        const o = labOf(i);
        let best = Infinity,
          c2 = -1;
        for (let yy = Math.max(0, y - R); yy <= Math.min(h - 1, y + R); yy++) {
          for (let xx = Math.max(0, x - R); xx <= Math.min(w - 1, x + R); xx++) {
            const c = idx[yy * w + xx];
            if (c < 0 || c === c1 || c === c2) continue;
            const dl = vals[o] - palLab[c * 3],
              da = vals[o + 1] - palLab[c * 3 + 1],
              db = vals[o + 2] - palLab[c * 3 + 2];
            const d = dl * dl + da * da + db * db;
            if (d < best) {
              best = d;
              c2 = c;
            }
          }
        }
        if (c2 >= 0) {
          const a1 = c1 * 3,
            a2 = c2 * 3;
          nx = 2 * (palLab[a1] - palLab[a2]);
          ny = 2 * (palLab[a1 + 1] - palLab[a2 + 1]);
          nz = 2 * (palLab[a1 + 2] - palLab[a2 + 2]);
          k0 =
            palLab[a2] ** 2 +
            palLab[a2 + 1] ** 2 +
            palLab[a2 + 2] ** 2 -
            (palLab[a1] ** 2 + palLab[a1 + 1] ** 2 + palLab[a1 + 2] ** 2);
          const t = fieldShare(x, y, w, h, colourField);
          for (let ch = 0; ch < 3; ch++)
            out[p + ch] = Math.round(pal[a1 + ch] * t + pal[a2 + ch] * (1 - t));
        }
      }
      if (alphaBand && alphaBand[i]) {
        // Alpha: between this pixel's level and the nearest other level within R px
        // (transparent pixels count: that is the shape's edge).
        const a = src[p + 3];
        l1 = lvl![i];
        let al = -1;
        for (let yy = Math.max(0, y - R); yy <= Math.min(h - 1, y + R); yy++) {
          for (let xx = Math.max(0, x - R); xx <= Math.min(w - 1, x + R); xx++) {
            const l = lvl![yy * w + xx];
            if (l !== l1 && (al < 0 || Math.abs(l - a) < Math.abs(al - a))) al = l;
          }
        }
        if (al >= 0) {
          l2 = al;
          const t = fieldShare(x, y, w, h, alphaField);
          out[p + 3] = Math.round(l1 * t + l2 * (1 - t));
        }
      }
    }
  }
}

/** What a filter works out from ALL the layers it runs on, so they come out alike (Posterize: one
 *  palette and one set of alpha steps — picked per layer, two layers' reds became two reds). */
export type FilterShared = { palette?: Uint8ClampedArray; alphaLut?: Uint8ClampedArray };

/** `FilterShared` for `spec` over the regions `pixels` (each the RGBA of one layer's region). */
export function filterShared(spec: FilterSpec, pixels: Uint8ClampedArray[]): FilterShared {
  if (spec.kind !== "posterize") return {};
  return {
    palette: posterizePalette(pixels, spec.colours),
    alphaLut: spec.alphaSteps >= 2 ? alphaStepLut(pixels, spec.alphaSteps) : undefined,
  };
}

/**
 * Run `spec` over a region: `src` and `out` are its RGBA (w × h), `ox`, `oy` its place on the layer
 * in device px (the halftone screen is anchored to the layer), `dpr` the layer's pixels per document
 * px (the halftone cell is in document px). `alphaLock`: never more alpha than was there. `shared`:
 * what several layers run together share (`filterShared`); worked out from `src` alone without it.
 */
export function applyFilter(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  w: number,
  h: number,
  ox: number,
  oy: number,
  spec: FilterSpec,
  dpr = 1,
  alphaLock = false,
  shared?: FilterShared,
): void {
  const n = w * h * 4;
  switch (spec.kind) {
    case "levels": {
      const lut = levelsLut(spec);
      for (let p = 0; p < n; p += 4) {
        out[p] = lut[src[p]];
        out[p + 1] = lut[src[p + 1]];
        out[p + 2] = lut[src[p + 2]];
        out[p + 3] = src[p + 3];
      }
      return;
    }
    case "posterize": {
      // Each pixel takes the palette colour nearest (in OKLab) to its 15-bit bin's centre — 32k
      // bins at most, so a noisy layer costs no more than a flat one. Its alpha is kept, or stepped
      // (`alphaStepLut`) — never under alpha lock, which keeps the layer's alpha.
      const pal = shared?.palette ?? posterizePalette(src.subarray(0, n), spec.colours);
      const aLut =
        spec.alphaSteps >= 2 && !alphaLock
          ? (shared?.alphaLut ?? alphaStepLut(src.subarray(0, n), spec.alphaSteps))
          : null;
      const K = pal.length / 3;
      const palLab = new Float64Array(K * 3);
      for (let c = 0; c < K; c++) oklab(pal[c * 3], pal[c * 3 + 1], pal[c * 3 + 2], palLab, c * 3);
      const near = new Int8Array(1 << 15).fill(-1);
      const L = new Float64Array(3);
      for (let p = 0; p < n; p += 4) {
        out[p + 3] = src[p + 3];
        if (!src[p + 3]) {
          out[p] = src[p];
          out[p + 1] = src[p + 1];
          out[p + 2] = src[p + 2];
          continue;
        }
        const bin = ((src[p] >> 3) << 10) | ((src[p + 1] >> 3) << 5) | (src[p + 2] >> 3);
        if (near[bin] < 0) {
          oklab((bin >> 10) * 8 + 3.5, ((bin >> 5) & 31) * 8 + 3.5, (bin & 31) * 8 + 3.5, L, 0);
          let g = 0,
            bd = Infinity;
          for (let c = 0; c < K; c++) {
            const dl = L[0] - palLab[c * 3],
              da = L[1] - palLab[c * 3 + 1],
              db = L[2] - palLab[c * 3 + 2];
            const d = dl * dl + da * da + db * db;
            if (d < bd) {
              bd = d;
              g = c;
            }
          }
          near[bin] = g;
        }
        const c = near[bin] * 3;
        out[p] = pal[c];
        out[p + 1] = pal[c + 1];
        out[p + 2] = pal[c + 2];
        if (aLut) out[p + 3] = aLut[src[p + 3]];
      }
      if (spec.smooth) posterizeEdges(src, out, w, h, pal, palLab, near, aLut);
      return;
    }
    case "blur": {
      // Premultiplied, channel by channel (three float planes, not twelve): blurred straight, the
      // black of transparent pixels would darken the paint's edge. Alpha lock keeps the alpha and
      // blurs only the colour.
      const plan = blurPlan(spec.radius * dpr);
      if (plan.kind === "none") {
        out.set(src.subarray(0, n));
        return;
      }
      const m = w * h;
      const [A, C, tmp] = blurBuffers(m);
      for (let i = 0; i < m; i++) A[i] = src[i * 4 + 3];
      blurChannel(A, w, h, plan, tmp);
      for (let c = 0; c < 3; c++) {
        for (let i = 0, p = 0; i < m; i++, p += 4) C[i] = (src[p + c] * src[p + 3]) / 255;
        blurChannel(C, w, h, plan, tmp);
        for (let i = 0, p = c; i < m; i++, p += 4) out[p] = A[i] > 0 ? (C[i] * 255) / A[i] : 0;
      }
      for (let i = 0, p = 3; i < m; i++, p += 4) out[p] = alphaLock ? src[p] : A[i];
      return;
    }
    case "colourToAlpha": {
      // Only takes alpha away, so under alpha lock (which keeps the alpha) App leaves it out.
      const key = parseHex(spec.colour);
      const px = [0, 0, 0, 0];
      for (let p = 0; p < n; p += 4) {
        const a = src[p + 3];
        if (!a) {
          out[p] = src[p];
          out[p + 1] = src[p + 1];
          out[p + 2] = src[p + 2];
          out[p + 3] = 0;
          continue;
        }
        colourToAlphaPixel(src[p], src[p + 1], src[p + 2], key, px);
        out[p] = px[0];
        out[p + 1] = px[1];
        out[p + 2] = px[2];
        out[p + 3] = alphaLock ? a : Math.round(px[3] * a);
      }
      return;
    }
    case "sharpen": {
      // Unsharp mask on the colour only (the alpha is kept): each channel pushed away from its
      // blur. The blur is taken premultiplied and divided back by the blurred alpha — the colour
      // of the paint round a pixel, not darkened by the transparent black beside an edge, which
      // gave a dark halo along every outline.
      const plan = blurPlan(spec.radius * dpr);
      const k = spec.amount / 100;
      if (plan.kind === "none" || k === 0) {
        out.set(src.subarray(0, n));
        return;
      }
      const m = w * h;
      const [A, C, tmp] = blurBuffers(m);
      for (let i = 0; i < m; i++) A[i] = src[i * 4 + 3];
      blurChannel(A, w, h, plan, tmp);
      for (let c = 0; c < 3; c++) {
        for (let i = 0, p = 0; i < m; i++, p += 4) C[i] = (src[p + c] * src[p + 3]) / 255;
        blurChannel(C, w, h, plan, tmp);
        for (let i = 0, p = c; i < m; i++, p += 4) {
          const v = src[p];
          out[p] = src[p - c + 3] && A[i] > 0 ? v + k * (v - (C[i] * 255) / A[i]) : v;
        }
      }
      for (let p = 3; p < n; p += 4) out[p] = src[p];
      return;
    }
    case "shadow":
    case "glow": {
      // The paint's alpha, blurred, shifted (the shadow) and scaled, in one colour BEHIND the
      // paint: paint over it, as a layer style would draw it. Alpha lock keeps the alpha, so the
      // shadow shows only through see-through paint.
      const sigma = (spec.kind === "shadow" ? spec.blur : spec.size) * dpr;
      const { dx, dy } = spec.kind === "shadow" ? shadowOffset(spec, dpr) : { dx: 0, dy: 0 };
      const gain = spec.opacity / 100 / (spec.kind === "glow" ? 1 - 0.95 * (spec.spread / 100) : 1);
      const [sr, sg, sb] = parseHex(spec.colour);
      const m = w * h;
      const [A, , tmp] = blurBuffers(m);
      for (let i = 0; i < m; i++) A[i] = src[i * 4 + 3];
      blurChannel(A, w, h, blurPlan(sigma), tmp);
      for (let y = 0, i = 0; y < h; y++) {
        const sy = y - dy;
        for (let x = 0; x < w; x++, i++) {
          const sx = x - dx;
          const p = i * 4;
          const raw = sx >= 0 && sx < w && sy >= 0 && sy < h ? A[sy * w + sx] / 255 : 0;
          const sh = Math.min(1, raw * gain);
          const a = src[p + 3] / 255;
          const oa = a + sh * (1 - a);
          if (oa <= 0) {
            out[p] = src[p];
            out[p + 1] = src[p + 1];
            out[p + 2] = src[p + 2];
            out[p + 3] = 0;
            continue;
          }
          const under = sh * (1 - a);
          out[p] = (src[p] * a + sr * under) / oa;
          out[p + 1] = (src[p + 1] * a + sg * under) / oa;
          out[p + 2] = (src[p + 2] * a + sb * under) / oa;
          out[p + 3] = (alphaLock ? a : oa) * 255;
        }
      }
      return;
    }
    case "hueSat": {
      // Art repeats colours (flat fills, a gradient's few hundred): a direct-mapped table of the
      // colours already converted, so most pixels skip the OKLCH round trip.
      const keys = new Int32Array(HUE_CACHE).fill(-1);
      const vals = new Uint8ClampedArray(HUE_CACHE * 3);
      for (let p = 0; p < n; p += 4) {
        out[p + 3] = src[p + 3];
        if (!src[p + 3]) {
          out[p] = src[p];
          out[p + 1] = src[p + 1];
          out[p + 2] = src[p + 2];
          continue;
        }
        const k = (src[p] << 16) | (src[p + 1] << 8) | src[p + 2];
        const slot = (Math.imul(k, 0x9e3779b1) >>> 16) & (HUE_CACHE - 1);
        if (keys[slot] !== k) {
          keys[slot] = k;
          hueSatPixel(src[p], src[p + 1], src[p + 2], spec, vals, slot * 3);
        }
        out[p] = vals[slot * 3];
        out[p + 1] = vals[slot * 3 + 1];
        out[p + 2] = vals[slot * 3 + 2];
      }
      return;
    }
    case "threshold": {
      // Judged as the pixel looks on white, so a faint grey edge counts as light. Smooth: each
      // pixel's share of ink comes from how far the level lies from it (`fieldShare` over the
      // "seen" plane), so the cut through a soft shape is antialiased instead of stair-stepped.
      const white = spec.paper === "white";
      const m = w * h;
      const S = blurBuffers(m)[0];
      for (let i = 0, p = 0; i < m; i++, p += 4) {
        const a = src[p + 3];
        S[i] = 255 - (a / 255) * (255 - luma(src[p], src[p + 1], src[p + 2]));
      }
      const field = (j: number) => spec.level - S[j];
      // Smooth: only pixels within EDGE_R px of the hard cut can come out partial.
      let band: Uint8Array | null = null;
      if (spec.smooth) {
        const hard = new Uint8Array(m);
        for (let i = 0; i < m; i++) hard[i] = S[i] < spec.level ? 1 : 0;
        band = edgeBand(hard, w, h);
      }
      for (let y = 0, i = 0; y < h; y++) {
        for (let x = 0; x < w; x++, i++) {
          const p = i * 4;
          const a = src[p + 3];
          if (!a) {
            out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
            continue;
          }
          const f = spec.level - S[i];
          const ink = band && band[i] ? fieldShare(x, y, w, h, field) : f > 0 ? 1 : 0;
          // Ink: opaque black (alpha lock: its own alpha). Not ink: transparent, or white at its
          // own alpha. Mixed by the ink's share, premultiplied.
          const inkA = alphaLock ? a : 255;
          const paperA = white ? a : 0;
          const oa = ink * inkA + (1 - ink) * paperA;
          out[p] =
            out[p + 1] =
            out[p + 2] =
              oa > 0 ? Math.round(((1 - ink) * paperA * 255) / oa) : 0;
          out[p + 3] = Math.round(oa);
        }
      }
      return;
    }
    case "halftone": {
      const cell = Math.max(1, spec.cell * dpr);
      const rad = (spec.angle * Math.PI) / 180;
      const cos = Math.cos(rad),
        sin = Math.sin(rad);
      const white = spec.paper === "white",
        black = spec.ink === "black";
      if (spec.shape === "dots") {
        halftoneDots(src, out, w, h, ox, oy, cell, cos, sin, black, white, alphaLock);
        return;
      }
      for (let y = 0, p = 0; y < h; y++) {
        for (let x = 0; x < w; x++, p += 4) {
          const a = src[p + 3];
          if (!a) {
            out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
            continue;
          }
          const r = src[p],
            g = src[p + 1],
            b = src[p + 2];
          // The tone as the pixel looks on white: darkness × alpha, so soft or see-through
          // shading (airbrush, a low-opacity stroke) becomes thinner lines, not faint ones. The
          // lines themselves are solid.
          const tone = (1 - luma(r, g, b) / 255) * (a / 255);
          const c = halftoneCoverage(ox + x, oy + y, tone, cell, cos, sin, "lines");
          halftoneInk(out, p, black ? 0 : r, black ? 0 : g, black ? 0 : b, c, a, white, alphaLock);
        }
      }
      return;
    }
  }
}
