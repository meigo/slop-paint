/**
 * One undo stack for the whole document: pixel edits on any layer and structural edits (add,
 * delete, duplicate, merge, group, reorder) go on the same stack, so undo walks back through what
 * you actually did rather than through the active layer's own history.
 */
import { History, changedTiles, cropPixels } from "./history";
import {
  detachedLayerBytes,
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
 *  not the whole layer twice over. */
export function pushPixelEdit(layers: LayerManager, layer: Layer, before: ImageData) {
  const d = pixelDiff(layers, layer, before);
  const put = (side: "was" | "now") => {
    d.put(side);
    hooks.onHistoryApplied();
  };
  history.push({ undo: () => put("was"), redo: () => put("now"), bytes: d.bytes });
}

/** The tiles of `layer` that changed since `before`, both sides, and how to put either back. */
function pixelDiff(layers: LayerManager, layer: Layer, before: ImageData) {
  const full = layers.snapshotOf(layer);
  const w = full.width;
  const sameSize = before.width === w && before.height === full.height;
  const tiles = sameSize
    ? changedTiles(before.data, full.data, w, full.height).map((r) => ({
        r,
        was: new ImageData(cropPixels(before.data, w, r), r.w, r.h),
        now: new ImageData(cropPixels(full.data, w, r), r.w, r.h),
      }))
    : [{ r: { x: 0, y: 0, w, h: full.height }, was: before, now: full }];
  return {
    put: (side: "was" | "now") => {
      for (const t of tiles) layers.restoreTo(layer, t[side], t.r.x, t.r.y);
    },
    bytes: tiles.reduce((sum, t) => sum + t.was.data.byteLength + t.now.data.byteLength, 0),
  };
}

/** Record a change already made to several layers at once as ONE step (the Move tool,
 *  2026-10-02): each layer's changed tiles, and a reference's placement before and after (its
 *  pixels are drawn from it, so undo must put both back). */
export function pushLayersEdit(
  layers: LayerManager,
  edits: { layer: Layer; before: ImageData; refBefore?: RefPlacement }[],
) {
  const parts = edits.map((e) => ({
    layer: e.layer,
    diff: pixelDiff(layers, e.layer, e.before),
    refBefore: e.refBefore,
    refAfter: e.layer.ref,
  }));
  const put = (side: "was" | "now") => {
    for (const p of parts) {
      p.diff.put(side);
      if (p.refBefore || p.refAfter) p.layer.ref = side === "was" ? p.refBefore : p.refAfter;
    }
    hooks.onHistoryApplied();
  };
  const bytes = parts.reduce((sum, p) => sum + p.diff.bytes, 0);
  history.push({ undo: () => put("was"), redo: () => put("now"), bytes });
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
  const result = run();
  const afterTree = layers.captureStructure();
  const afterPixels = target ? layers.snapshotOf(target) : null;
  if (sameStructure(beforeTree, afterTree)) return result; // nothing happened: no empty step
  history.push({
    undo: () => {
      if (target && beforePixels) layers.restoreTo(target, beforePixels);
      layers.restoreStructure(beforeTree);
      hooks.onHistoryApplied();
    },
    redo: () => {
      if (target && afterPixels) layers.restoreTo(target, afterPixels);
      layers.restoreStructure(afterTree);
      hooks.onHistoryApplied();
    },
    bytes:
      (beforePixels?.data.byteLength ?? 0) +
      (afterPixels?.data.byteLength ?? 0) +
      detachedLayerBytes(beforeTree, afterTree),
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
 *  `blend` is a layer's blend mode (a Photoshop name; undefined = normal). */
export type NodeField = "visible" | "opacity" | "locked" | "alphaLock" | "blend";

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
    // `alphaLock` and `blend` only exist on layers; `locked` on layers and groups.
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
  history.push({ undo: () => apply(before), redo: () => apply(after) });
}
