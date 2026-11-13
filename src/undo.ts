/**
 * One undo stack for the whole document: pixel edits on any layer and structural edits (add,
 * delete, duplicate, merge, group, reorder) go on the same stack, so undo walks back through what
 * you actually did rather than through the active layer's own history.
 */
import {
  History,
  UNDO_TILE,
  changedTiles,
  cropPixels,
  offCanvasRects,
  tileRect,
  tileSpan,
  type PixelRect,
} from "./history";
import {
  detachedLayerBytes,
  refSourceBytes,
  sameStructure,
  type Layer,
  type LayerManager,
  type RefPlacement,
} from "./layers";

export const history = new History();

/** Called after an undo/redo so the app can recomposite and refresh the UI. Held on an object, not
 *  in an `export let` the setter reassigns: the production minifier treated that binding as never
 *  changing, inlined its initial no-op and dropped every call — undo restored the pixels but never
 *  redrew the screen (until the next stroke did), in every browser, while `npm run dev` was fine. */
const hooks = { onHistoryApplied: () => {} };
export function setOnHistoryApplied(fn: () => void) {
  hooks.onHistoryApplied = fn;
}

/** Record a pixel change already made to `layer`, given its pixels from before the change. Only
 *  the tiles that changed are kept (both sides), so a stroke costs roughly the area it touched,
 *  not the whole layer twice over. Pushes nothing when no pixel changed — an empty step would wipe
 *  redo — and says whether it pushed, so a caller can report the no-op. */
export function pushPixelEdit(layers: LayerManager, layer: Layer, before: ImageData): boolean {
  return pushTiles(layers, layer, diffTiles(before, layers.snapshotOf(layer)));
}

type Tile = { r: PixelRect; was: ImageData; now: ImageData };

/** One step putting `tiles` of `layer` back or forth; none (false) when there are none — an empty
 *  step would wipe redo. Its own function, so the step's closures hold the tiles alone. */
function pushTiles(layers: LayerManager, layer: Layer, tiles: Tile[]): boolean {
  if (tiles.length === 0) return false;
  const put = (side: "was" | "now") => {
    for (const t of tiles) layers.restoreTo(layer, t[side], t.r.x, t.r.y);
    hooks.onHistoryApplied();
  };
  history.push({ undo: () => put("was"), redo: () => put("now"), bytes: tilesBytes(tiles) });
  return true;
}

const tilesBytes = (tiles: Tile[]) =>
  tiles.reduce((sum, t) => sum + t.was.data.byteLength + t.now.data.byteLength, 0);

/** The changed tiles of two snapshots, each side cropped out. Its own function, not inline where
 *  a step is made: closures made in one scope share it, so `put` kept the `.map` callback's `before`
 *  and `full` reachable — every step held BOTH whole-layer snapshots while `bytes` counted only
 *  the tiles (2026-10-17 review: 50 strokes on a 2732×2048 iPad layer kept ~2.2 GB alive). */
function diffTiles(before: ImageData, full: ImageData): Tile[] {
  const w = full.width;
  if (before.width !== w || before.height !== full.height)
    return [{ r: { x: 0, y: 0, w, h: full.height }, was: before, now: full }];
  return changedTiles(before.data, full.data, w, full.height, UNDO_TILE).map((r) => ({
    r,
    was: new ImageData(cropPixels(before.data, w, r), r.w, r.h),
    now: new ImageData(cropPixels(full.data, w, r), r.w, r.h),
  }));
}

/** Record pixel changes already made to several layers, each inside its own region, as ONE step
 *  (Filter on a group or picked rows, 2026-11-11). `before` is each region's pixels from before;
 *  only the 64-px tiles of a region that changed are kept, both sides, so a layer is never held
 *  whole. Pushes nothing (false) when no pixel changed anywhere. */
