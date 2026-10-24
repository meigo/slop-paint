import { PRESS_DEFAULT, type BrushSettings } from "./brush";
import type { BrushType } from "./brush-textures";

/** Every brush the toolbar offers: the full-redraw engines plus the stamp tips. */
export type BrushKind =
  "smooth" | "ink" | "calligraphy" | "dry" | "watercolor" | "blend" | BrushType;
import type { FillOptions } from "./fill";
import { PressureCurve } from "./pressure-curve";
import { DEFAULT_PANEL_WIDTH } from "./panel-layout";
import { isAppleTouch } from "./share";

export type Tool =
  "brush" | "eraser" | "blend" | "fill" | "select" | "lasso" | "move" | "eyedropper" | "outline";

/** The tools that draw a stroke (a brush outline under the pointer, a stroke gesture, a settings
 *  slot of their own): Brush, Eraser and Blend (a tool since 2026-10-24, not a brush type). */
export function isStrokeTool(tool: Tool): boolean {
  return tool === "brush" || tool === "eraser" || tool === "blend";
}

interface AppStateShape {
  currentTool: Tool;
  brushType: BrushKind;
  sizeRange: number;
  streamline: number;
  brushSettings: BrushSettings;
  fillSettings: FillOptions;
  zoomText: string;
  layerVersion: number;
  /** Bumped by a pixel edit on ONE layer (`pixelLayerId`) — a stroke, a fill, a clear — which
   *  changes no row: the panel redraws just that thumbnail, instead of rebuilding every row and
   *  thumbnail as a `layerVersion` bump does. What reads pixels (autosave, the Move box) watches
   *  both. */
  pixelVersion: number;
  pixelLayerId: number;
  /** Rows selected together (2026-10-02): empty = just the active row. Delete and Group act on
   *  them; painting stays on the active layer. Session only. */
  layerSelection: number[];
  /** The layer panel's Select mode: a tap on a row adds or removes it from `layerSelection`. */
  layerSelecting: boolean;
  selectionVersion: number;
  docWidth: number;
  docHeight: number;
  /** Selection transform: corner handles keep the aspect ratio. */
  keepProportions: boolean;
  /** Settings: show the Spine tag UI (layer strip chips/menu, "for Spine" export wording). */
  spineTools: boolean;
  /** Settings: keep layers at the screen's pixel density (2× on Retina/iPad, 4× the memory) rather
   *  than at document pixels. Saves and exports are document pixels either way. */
  hiResLayers: boolean;
  /** Bridge, for the bucket AND Fill enclosed: close line breaks of about 2×this px (0..MAX_GAP).
   *  Saved under its old name, from when only Fill enclosed had it. */
  fillEnclosedGap: number;
  /** Bumped by the undo stack so canUndo/canRedo can drive the UI (a class getter is not reactive). */
  historyVersion: number;
  /** Layer panel width in px (drag its left edge). */
  layerPanelWidth: number;
  /** Transient message for the status bar (see flashStatus). */
  statusMessage: string;
  /** A lasting condition (autosave off or failing), shown whenever no short message is: a later
   *  ordinary message used to replace it for good, leaving e.g. "autosave is off" unsaid. */
  statusSticky: string;
  /** What the control under the pointer does — iPad has no hover, so titles go here. */
  statusHint: string;
  /** Fill's own colour and opacity (as slop-animator): outlines and flats are different colours, so
   *  the bucket no longer shares the brush's swatch. */
  fillColor: string;
  fillOpacity: number;
  /** The project's name: save and export file names come from it (as slop-animator). */
  projectName: string;
  /** Which colour the eyedropper sets: the fill's when it will hand back to Fill, else the brush's. */
  eyedropperTarget: "brush" | "fill";
  /** Outline tool knobs (see `outline.ts`). Session-only, not saved with the settings. */
  outline: { thickness: number; wobble: number; variation: number; seed: number };
  /** An Outline preview is live in the active layer (Apply/Cancel can act). */
  outlineActive: boolean;
}

