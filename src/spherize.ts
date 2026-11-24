/** Spherize (Filter ▸ Spherize…, 2026-11-24): the paint inside an ellipse seen through a lens.
 *  A bulge magnifies the middle and squeezes the rim; a pinch does the reverse. Outside the ellipse
 *  nothing moves, and its edge maps onto itself, so there is no seam. Pure, tested. */

/** The lens: an ellipse in layer device px (centre and radii). */
export type Lens = { cx: number; cy: number; rx: number; ry: number };

/** Barrel strength at Amount 100: the middle is magnified 1 / (1 − K) = 2×, the rim squeezed to
 *  1 / (1 + 2K) = ½. A curve with a finite slope at the rim (unlike a true hemisphere, asin, whose
 *  infinite slope there would alias a ring the bilinear read can't average). */
export const SPHERIZE_K = 0.5;

/** Entries in the radius table. */
const LUT_N = 1024;

/** A bulge of strength k (0 ≤ k < 1): for a point at radius r (0–1 of the ellipse) of the result,
 *  the radius it is read from. f(0) = 0, f(1) = 1, f′ = 1 − k + 3kr² > 0: increasing. */
export const bulge = (r: number, k: number) => r * (1 - k * (1 - r * r));

/** The read radius for each result radius, LUT_N + 1 steps over 0–1: Amount −100…100. A pinch
 *  is the bulge's exact inverse, so −a undoes +a (up to resampling). */
export function lensTable(amount: number): Float32Array {
  const k = (SPHERIZE_K * Math.min(100, Math.abs(amount))) / 100;
  const lut = new Float32Array(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) {
    const r = i / LUT_N;
    if (amount >= 0) {
      lut[i] = bulge(r, k);
      continue;
    }
    // Newton on bulge(s) = r: f′ ≥ 1 − k ≥ ½, so it settles in a few steps from s = r.
    let s = r;
    for (let j = 0; j < 8; j++) s -= (bulge(s, k) - r) / (1 - k + 3 * k * s * s);
    lut[i] = Math.min(1, Math.max(0, s));
  }
  return lut;
}

/**
 * Spherize a region: `src`/`out` its RGBA (w × h, unpremultiplied), `ox`, `oy` its place on the
 * layer, `lens` in layer px. Each pixel inside the ellipse reads `src` at its lens position,
 * bilinear and premultiplied (so transparent black doesn't darken the edges); outside it is
 * copied. `alphaLock` keeps each pixel's own alpha (as Blur's).
 */
export function spherize(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  w: number,
  h: number,
  ox: number,
  oy: number,
  lens: Lens,
  amount: number,
  alphaLock: boolean,
): void {
  out.set(src.subarray(0, w * h * 4));
  if (amount === 0 || lens.rx <= 0 || lens.ry <= 0) return;
  const lut = lensTable(amount);
  const { cx, cy, rx, ry } = lens;
  // Only the rows and columns the ellipse can cover.
  const y0 = Math.max(0, Math.floor(cy - ry - oy)),
    y1 = Math.min(h, Math.ceil(cy + ry - oy));
  const x0 = Math.max(0, Math.floor(cx - rx - ox)),
    x1 = Math.min(w, Math.ceil(cx + rx - ox));
  for (let y = y0; y < y1; y++) {
    const v = (oy + y + 0.5 - cy) / ry;
    for (let x = x0; x < x1; x++) {
      const u = (ox + x + 0.5 - cx) / rx;
      const r2 = u * u + v * v;
      if (r2 >= 1) continue;
      const r = Math.sqrt(r2);
      const f = r * LUT_N;
      const i = Math.min(LUT_N - 1, Math.floor(f));
      const sr = lut[i] + (lut[i + 1] - lut[i]) * (f - i);
      const scale = r > 0 ? sr / r : lut[1] * LUT_N; // the slope at the middle
      // The read position in region px, pixel centres at whole numbers.
      let sx = cx + u * scale * rx - ox - 0.5;
      let sy = cy + v * scale * ry - oy - 0.5;
      sx = sx < 0 ? 0 : sx > w - 1 ? w - 1 : sx;
      sy = sy < 0 ? 0 : sy > h - 1 ? h - 1 : sy;
      const ix = Math.min(w - 2, Math.floor(sx)),
        iy = Math.min(h - 2, Math.floor(sy));
      const fx = w > 1 ? sx - ix : 0,
        fy = h > 1 ? sy - iy : 0;
      const p00 = (Math.max(0, iy) * w + Math.max(0, ix)) * 4;
      const p10 = w > 1 ? p00 + 4 : p00;
      const p01 = h > 1 ? p00 + w * 4 : p00;
      const p11 = w > 1 ? p01 + 4 : p01;
      const w00 = (1 - fx) * (1 - fy),
        w10 = fx * (1 - fy),
        w01 = (1 - fx) * fy,
        w11 = fx * fy;
      const a00 = src[p00 + 3] * w00,
        a10 = src[p10 + 3] * w10,
        a01 = src[p01 + 3] * w01,
        a11 = src[p11 + 3] * w11;
      const a = a00 + a10 + a01 + a11;
      const p = (y * w + x) * 4;
      if (a > 0) {
        for (let c = 0; c < 3; c++) {
          out[p + c] =
            (src[p00 + c] * a00 + src[p10 + c] * a10 + src[p01 + c] * a01 + src[p11 + c] * a11) / a;
        }
      }
      if (!alphaLock) out[p + 3] = a;
    }
  }
}