export function pushRegionsEdit(
  layers: LayerManager,
  parts: { layer: Layer; rect: PixelRect; before: ImageData }[],
): boolean {
  const changed = parts
    .map((p) => ({ layer: p.layer, tiles: regionTiles(p.layer, p.rect, p.before) }))
    .filter((p) => p.tiles.length > 0);
  if (changed.length === 0) return false;
  const put = (side: "was" | "now") => {
    for (const p of changed)
      for (const t of p.tiles) layers.restoreTo(p.layer, t[side], t.r.x, t.r.y);
    hooks.onHistoryApplied();
  };
  const bytes = changed.reduce((sum, p) => sum + tilesBytes(p.tiles), 0);
  history.push({
    undo: () => put("was"),
    redo: () => put("now"),
    bytes,
    layers: changed.length,
  });
  return true;
}

/** The changed tiles of one layer's region (in layer px), each side cropped out. Its own function,
 *  as `diffTiles`, so no step's closure holds the region's whole buffers. */
function regionTiles(layer: Layer, rect: PixelRect, before: ImageData): Tile[] {
  const now = layer.ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
  return changedTiles(before.data, now.data, rect.w, rect.h, UNDO_TILE).map((r) => ({
    r: { x: rect.x + r.x, y: rect.y + r.y, w: r.w, h: r.h },
    was: new ImageData(cropPixels(before.data, rect.w, r), r.w, r.h),
    now: new ImageData(cropPixels(now.data, rect.w, r), r.w, r.h),
  }));
}

/**
 * A stroke's pixels from before it, kept TILE BY TILE as the stroke first reaches each one
 * (2026-11-05): `keep(rect)` is called before every write to the layer, so a tile is read while it
 * still holds what was there. It replaced a whole-layer snapshot at every press — 96 MB and ~6–10
 * ms read at 4000×6000, and a second whole read at the lift to compare — with reads of the tiles
 * the stroke touches. Long Ink/Calligraphy strokes bake their settled part into the pre-stroke
 * copy, which is then no longer the "before"; this never reads that copy, so freezing can't spoil
 * it.
 */
export class StrokeBackup {
  readonly layer: Layer;
  private tiles = new Map<number, { r: PixelRect; was: ImageData }>();
  constructor(layer: Layer) {
    this.layer = layer;
  }

  /** Keep the tiles of `rect` (canvas px) not kept yet. Call it BEFORE writing there. */
  keep(rect: PixelRect) {
    const { width, height } = this.layer.canvas;
    const span = tileSpan(rect, width, height);
    if (!span) return;
    for (let ty = span.ty0; ty < span.ty1; ty++) {
      for (let tx = span.tx0; tx < span.tx1; tx++) {
        const key = ty * span.across + tx;
        if (this.tiles.has(key)) continue; // mostly so: it runs over every frame's redrawn part
        const r = tileRect(tx, ty, width, height);
        this.tiles.set(key, { r, was: this.layer.ctx.getImageData(r.x, r.y, r.w, r.h) });
      }
    }
  }

  /** The kept tiles that changed, both sides; lets the rest go. */
  changed(): Tile[] {
    const out: Tile[] = [];
    for (const { r, was } of this.tiles.values()) {
      const now = this.layer.ctx.getImageData(r.x, r.y, r.w, r.h);
      const a = new Uint32Array(was.data.buffer, was.data.byteOffset, r.w * r.h);
      const b = new Uint32Array(now.data.buffer, now.data.byteOffset, r.w * r.h);
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          out.push({ r, was, now });
          break;
        }
      }
    }
    this.tiles.clear();
    return out;
  }
}

/** Record a stroke from its `StrokeBackup`: one step with the tiles it changed (none, false, when
 *  it changed nothing). */
export function pushStrokeEdit(layers: LayerManager, backup: StrokeBackup): boolean {
  return pushTiles(layers, backup.layer, backup.changed());
}

