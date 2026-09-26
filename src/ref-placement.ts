/**
 * Where a reference image sits on the page, and the conversions around it (pure; no DOM).
 *
 * A reference keeps its ORIGINAL image and a placement: the page positions of the image's four
 * corners — top-left, top-right, bottom-right, bottom-left. Only move/scale/rotate/flip are
 * offered (no distort), so the corners always form a parallelogram and one affine matrix maps the
 * original's own pixel box onto them. That matrix is what draws the reference and what the
 * Free transform float starts from; Photoshop's placed layer stores the same corners flattened.
 */
import type { Mat } from "./selection";

export interface Pt {
  x: number;
  y: number;
}
/** Page positions of the image's top-left, top-right, bottom-right, bottom-left corners. */
export type Corners = [Pt, Pt, Pt, Pt];

export function cornersFromRect(r: { x: number; y: number; w: number; h: number }): Corners {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/** The affine matrix taking the original's pixel box (0..w, 0..h) onto `corners`. */
export function matrixFromCorners(w: number, h: number, corners: Corners): Mat {
  const [tl, tr, , bl] = corners;
  return {
    a: (tr.x - tl.x) / w,
    b: (tr.y - tl.y) / w,
    c: (bl.x - tl.x) / h,
    d: (bl.y - tl.y) / h,
    e: tl.x,
    f: tl.y,
  };
}

/** `rect`'s corners under `m` — where a float's box landed when its transform was applied. */
export function cornersFromMatrix(
  r: { x: number; y: number; w: number; h: number },
  m: Mat,
): Corners {
  const at = (x: number, y: number): Pt => ({
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  });
  return [at(r.x, r.y), at(r.x + r.w, r.y), at(r.x + r.w, r.y + r.h), at(r.x, r.y + r.h)];
}

/** Photoshop's placed-layer `transform`: the four corners flattened, tl, tr, br, bl. */
export function toPsdTransform(c: Corners): number[] {
  return c.flatMap((p) => [p.x, p.y]);
}

/** The corners from a placed-layer `transform`, or null when it isn't eight numbers. */
export function fromPsdTransform(t: number[] | undefined): Corners | null {
  if (!t || t.length !== 8 || t.some((n) => !Number.isFinite(n))) return null;
  return [
    { x: t[0], y: t[1] },
    { x: t[2], y: t[3] },
    { x: t[4], y: t[5] },
    { x: t[6], y: t[7] },
  ];
}

/** iPad's per-canvas limit is about 16.7 million pixels; stay under it with room to spare. */
export const MAX_DECODED_PIXELS = 16_000_000;
/** A decoded original also stays within this on either side, so drawing it stays cheap. */
export const MAX_DECODED_SIDE = 4096;

/** The size to decode an original at: its own, scaled down (keeping aspect) only if it would break
 *  either limit. The PSD keeps the full original FILE; this is only the copy held for drawing. */
export function fitDecodedSize(w: number, h: number): { w: number; h: number } {
  const s = Math.min(
    1,
    MAX_DECODED_SIDE / w,
    MAX_DECODED_SIDE / h,
    Math.sqrt(MAX_DECODED_PIXELS / (w * h)),
  );
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** A UUID for the placed layer and its embedded file (they are matched by it in the PSD).
 *  `crypto.randomUUID` needs a secure context, which the plain-http LAN dev server is not. */
export function newRefId(rand: () => number = Math.random): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(rand() * 4)]}${hex(3)}-${hex(12)}`;
}

/** The two halves of a Smart Object in ag-psd's shapes: the layer's `placedLayer` and the PSD-level
 *  embedded file it points at (matched by `id`). */
export interface SmartObjectFields {
  placedLayer: {
    id: string;
    type: "raster";
    transform: number[];
    width: number;
    height: number;
  };
  linkedFile: { id: string; name: string; data: Uint8Array };
}

/** What a reference writes into the PSD: its placement, and its original file whole. */
export function smartObjectFor(ref: {
  src: { id: string; name: string; bytes: Uint8Array; width: number; height: number };
  corners: Corners;
}): SmartObjectFields {
  const { src } = ref;
  return {
    placedLayer: {
      id: src.id,
      type: "raster",
      transform: toPsdTransform(ref.corners),
      width: src.width,
      height: src.height,
    },
    linkedFile: { id: src.id, name: src.name, data: src.bytes },
  };
}

/** A reference rebuilt from an opened PSD's placed layer and embedded files (still to be decoded:
 *  `image` is null), or null when the layer is not a Smart Object this app can restore. */
export function refFromPlaced(
  placed: { id: string; transform?: number[]; width?: number; height?: number } | undefined,
  files: { id: string; name: string; data?: Uint8Array }[] | undefined,
) {
  if (!placed) return null;
  const file = files?.find((f) => f.id === placed.id);
  const corners = fromPsdTransform(placed.transform);
  if (!file?.data || !corners) return null;
  return {
    src: {
      id: placed.id,
      name: file.name,
      bytes: file.data,
      width: placed.width ?? 0,
      height: placed.height ?? 0,
      image: null,
    },
    corners,
  };
}
