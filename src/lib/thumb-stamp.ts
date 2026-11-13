/**
 * Which layer thumbnails are out of date (2026-11-13). The layer panel keeps each layer's
 * thumbnail between rebuilds of its rows and redraws one from its layer only when that layer's
 * pixels changed: every rebuild (a row tap, a rename, the eye) drew every thumbnail from its whole
 * layer canvas, which Safari copies whole each time (CLAUDE.md, Stroke cost).
 *
 * `touchThumb(id)`: that layer's pixels changed. `touchAllThumbs()`: any layer's may have (App's
 * `bumpLayerVersion` does it, so an edit that forgets to say which layer costs time, not a stale
 * thumbnail).
 */
export interface ThumbStamp {
  epoch: number;
  edits: number;
}

let epoch = 0;
const edits = new Map<number, number>();

export function touchThumb(id: number) {
  edits.set(id, (edits.get(id) ?? 0) + 1);
}

export function touchAllThumbs() {
  epoch++;
  edits.clear();
}

export function thumbStamp(id: number): ThumbStamp {
  return { epoch, edits: edits.get(id) ?? 0 };
}

/** A thumbnail drawn at `kept`, against the layer's stamp `now`: "current"; "part" when exactly
 *  ONE edit came since (the caller may then redraw only that edit's area, if it knows it); else
 *  "stale". */
export function thumbState(kept: ThumbStamp | undefined, now: ThumbStamp) {
  if (!kept || kept.epoch !== now.epoch) return "stale";
  if (kept.edits === now.edits) return "current";
  return now.edits === kept.edits + 1 ? "part" : "stale";
}
