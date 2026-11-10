// One-off filters (Filter menu): pure per-pixel maths on unpremultiplied RGBA, as `getImageData`
// gives it. App previews them into the layer and keeps the result as one undo step; nothing here is
// live. Every filter keeps a fully transparent pixel transparent, so App only works on the ink's
// bounds.

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
export type FilterSpec = LevelsSpec | HueSatSpec | ThresholdSpec | HalftoneSpec;
export type FilterKind = FilterSpec["kind"];

export const FILTER_DEFAULTS: { [K in FilterKind]: Extract<FilterSpec, { kind: K }> } = {
  levels: { kind: "levels", inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
  hueSat: { kind: "hueSat", hue: 0, saturation: 0, lightness: 0 },
  threshold: { kind: "threshold", level: 128, paper: "transparent" },
  halftone: {
    kind: "halftone",
    cell: 8,
    angle: 45,
    shape: "dots",
    ink: "black",
    paper: "transparent",
  },
};

export const FILTER_TITLES: Record<FilterKind, string> = {
  levels: "Levels",
  hueSat: "Hue/Saturation",
  threshold: "Threshold",
  halftone: "Halftone",
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