export const app: AppStateShape = $state({
  currentTool: "brush",
  brushType: "smooth",
  sizeRange: PRESS_DEFAULT,
  streamline: 50,
  brushSettings: {
    size: 4,
    taper: false,
    sharpCorners: false,
    color: "#1a1a1a",
    opacity: 100,
    smoothing: 50,
    isEraser: false,
    drawBehind: false,
    alphaLock: false,
    nibAngle: 45,
    nibFlatness: 0.35,
    dwellPool: 0,
    dryness: 50,
    dryTaper: 10,
    washEdge: 50,
    washGrain: 40,
    washWobble: 30,
    washMultiply: true,
    smoothWobble: 0,
    nibWobble: 0,
    pencilGrade: "HB",
    charcoalTexture: "medium",
    blendSmear: 30,
    blendTip: "soft",
  },
  fillSettings: {
    tolerance: 32,
    expand: 0,
    softEdge: 1,
  },
  zoomText: "100%",
  layerVersion: 0,
  pixelVersion: 0,
  pixelLayerId: -1,
  layerSelection: [],
  layerSelecting: false,
  selectionVersion: 0,
  docWidth: 1920,
  docHeight: 1080,
  keepProportions: true,
  spineTools: true,
  // Off on iPad: 40 layers at 2× (1.2 GB) got blanked in the background.
  hiResLayers:
    typeof navigator === "undefined" ||
    !isAppleTouch(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
  fillEnclosedGap: 0,
  historyVersion: 0,
  layerPanelWidth: DEFAULT_PANEL_WIDTH,
  statusMessage: "",
  statusSticky: "",
  statusHint: "",
  fillColor: "#1a1a1a",
  fillOpacity: 100,
  eyedropperTarget: "brush",
  projectName: "untitled",
  outline: { thickness: 3, wobble: 0.35, variation: 0.35, seed: 1 },
  outlineActive: false,
});

// PressureCurve is not reactive — it's an imperative canvas widget
/** One curve per stroke tool: the eraser got its own so a tuned brush feel isn't shared, and Blend
 *  too. */
export const pressureCurves = {
  brush: new PressureCurve(),
  eraser: new PressureCurve(),
  blend: new PressureCurve(),
};

/** The curve for the active tool — the eraser's and Blend's own, everything else the brush's. */
export function activePressureCurve(): PressureCurve {
  if (app.currentTool === "eraser") return pressureCurves.eraser;
  if (app.currentTool === "blend") return pressureCurves.blend;
  return pressureCurves.brush;
}

export function bumpLayerVersion() {
  app.layerVersion++;
}

/** A pixel edit on `layerId` alone: see `pixelVersion`. */
export function bumpPixelVersion(layerId: number) {
  app.pixelLayerId = layerId;
  app.pixelVersion++;
}

export function bumpSelectionVersion() {
  app.selectionVersion++;
}

let statusTimer: ReturnType<typeof setTimeout> | undefined;
/** The lasting conditions showing, oldest first. One slot let any later one — an uncaught error,
 *  say — replace "Autosave is off" for good, and nothing brought it back. */
const stickies: string[] = [];
function showStickies() {
  app.statusSticky = stickies.join(" · ");
}

/** Show a short message in the status bar, e.g. why an action did nothing. `ms = 0` is a lasting
 *  condition (autosave failing or off) rather than a one-off explanation: it stays, behind any
 *  later short message and beside any other lasting one, until `clearSticky`. */
export function flashStatus(message: string, ms = 4000) {
  clearTimeout(statusTimer);
  if (ms === 0) {
    if (!stickies.includes(message)) stickies.push(message);
    showStickies();
    app.statusMessage = "";
    return;
  }
  app.statusMessage = message;
  statusTimer = setTimeout(() => (app.statusMessage = ""), ms);
}

/** End lasting conditions (`flashStatus(msg, 0)`): those starting with `message`, or all. */
export function clearSticky(message?: string) {
  for (let i = stickies.length - 1; i >= 0; i--) {
    if (message === undefined || stickies[i].startsWith(message)) stickies.splice(i, 1);
  }
  showStickies();
}
