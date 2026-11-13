import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  history,
  pushLayersEdit,
  pushPixelEdit,
  pushStrokeEdit,
  setOnHistoryApplied,
  shiftLoss,
  StrokeBackup,
  type PixelChange,
} from "../undo";
import { cropPixels } from "../history";
import type { Layer, LayerManager, RefPlacement } from "../layers";

// An edit that changed no pixel must push no step: an empty step wipes redo and makes the next
// undo appear to do nothing (Move of empty layers, a stroke or Clear on an empty layer).

const W = 128;
const H = 64;

beforeAll(() => {
  // Node has no ImageData; undo.ts only constructs it and reads data/width/height.
  (globalThis as unknown as { ImageData: unknown }).ImageData ??= class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
});

beforeEach(() => history.clear());

const image = (data = new Uint8ClampedArray(W * H * 4)) =>
  ({ data, width: W, height: H }) as ImageData;

/** A manager whose layers' snapshots are whatever `now` holds. */
function rig(now: ImageData) {
  const layer = {} as Layer;
  const layers = { snapshotOf: () => now, restoreTo() {} } as unknown as LayerManager;
  return { layer, layers };
}

/** One step on the redo stack, to see whether a push wipes it. */
function withRedo() {
  history.push({ undo() {}, redo() {} });
  history.undo();
  expect(history.canRedo).toBe(true);
}