/** Record a Move already made (2026-10-02) as ONE step: several layers shifted by (`dx`, `dy`)
 *  whole canvas px, and references placed anew. Stored COMPACTLY (2026-10-21): each shifted layer
 *  keeps only the inked tiles of what the shift carried off the canvas (`offCanvasRects`), and
 *  undo / redo shift the pixels back and forth (`LayerManager.shiftPixels`) — the same exact copy
 *  the release made. Kept as changed tiles, a Move of a few full layers took both sides of every
 *  tile it touched: past the 256 MB budget it cleared all older history, and the next stroke then
 *  evicted the Move itself. A reference re-drawn from its original (`redrawn`) keeps no pixels at
 *  all: undo puts its placement back and draws it again, as `pushRefEdit` does. `before` is each
 *  layer's pixels from before the shift (only read here, not kept). */
export function pushLayersEdit(
  layers: LayerManager,
  edits: { layer: Layer; before?: ImageData; refBefore?: RefPlacement; redrawn?: boolean }[],
  dx: number,
  dy: number,
) {
  const parts = edits
    .map((e) => ({
      layer: e.layer,
      lost: e.redrawn || !e.before ? null : lostTiles(e.before, dx, dy),
      refBefore: e.refBefore,
      refAfter: e.layer.ref,
    }))
    // An empty layer moved changes nothing: no empty step to wipe redo.
    .filter((p) => (p.lost && p.lost.inked) || p.refBefore !== p.refAfter);
  if (parts.length === 0) return;
  const put = (side: "was" | "now") => {
    for (const p of parts) {
      if (p.refBefore || p.refAfter) p.layer.ref = side === "was" ? p.refBefore : p.refAfter;
      if (!p.lost) {
        layers.renderRef(p.layer);
        continue;
      }
      if (side === "now") layers.shiftPixels(p.layer, dx, dy);
      else {
        layers.shiftPixels(p.layer, -dx, -dy);
        for (const t of p.lost.tiles) layers.restoreTo(p.layer, t.data, t.x, t.y);
      }
    }
    hooks.onHistoryApplied();
  };
  const bytes = parts.reduce(
    (sum, p) => sum + (p.lost?.tiles.reduce((n, t) => n + t.data.data.byteLength, 0) ?? 0),
    0,
  );
  history.push({ undo: () => put("was"), redo: () => put("now"), bytes, layers: parts.length });
}

/** What a shift by (`dx`, `dy`) carries off the canvas, as the tiles of it holding any paint, and
 *  whether the layer held any paint at all. Its own function, so no closure keeps `before`. */
function lostTiles(before: ImageData, dx: number, dy: number) {
  const { width: w, height: h, data } = before;
  const px = new Uint32Array(data.buffer, data.byteOffset, w * h);
  const inked = px.some((v) => v !== 0);
  const tiles: { x: number; y: number; data: ImageData }[] = [];
  if (!inked) return { inked, tiles };
  for (const r of offCanvasRects(w, h, dx, dy)) {
    const strip = cropPixels(data, w, r);
    for (const t of changedTiles(strip, new Uint8ClampedArray(strip.length), r.w, r.h)) {
      const at = { x: r.x + t.x, y: r.y + t.y, w: t.w, h: t.h };
      tiles.push({ x: at.x, y: at.y, data: new ImageData(cropPixels(data, w, at), t.w, t.h) });
    }
  }
  return { inked, tiles };
}

/**
 * Run a structural edit and record it. `pixelLayer` covers an edit that also changes pixels
 * (merge down writes onto the layer below).
 */
