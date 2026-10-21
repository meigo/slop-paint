/** A reversible edit. The caller performs the action, then pushes the command. */
export interface Command {
  undo(): void;
  redo(): void;
  label?: string;
  /** Retained RAM for this command (e.g. two ImageData copies). Used to evict old pixel undos. */
  bytes?: number;
  /** How many layers it can change at once (default 1): a Move of several layers is one step. */
  layers?: number;
}

/** Default pixel-undo budget. Pixel steps keep only the tiles they changed (`changedTiles`):
 *  whole layers were 66 MB a step on a 1920×1080 doc at dpr 2, so only ~4 steps fit. */
export const DEFAULT_HISTORY_BYTES = 256 * 1024 * 1024;

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Undo keeps pixels in square tiles this many canvas px a side. */
export const UNDO_TILE = 64;

/** The `tile`-px tiles (clipped at the edges) where two same-size RGBA buffers (`width` ×
 *  `height`) differ, in row order; empty when they are identical. Compares whole pixels 32 bits at
 *  a time — this runs on every stroke's full-layer snapshots. Tiles, not one bounding box: a thin
 *  stroke across the page has a bounding box as big as the page. */
export function changedTiles(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  tile = UNDO_TILE,
): PixelRect[] {
  const n = width * height;
  const A = new Uint32Array(a.buffer, a.byteOffset, n);
  const B = new Uint32Array(b.buffer, b.byteOffset, n);
  const out: PixelRect[] = [];
  for (let ty = 0; ty < height; ty += tile) {
    const th = Math.min(tile, height - ty);
    for (let tx = 0; tx < width; tx += tile) {
      const tw = Math.min(tile, width - tx);
      scan: for (let y = ty; y < ty + th; y++) {
        const row = y * width;
        for (let x = row + tx, end = row + tx + tw; x < end; x++) {
          if (A[x] !== B[x]) {
            out.push({ x: tx, y: ty, w: tw, h: th });
            break scan;
          }
        }
      }
    }
  }
  return out;
}

/** The parts of a `width` × `height` canvas that a shift by (`dx`, `dy`) whole px carries off it
 *  — a strip at the far side of each axis it moves along (the Move tool's release cuts them). Up
 *  to two rects that don't overlap; none when the shift is 0, everything when it is a canvas or
 *  more. */
export function offCanvasRects(width: number, height: number, dx: number, dy: number): PixelRect[] {
  const ax = Math.min(Math.abs(dx), width);
  const ay = Math.min(Math.abs(dy), height);
  const out: PixelRect[] = [];
  // Columns that leave sideways, full height.
  if (ax > 0) out.push({ x: dx > 0 ? width - ax : 0, y: 0, w: ax, h: height });
  // Rows that leave up or down, without the columns already counted.
  if (ay > 0 && ax < width) {
    out.push({ x: dx > 0 ? 0 : ax, y: dy > 0 ? height - ay : 0, w: width - ax, h: ay });
  }
  return out;
}

/** `r`'s pixels out of a `width`-wide RGBA buffer, as a tightly packed buffer. */
export function cropPixels(
  data: Uint8ClampedArray,
  width: number,
  r: PixelRect,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const from = ((r.y + y) * width + r.x) * 4;
    out.set(data.subarray(from, from + r.w * 4), y * r.w * 4);
  }
  return out;
}

export class History {
  /** Fired after any change to either stack. The UI mirrors `canUndo`/`canRedo` into `$state`
   *  through this: a plain class getter is not a reactive dependency, so a button bound directly
   *  to `history.canUndo` would never re-render. One hook here beats notifying at every push site. */
  onChange?: () => void;
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private bytes = 0;
  /** Layers changed by pushes, undos and redos so far, each step counted by its `layers`. Only
   *  ever grows: the blank-layers guard compares it with its value at the last save (every way the
   *  user empties a layer is a step, so more layers emptied than this grew by means something
   *  else emptied them). */
  layerChanges = 0;
  private maxSize: number;
  private maxBytes: number;
  constructor(maxSize = 50, maxBytes = DEFAULT_HISTORY_BYTES) {
    this.maxSize = maxSize;
    this.maxBytes = maxBytes;
  }

  push(cmd: Command): void {
    for (const c of this.redoStack) this.bytes -= c.bytes ?? 0;
    this.redoStack = [];
    this.undoStack.push(cmd);
    this.layerChanges += cmd.layers ?? 1;
    this.bytes += cmd.bytes ?? 0;
    this.trim(cmd.bytes ?? 0);
    this.onChange?.();
  }

  /** Drops the oldest steps over the count, and over the byte budget — but only when the new step
   *  brought pixels of its own. A step with none (eye, rename, opacity) adds no memory, and evicting
   *  for it threw away a step that alone was over the budget (a Move of many layers: one eye toggle
   *  later it could no longer be undone). The newest step always stays. */
  private trim(added: number): void {
    while (
      this.undoStack.length > this.maxSize ||
      (added > 0 && this.bytes > this.maxBytes && this.undoStack.length > 1)
    ) {
      const old = this.undoStack.shift();
      if (!old) break;
      this.bytes -= old.bytes ?? 0;
    }
    if (this.bytes < 0) this.bytes = 0;
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.layerChanges += cmd.layers ?? 1;
    this.redoStack.push(cmd);
    this.onChange?.();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.redo();
    this.layerChanges += cmd.layers ?? 1;
    this.undoStack.push(cmd);
    this.onChange?.();
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
    this.onChange?.();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