describe("pushPixelEdit", () => {
  it("pushes nothing when no pixel changed", () => {
    const { layer, layers } = rig(image());
    withRedo();
    expect(pushPixelEdit(layers, layer, image())).toBe(false);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it("pushes a step when a pixel changed", () => {
    const after = image();
    after.data[3] = 255;
    const { layer, layers } = rig(after);
    expect(pushPixelEdit(layers, layer, image())).toBe(true);
    expect(history.canUndo).toBe(true);
  });
});

/** A W × H layer over a plain pixel buffer: `getImageData` copies out of it, `paint` writes a pixel
 *  as a stroke would, and the manager's `restoreTo` writes tiles back into it. */
function bufferLayer() {
  const px = new Uint8ClampedArray(W * H * 4);
  const layer = {
    canvas: { width: W, height: H },
    ctx: {
      getImageData: (x: number, y: number, w: number, h: number) =>
        new ImageData(cropPixels(px, W, { x, y, w, h }), w, h),
    },
  } as unknown as Layer;
  const layers = {
    restoreTo: (_l: Layer, d: ImageData, x: number, y: number) => {
      for (let r = 0; r < d.height; r++)
        px.set(d.data.subarray(r * d.width * 4, (r + 1) * d.width * 4), ((y + r) * W + x) * 4);
    },
  } as unknown as LayerManager;
  const paint = (x: number, y: number, a = 255) => (px[(y * W + x) * 4 + 3] = a);
  const alpha = (x: number, y: number) => px[(y * W + x) * 4 + 3];
  return { layer, layers, paint, alpha };
}

describe("StrokeBackup / pushStrokeEdit", () => {
  it("keeps a tile's pixels from before the stroke reached it, and undo puts them back", () => {
    const { layer, layers, paint, alpha } = bufferLayer();
    paint(70, 10, 100); // already on the layer
    const backup = new StrokeBackup(layer);
    backup.keep({ x: 60, y: 5, w: 20, h: 10 }); // tiles x 0 and 64, row 0
    paint(70, 10); // the stroke paints over it
    paint(5, 5); // and in the other kept tile
    let bytes = 0;
    const push = history.push.bind(history);
    history.push = (c) => ((bytes = c.bytes ?? 0), push(c));
    try {
      expect(pushStrokeEdit(layers, backup)).toBe(true);
    } finally {
      history.push = push;
    }
    expect(bytes).toBe(2 * 2 * 64 * 64 * 4); // two tiles, both sides
    history.undo();
    expect(alpha(70, 10)).toBe(100);
    expect(alpha(5, 5)).toBe(0);
    history.redo();
    expect(alpha(70, 10)).toBe(255);
    expect(alpha(5, 5)).toBe(255);
  });

  it("keeps a tile once: a second keep after paint landed doesn't replace the before", () => {
    const { layer, layers, paint, alpha } = bufferLayer();
    const backup = new StrokeBackup(layer);
    backup.keep({ x: 0, y: 0, w: 10, h: 10 });
    paint(3, 3);
    backup.keep({ x: 0, y: 0, w: 30, h: 30 }); // the next frame, same tile
    pushStrokeEdit(layers, backup);
    history.undo();
    expect(alpha(3, 3)).toBe(0);
  });

  it("leaves out kept tiles that didn't change, and pushes nothing when none did", () => {
    const { layer, layers, paint } = bufferLayer();
    withRedo();
    const backup = new StrokeBackup(layer);
    backup.keep({ x: 0, y: 0, w: W, h: H });
    expect(pushStrokeEdit(layers, backup)).toBe(false);
    expect(history.canRedo).toBe(true);

    const again = new StrokeBackup(layer);
    again.keep({ x: 0, y: 0, w: W, h: H });
    paint(100, 50);
    let bytes = 0;
    const push = history.push.bind(history);
    history.push = (c) => ((bytes = c.bytes ?? 0), push(c));
    try {
      pushStrokeEdit(layers, again);
    } finally {
      history.push = push;
    }
    expect(bytes).toBe(2 * 64 * 64 * 4); // the one tile with (100, 50)
  });
});

/** A layer holding `img`'s pixels, counting what is read from it (`reads`: "x,y wxh"). */
function readOnlyLayer(img: ImageData) {
  const reads: string[] = [];
  const layer = {
    canvas: { width: img.width, height: img.height },
    ctx: {
      getImageData: (x: number, y: number, w: number, h: number) => {
        reads.push(`${x},${y} ${w}x${h}`);
        return new ImageData(cropPixels(img.data, img.width, { x, y, w, h }), w, h);
      },
    },
  } as unknown as Layer;
  return { layer, reads };
}

/** What a shift by (`dx`, `dy`) carries off a layer holding `before`. */
const lossOf = (before: ImageData, dx: number, dy: number) =>
  shiftLoss(readOnlyLayer(before).layer, dx, dy);

describe("the undo hook", () => {
  it("is told which layer a tile step changed, and where; a Move tells nothing", () => {
    const seen: (PixelChange[] | undefined)[] = [];
    setOnHistoryApplied((changed) => seen.push(changed));
    try {
      const { layer, layers, paint } = bufferLayer();
      const backup = new StrokeBackup(layer);
      backup.keep({ x: 0, y: 0, w: W, h: H });
      paint(5, 5);
      paint(100, 50); // the next tile along
      pushStrokeEdit(layers, backup);
      history.undo();
      history.redo();
      const box = [{ layer, rect: { x: 0, y: 0, w: 128, h: 64 } }];
      expect(seen).toEqual([box, box]);

      seen.length = 0;
      const all = image(new Uint8ClampedArray(W * H * 4).fill(255));
      const moved = { shiftPixels() {}, restoreTo() {} } as unknown as LayerManager;
      pushLayersEdit(moved, [{ layer, lost: lossOf(all, 4, 0) }], 4, 0);
      history.undo();
      expect(seen).toEqual([undefined]);
    } finally {
      setOnHistoryApplied(() => {});
    }
  });
});

describe("shiftLoss", () => {
  // The Move's release read every layer whole and held them all (~1.9 GB for 20 large layers).
  it("reads only the strip that leaves, then looks for paint a band at a time", () => {
    const tall = { data: new Uint8ClampedArray(W * 600 * 4), width: W, height: 600 } as ImageData;
    tall.data[(300 * W + 7) * 4 + 3] = 255; // paint in the second band, staying on the canvas
    const { layer, reads } = readOnlyLayer(tall);
    const lost = shiftLoss(layer, 0, 5);
    expect(lost).toEqual({ inked: true, tiles: [] });
    // The bottom 5 rows; then bands of 256 rows until one holds paint (the third isn't read).
    expect(reads).toEqual(["0,595 128x5", "0,0 128x256", "0,256 128x256"]);
  });

  it("an empty layer is not inked", () => {
    const { layer } = readOnlyLayer(image());
    expect(shiftLoss(layer, 3, 3)).toEqual({ inked: false, tiles: [] });
  });

  it("keeps the same tiles whether a strip is read in one band or several", () => {
    const tall = {
      data: new Uint8ClampedArray(W * 600 * 4).fill(255),
      width: W,
      height: 600,
    } as ImageData;
    const { layer, reads } = readOnlyLayer(tall);
    const lost = shiftLoss(layer, 10, 0);
    // The right 10 columns, full height, in three bands; paint found there, so no further read.
    expect(reads).toEqual(["118,0 10x256", "118,256 10x256", "118,512 10x88"]);
    expect(lost.tiles.map((t) => `${t.x},${t.y} ${t.data.width}x${t.data.height}`)).toEqual(
      [0, 64, 128, 192, 256, 320, 384, 448, 512, 576].map(
        (y) => `118,${y} 10x${y === 576 ? 24 : 64}`,
      ),
    );
  });
});

describe("pushLayersEdit", () => {
  it("pushes nothing when no layer changed", () => {
    const { layer, layers } = rig(image());
    withRedo();
    pushLayersEdit(
      layers,
      [
        { layer, lost: lossOf(image(), 5, 0) },
        { layer, lost: lossOf(image(), 5, 0) },
      ],
      5,
      0,
    );
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it("pushes a step when one of them changed", () => {
    const { layer, layers } = rig(image());
    const changed = image();
    changed.data[3] = 255;
    pushLayersEdit(
      layers,
      [
        { layer, lost: lossOf(image(), 5, 0) },
        { layer, lost: lossOf(changed, 5, 0) },
      ],
      5,
      0,
    );
    expect(history.canUndo).toBe(true);
  });

  // V18-1: a Move kept both sides of every tile it touched — a few full layers passed the whole
  // budget. Now it keeps only the paint pushed off the canvas, and shifts the rest back.
  it("keeps only the inked tiles pushed off the canvas, and shifts back and forth", () => {
    const calls: string[] = [];
    const layer = {} as Layer;
    const layers = {
      shiftPixels: (_l: Layer, dx: number, dy: number) => calls.push(`shift ${dx},${dy}`),
      restoreTo: (_l: Layer, d: ImageData, x: number, y: number) =>
        calls.push(`put ${x},${y} ${d.width}x${d.height} a${d.data[3]}`),
    } as unknown as LayerManager;
    // A layer painted all over, moved 10 px right and 3 px down.
    const before = image(new Uint8ClampedArray(W * H * 4).fill(255));
    let bytes = 0;
    const push = history.push.bind(history);
    history.push = (c) => ((bytes = c.bytes ?? 0), push(c));
    try {
      pushLayersEdit(layers, [{ layer, lost: lossOf(before, 10, 3) }], 10, 3);
    } finally {
      history.push = push;
    }
    // The right 10 columns (full height) and the bottom 3 rows (the rest of the width).
    expect(bytes).toBe((10 * H + (W - 10) * 3) * 4);
    history.undo();
    expect(calls).toEqual([
      "shift -10,-3",
      "put 118,0 10x64 a255",
      "put 0,61 64x3 a255",
      "put 64,61 54x3 a255",
    ]);
    calls.length = 0;
    history.redo();
    expect(calls).toEqual(["shift 10,3"]);
  });

  it("keeps nothing for paint that stays on the canvas", () => {
    const layer = {} as Layer;
    const layers = { shiftPixels() {}, restoreTo() {} } as unknown as LayerManager;
    const before = image();
    before.data[(10 * W + 10) * 4 + 3] = 255; // one pixel near the top left, moved right
    let bytes = -1;
    const push = history.push.bind(history);
    history.push = (c) => ((bytes = c.bytes ?? 0), push(c));
    try {
      pushLayersEdit(layers, [{ layer, lost: lossOf(before, 20, 0) }], 20, 0);
    } finally {
      history.push = push;
    }
    expect(history.canUndo).toBe(true);
    expect(bytes).toBe(0);
  });

  it("re-draws a reference from its original instead of keeping pixels", () => {
    const drawn: unknown[] = [];
    const refBefore = { src: {}, corners: [] } as unknown as RefPlacement;
    const refAfter = { src: {}, corners: [] } as unknown as RefPlacement;
    const layer = { ref: refAfter } as Layer;
    const layers = {
      renderRef: (l: Layer) => drawn.push(l.ref),
      shiftPixels() {
        throw new Error("a re-drawn reference isn't shifted");
      },
    } as unknown as LayerManager;
    pushLayersEdit(layers, [{ layer, refBefore, redrawn: true }], 4, 4);
    history.undo();
    history.redo();
    expect(drawn).toEqual([refBefore, refAfter]);
  });
});
