/**
 * Per-character jitter for a text reference (from slop-vector-editor's `text/random.ts`, without
 * its per-character overrides). Pure, and deliberately integer-only: a text must look the same on
 * every machine, so nothing here may depend on float formatting or on `Math.random` — a layer that
 * re-rolled itself because it was opened elsewhere would be a data bug, not a surprise.
 */
import type { Mat } from "./selection";

/** How far each property may stray, either way: degrees, a fraction of 1 (scale), a fraction of
 *  the font size (baseline), degrees. */
export interface JitterAmounts {
  rotate: number;
  scale: number;
  offset: number;
  skew: number;
}

export const NO_JITTER: JitterAmounts = { rotate: 0, scale: 0, offset: 0, skew: 0 };

/** Each amount's ceiling, in its stored unit. */
export const JITTER_MAX: JitterAmounts = { rotate: 45, scale: 0.5, offset: 0.5, skew: 45 };

export interface CharTransform {
  rotate: number;
  scale: number;
  dy: number;
  skew: number;
}

export const IDENTITY_CHAR: CharTransform = { rotate: 0, scale: 1, dy: 0, skew: 0 };

export const hasJitter = (a: JitterAmounts): boolean =>
  a.rotate > 0 || a.scale > 0 || a.offset > 0 || a.skew > 0;

/** A 32-bit mix of (seed, index, salt). Each property gets its own salt, so rotation and scale are
 *  independent rather than one stream read twice. And because the index goes *in* rather than
 *  being consumed in order, character 5's jitter never depends on characters 0-4 — inserting a
 *  letter at the front must not reshuffle every letter after it. */
function hash(seed: number, index: number, salt: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (index + 0x165667b1), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ salt, 0xc2b2ae35) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/** −1 … +1 from a 32-bit hash. */
const signed = (h: number): number => (h / 0x100000000) * 2 - 1;

/** A negative roll times an amount of zero is `-0`, which `toEqual` tells apart from `0`; `+ 0`
 *  normalises it and leaves every other value untouched. */
const jitter = (h: number, amount: number): number => signed(h) * amount + 0;

/** Character `index`'s transform; `size` turns the baseline amount into layout units. */
export function charTransform(
  seed: number,
  index: number,
  a: JitterAmounts,
  size: number,
): CharTransform {
  return {
    rotate: jitter(hash(seed, index, 1), a.rotate),
    scale: 1 + jitter(hash(seed, index, 2), a.scale),
    dy: jitter(hash(seed, index, 3), a.offset * size),
    skew: jitter(hash(seed, index, 4), a.skew),
  };
}

const RAD = Math.PI / 180;

/** The matrix that applies `t` about the pivot (cx, cy): scale, then skew, then rotate, then the
 *  baseline shift — as slop-vector-editor's `charMatrix`. */
export function charMatrix(t: CharTransform, cx: number, cy: number): Mat {
  const cos = Math.cos(t.rotate * RAD);
  const sin = Math.sin(t.rotate * RAD);
  const k = Math.tan(t.skew * RAD);
  const s = t.scale;
  // rotate · skewX · scale
  const a = cos * s;
  const b = sin * s;
  const c = (cos * k - sin) * s;
  const d = (sin * k + cos) * s;
  return { a, b, c, d, e: cx - a * cx - c * cy, f: cy + t.dy - b * cx - d * cy };
}

export function newSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