export function structuralEdit<T>(
  layers: LayerManager,
  run: () => T,
  pixelLayer?: () => Layer | null,
): T {
  const beforeTree = layers.captureStructure();
  const target = pixelLayer?.() ?? null;
  const beforePixels = target ? layers.snapshotOf(target) : null;
  // Its opacity and tint too: merge down bakes the lower layer's into its pixels.
  const beforeOpacity = target?.opacity;
  const beforeTint = target?.tint;
  const result = run();
  const afterTree = layers.captureStructure();
  // Only the tiles that changed, both sides (2026-11-05): both whole layers were kept, 192 MB
  // a Merge down at 4000×6000, so two or three merges emptied the rest of the history. The
  // snapshots themselves are read by no closure below, so the step doesn't keep them.
  const tiles = target && beforePixels ? diffTiles(beforePixels, layers.snapshotOf(target)) : [];
  const afterOpacity = target?.opacity;
  const afterTint = target?.tint;
  if (sameStructure(beforeTree, afterTree)) return result; // nothing happened: no empty step
  const putPixels = (side: "was" | "now") => {
    if (target) for (const t of tiles) layers.restoreTo(target, t[side], t.r.x, t.r.y);
  };
  history.push({
    undo: () => {
      putPixels("was");
      if (target && beforeOpacity !== undefined) target.opacity = beforeOpacity;
      if (target) target.tint = beforeTint;
      layers.restoreStructure(beforeTree);
      hooks.onHistoryApplied();
    },
    redo: () => {
      putPixels("now");
      if (target && afterOpacity !== undefined) target.opacity = afterOpacity;
      if (target) target.tint = afterTint;
      layers.restoreStructure(afterTree);
      hooks.onHistoryApplied();
    },
    bytes: tilesBytes(tiles) + detachedLayerBytes(beforeTree, afterTree),
  });
  return result;
}

/**
 * Record a name change (rename, or a Spine tag toggle — tags live in the name).
 *
 * Looks the node up by id at apply time rather than holding it: `restoreStructure` rebuilds group
 * nodes as fresh clones, so a captured group object can be detached by an unrelated structural
 * undo, and writing to it would change nothing the user can see.
 */
export function pushNameEdit(layers: LayerManager, id: number, before: string, after: string) {
  if (before === after) return;
  const apply = (name: string) => {
    const node = layers.findNode(id);
    if (node) node.name = name;
    hooks.onHistoryApplied();
  };
  history.push({ undo: () => apply(before), redo: () => apply(after) });
}

/** Fields of a layer/group that undo one value at a time (not pixels, not the tree's shape).
 *  `blend` is a layer's blend mode (a Photoshop name; undefined = normal), `tint` its tint
 *  ("#rrggbb"; undefined = none). */
export type NodeField = "visible" | "opacity" | "locked" | "alphaLock" | "blend" | "tint";

/**
 * Record a single-field change (visibility, opacity, lock, alpha lock). Resolved by id at apply
 * time for the same reason as `pushNameEdit`.
 *
 * A slider drag must call this ONCE, with the value from before the drag started — see
 * LayerProps, which opens the step on the first `input` and closes it on `change`/release.
 */
export function pushNodeFieldEdit(
  layers: LayerManager,
  id: number,
  field: NodeField,
  before: boolean | number | string | undefined,
  after: boolean | number | string | undefined,
) {
  if (before === after) return;
  const apply = (value: boolean | number | string | undefined) => {
    const node = layers.findNode(id);
    // `alphaLock`, `blend` and `tint` only exist on layers; `locked` on layers and groups.
    if (node) (node as unknown as Record<NodeField, typeof value>)[field] = value;
    hooks.onHistoryApplied();
  };
  history.push({ undo: () => apply(before), redo: () => apply(after) });
}

/** Record a reference layer's placement changing, or the reference being baked (`after`
 *  undefined) — no pixel snapshots: a reference is always re-drawn from its original. */
export function pushRefEdit(
  layers: LayerManager,
  id: number,
  before: RefPlacement | undefined,
  after: RefPlacement | undefined,
) {
  const apply = (value: RefPlacement | undefined) => {
    const layer = layers.findLayer(id);
    if (!layer) return;
    layer.ref = value;
    if (value) layers.renderRef(layer);
    hooks.onHistoryApplied();
  };
  // A placement change keeps the same source; a text edit or a bake leaves one only undo holds.
  const bytes =
    before?.src === after?.src ? 0 : refSourceBytes(before?.src) + refSourceBytes(after?.src);
  history.push({ undo: () => apply(before), redo: () => apply(after), bytes });
}
