// One-off filters (Filter menu): pure per-pixel maths on unpremultiplied RGBA, as `getImageData`
// gives it. App previews them into the layer and keeps the result as one undo step; nothing here is
// live. Every filter but Gaussian blur keeps a fully transparent pixel transparent; the blur
// spreads paint up to `filterReach` px, so App works on the ink's bounds grown by that.

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
export type ThresholdSpec = { kind: "threshold"; level: number; paper: Paper };
export type HalftoneSpec = {
  kind: "halftone";
  cell: number; // screen period in DOCUMENT px (App scales it to the layer's device px)
  angle: number; // degrees
  shape: "dots" | "lines";
  ink: "black" | "colour";
  paper: Paper;
};
export type PosterizeSpec = { kind: "posterize"; colours: number }; // 2–32, picked from the layer
export type BlurSpec = { kind: "blur"; radius: number }; // σ in DOCUMENT px, 0.2–BLUR_MAX
export type FilterSpec =
  LevelsSpec | HueSatSpec | PosterizeSpec | ThresholdSpec | HalftoneSpec | BlurSpec;
export type FilterKind = FilterSpec["kind"];

export const FILTER_DEFAULTS: { [K in FilterKind]: Extract<FilterSpec, { kind: K }> } = {
  levels: { kind: "levels", inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
  hueSat: { kind: "hueSat", hue: 0, saturation: 0, lightness: 0 },
  posterize: { kind: "posterize", colours: 6 },
  threshold: { kind: "threshold", level: 128, paper: "transparent" },
  halftone: {
    kind: "halftone",
    cell: 8,
    angle: 45,
    shape: "dots",
    ink: "black",
    paper: "transparent",
  },
  blur: { kind: "blur", radius: 2 },
};

/** Gaussian blur's largest radius (σ), in document px. */
export const BLUR_MAX = 64;

export const FILTER_TITLES: Record<FilterKind, string> = {
  levels: "Levels",
  hueSat: "Hue/Saturation",
  posterize: "Posterize",
  threshold: "Threshold",
  halftone: "Halftone",
  blur: "Gaussian blur",
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

/** OKLab of an sRGB colour (0–255 each, may be fractional) into `out` at `o`. */
function oklab(r: number, g: number, b: number, out: Float64Array, o: number) {
  const lin = (v: number) => {
    const i = Math.floor(v);
    const f = v - i;
    return i >= 255 ? SRGB_TO_LINEAR[255] : SRGB_TO_LINEAR[i] * (1 - f) + SRGB_TO_LINEAR[i + 1] * f;
  };
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
 * Up to `colours` colours standing for the painted pixels of `rgba` (weighted by alpha), as
 * [r, g, b, …] (0–255, rounded). Deterministic: the same pixels give the same palette.
 */
export function posterizePalette(rgba: Uint8ClampedArray, colours: number): Uint8ClampedArray {
  const k = Math.max(1, Math.round(colours));
  // A 15-bit histogram: weight and colour sums per bin, so a bin's colour is its pixels' mean.
  const BINS = 1 << 15;
  const wt = new Float64Array(BINS);
  const sum = new Float64Array(BINS * 3);
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
  return spec.kind === "blur" ? blurPlan(spec.radius * dpr).reach : 0;
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
export function releaseFilterBuffers() {
  blurBufs = [];
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

/** One pixel's Hue/Saturation/Lightness shift, rgb 0–255 in and out (written to `out`). */
export function hueSatPixel(
  r: number,
  g: number,
  b: number,
  s: HueSatSpec,
  out: number[] | Uint8ClampedArray,
  o = 0,
): void {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let l = (max + min) / 2;
  let h = 0,
    sat = 0;
  const d = max - min;
  if (d > 0) {
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  h = (((h + s.hue / 360) % 1) + 1) % 1;
  const ks = s.saturation / 100;
  sat = clamp01(ks < 0 ? sat * (1 + ks) : sat + (1 - sat) * ks * (d > 0 ? 1 : 0));
  const kl = s.lightness / 100;
  l = clamp01(kl < 0 ? l * (1 + kl) : l + (1 - l) * kl);
  if (sat === 0) {
    out[o] = out[o + 1] = out[o + 2] = Math.round(l * 255);
    return;
  }
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
  const p = 2 * l - q;
  out[o] = Math.round(hueToRgb(p, q, h + 1 / 3) * 255);
  out[o + 1] = Math.round(hueToRgb(p, q, h) * 255);
  out[o + 2] = Math.round(hueToRgb(p, q, h - 1 / 3) * 255);
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
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

/**
 * Run `spec` over a region: `src` and `out` are its RGBA (w × h), `ox`, `oy` its place on the layer
 * in device px (the halftone screen is anchored to the layer), `dpr` the layer's pixels per document
 * px (the halftone cell is in document px). `alphaLock`: never more alpha than was there.
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
      // bins at most, so a noisy layer costs no more than a flat one — and keeps its alpha.
      const pal = posterizePalette(src.subarray(0, n), spec.colours);
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
      }
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
    case "hueSat": {
      // Art repeats colours (flat fills, a gradient's few hundred): a direct-mapped table of the
      // colours already converted, so most pixels skip the HSL round trip.
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
      // Judged as the pixel looks on white, so a faint grey edge counts as light.
      const white = spec.paper === "white";
      for (let p = 0; p < n; p += 4) {
        const a = src[p + 3];
        const seen = 255 - (a / 255) * (255 - luma(src[p], src[p + 1], src[p + 2]));
        if (a && seen < spec.level) {
          out[p] = out[p + 1] = out[p + 2] = 0;
          out[p + 3] = alphaLock ? a : 255;
        } else if (white && a) {
          out[p] = out[p + 1] = out[p + 2] = 255;
          out[p + 3] = a;
        } else {
          out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
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
          // shading (airbrush, a low-opacity stroke) becomes smaller dots, not faint ones. The
          // dots themselves are solid.
          const tone = (1 - luma(r, g, b) / 255) * (a / 255);
          let c = halftoneCoverage(ox + x, oy + y, tone, cell, cos, sin, spec.shape);
          const ir = black ? 0 : r,
            ig = black ? 0 : g,
            ib = black ? 0 : b;
          if (white) {
            // Solid ink over white paper at the layer's own alpha.
            const pa = a / 255;
            if (alphaLock) c = Math.min(c, pa);
            const oa = c + pa * (1 - c);
            const k = (1 - c) * pa * 255;
            out[p] = Math.round((ir * c + k) / oa);
            out[p + 1] = Math.round((ig * c + k) / oa);
            out[p + 2] = Math.round((ib * c + k) / oa);
            out[p + 3] = Math.round(oa * 255);
          } else {
            out[p] = ir;
            out[p + 1] = ig;
            out[p + 2] = ib;
            out[p + 3] = Math.round((alphaLock ? Math.min(c, a / 255) : c) * 255);
          }
        }
      }
      return;
    }
  }
}
