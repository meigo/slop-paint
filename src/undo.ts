/**
 * One undo stack for the whole document: pixel edits on any layer and structural edits (add,
 * delete, duplicate, merge, group, reorder) go on the same stack, so undo walks back through what
 * you actually did rather than through the active layer's own history.
 */
import { History, pixelCommand } from "./history";
import type { Layer, LayerManager } from "./layers";

export const history = new History();

/** Called after an undo/redo so the app can recomposite and refresh the UI. */
export let onHistoryApplied: () => void = () => {};
export function setOnHistoryApplied(fn: () => void) {
  onHistoryApplied = fn;
}

/** Record a pixel change already made to `layer`, given its pixels from before the change. */
export function pushPixelEdit(layers: LayerManager, layer: Layer, before: ImageData) {
  const after = layers.snapshotOf(layer);
  history.push(
    pixelCommand(
      () => {
        layers.restoreTo(layer, before);
        onHistoryApplied();
      },
      () => {
        layers.restoreTo(layer, after);
        onHistoryApplied();
      },
      before,
      after,
    ),
  );
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
  history.push({
    undo: () => {
      if (target && beforePixels) layers.restoreTo(target, beforePixels);
      layers.restoreStructure(beforeTree);
      onHistoryApplied();
    },
    redo: () => {
      if (target && afterPixels) layers.restoreTo(target, afterPixels);
      layers.restoreStructure(afterTree);
      onHistoryApplied();
    },
    bytes: (beforePixels?.data.byteLength ?? 0) + (afterPixels?.data.byteLength ?? 0),
  });
  return result;
}
