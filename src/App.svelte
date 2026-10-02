<script lang="ts">
  import Toolbar from "./lib/Toolbar.svelte";
  import LayerPanel from "./lib/LayerPanel.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import NewDocDialog from "./lib/NewDocDialog.svelte";
  import SettingsDialog from "./lib/SettingsDialog.svelte";
  import ResizeDocDialog from "./lib/ResizeDocDialog.svelte";
  import { setupInput, type InputPoint } from "./input";
  import { clampPress, drawStroke, widthRange } from "./brush";
  import { pathSmoothRadius, STAMP_MIN_ROPE_PX } from "./stroke-smoothing";
  import { settledIndex } from "./stroke-freeze";
  import { dragBlock } from "./lib/layer-drop";
  import { drawInkStroke } from "./ink-brush";
  import { drawDryStroke } from "./dry-brush";
  import { drawCalligraphyStroke, nibSemiAxes } from "./calligraphy-brush";
  import { drawStampStrokeIncremental, resetStampState } from "./stamp-brush";
  import {
    LayerManager,
    adjacentRow,
    layersToMove,
    topSelection,
    type Layer,
    type RefPlacement,
    type RefSource,
    type StructSnapshot,
  } from "./layers";
  import {
    cornersFromMatrix,
    cornersFromRect,
    matrixFromCorners,
    type Corners,
  } from "./ref-placement";
  import { decodeRefSource } from "./ref-image";
  import { buildTextSource } from "./text-ref";
  import {
    addFontFile,
    fontLibraryReady,
    fontSource,
    libraryFonts,
    removeLibraryFont,
  } from "./text-fonts";
  import {
    DEFAULT_TEXT_SPEC,
    fontKey,
    fontLabel,
    refitCorners,
    textLayerName,
    type TextSpec,
  } from "./text-layout";
  import TextDialog from "./lib/TextDialog.svelte";
  import { refFocusChange } from "./ref-tool";
  import {
    enclosedFillRegion,
    fillRegionBehind,
    floodFill,
    hexToRgba,
    MAX_SOFT_EDGE,
    rgbToHex,
    sameImageData,
  } from "./fill";
  import { clampGap } from "./fill-holes";
  import {
    alphaBounds,
    bleedColor,
    buildNoisePlanes,
    localDepth,
    outlineMask,
    signedDistanceField,
    OUTLINE_MARGIN,
    type OutlineNoisePlanes,
  } from "./outline";
  import { clampPanelWidth, panelBesideToolOptions } from "./panel-layout";
  import { isTextEntry } from "./lib/text-entry";
  import { nameFromFile, sanitizeFilename } from "./filename";
  import { Selection, type SelectionRect } from "./selection";
  import { MESH_MIN, meshStepBlock } from "./mesh-size";
  import {
    imageUrlFromClipboard,
    placeExternalImage,
    placeInternalPaste,
    referenceLayerName,
    REFERENCE_OPACITY,
  } from "./paste";
  import { Viewport } from "./viewport";
  import { setupTouchGestures } from "./touch-gestures";
  import { exportPsd, savePsd, loadPsd, psdBuffer } from "./export-psd";
  import {
    clearAutosave,
    keepLatestAutosave,
    listAutosaves,
    loadAutosave,
    saveAutosave,
    type AutosaveEntry,
  } from "./persist/autosave";
  import {
    formatBytes,
    IPAD_MEMORY_WARN_BYTES,
    layerMemoryBytes,
    looksBlanked,
  } from "./persist/autosave-plan";
  import {
    history,
    pushLayersEdit,
    pushPixelEdit,
    pushRefEdit,
    setOnHistoryApplied,
    structuralEdit,
  } from "./undo";
  import {
    canShareFile,
    isAppleTouch,
    isStandalone,
    saveToFilesAvailable,
    shareFile,
  } from "./share";
  import {
    fileAccessAvailable,
    isAbort,
    pickOpenFile,
    pickSaveFile,
    writeFile,
  } from "./file-access";
  import { downloadBlob } from "./download";
  import ShareReadyDialog from "./lib/ShareReadyDialog.svelte";
  import RestoreDialog from "./lib/RestoreDialog.svelte";
  import { untrack } from "svelte";
  import {
    app,
    pressureCurves,
    activePressureCurve,
    bumpLayerVersion,
    bumpSelectionVersion,
    flashStatus,
    clearSticky,
    type Tool,
    type BrushKind,
  } from "./appState.svelte.js";
  import {
    allSlots,
    parseSlot,
    readSlot,
    swapSlots,
    writeSlot,
    type SlotName,
    type StrokeSlot,
  } from "./tool-settings";

  // --- Canvas refs ---
  let canvasContainerEl: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;
  let selectionOverlayEl: HTMLCanvasElement;
  let canvasClipEl = $state() as HTMLDivElement;
  let workspaceEl: HTMLDivElement;
  let viewportW = $state(window.innerWidth);
  // Toolbar row 1 always spans the full width. The layer panel starts right under it, beside the
  // tool-options row, when that row still fits next to it (desktop); otherwise it starts below the
  // options row too (iPad). Re-evaluated as the window turns or the panel is dragged wider.
  const panelBeside = $derived(panelBesideToolOptions(viewportW, app.layerPanelWidth));
  let fileInputEl: HTMLInputElement;
  let imageInputEl: HTMLInputElement;

  // --- Core objects (imperative, not $state) ---
  let viewport = $state.raw() as Viewport;
  let layers = $state.raw() as LayerManager;
  let selection = $state.raw() as Selection;

  // --- Expose layers for child components ---
  let layersReady = $state(false);
  let showNewDocDialog = $state(false);
  let showSettingsDialog = $state(false);
  let showResizeDialog = $state(false);

  // --- Batched composite: coalesce multiple composite calls per frame ---
  let compositeScheduled = false;
  function scheduleComposite() {
    if (compositeScheduled) return;
    compositeScheduled = true;
    requestAnimationFrame(() => {
      compositeScheduled = false;
      layers?.composite();
    });
  }

  // --- Selection state ---
  let preSelectionSnapshot: ImageData | null = null;
  /** The layer a float was lifted from (or pasted onto): Apply draws back onto IT and Cancel
   *  restores IT, whichever layer is active by then (see the effect that applies it on a switch). */
  let floatLayer: Layer | null = null;
  let selectionMode: "create" | "drag" | null = null;

  // --- Drawing state ---
  let preStrokeSnapshot: ImageData | null = null;
  // Fast canvas backup for smooth brush (GPU-accelerated drawImage vs slow putImageData)
  let preStrokeCanvas: HTMLCanvasElement | null = null;
  // Batched smooth brush rendering — only redraw once per frame, from the LATEST points.
  // Null once the stroke ends, so a frame still pending at pen-up can't redraw the unfinished stroke.
  let smoothPendingPoints: InputPoint[] | null = null;
  // Raw points of the brush/eraser stroke in progress, null between strokes.
  let openStrokePoints: InputPoint[] | null = null;
  /** The layer a brush/eraser stroke started on. The stroke stays on it to the end: the active
   *  layer can change under an open stroke (↑/↓, a finger on the layer panel), and re-reading it
   *  drew the first layer's pre-stroke copy over the new one, with the wrong undo `before`. */
  let strokeLayer: Layer | null = null;
  let dropStrokeUntilUp = false;

  function saveLayerToCanvas(layer: {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
  }): HTMLCanvasElement {
    if (
      !preStrokeCanvas ||
      preStrokeCanvas.width !== layer.canvas.width ||
      preStrokeCanvas.height !== layer.canvas.height
    ) {
      preStrokeCanvas = document.createElement("canvas");
      preStrokeCanvas.width = layer.canvas.width;
      preStrokeCanvas.height = layer.canvas.height;
    }
    const ctx = preStrokeCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, preStrokeCanvas.width, preStrokeCanvas.height);
    ctx.drawImage(layer.canvas, 0, 0);
    return preStrokeCanvas;
  }

  /**
   * Freezing a long stroke (2026-10-01). Ink and Calligraphy redraw the whole stroke every frame
   * (a piecewise draw would composite edge pixels many times and harden them), so a frame cost
   * more the longer the stroke: at ~20 s of Pencil (4800 points) 14–16 ms on a Mac, laggy on
   * iPad. For an OPAQUE stroke the settled part — far enough behind the pen that new points can no
   * longer change it — is now baked into `preStrokeCanvas` every `FREEZE_STEP` points, so each
   * frame's restore brings it back and only the rest is redrawn. The engines draw a RANGE of the
   * stroke from geometry worked out over the whole of it, so the baked part is the same pixels;
   * each draw starts `FREEZE_OVERLAP` points early, so the cut lies inside paint and can't show as
   * a seam (opaque paint drawn twice looks the same). Translucent strokes keep the full redraw:
   * drawn twice, the overlap would darken.
   */
  let frozenTo = 0;
  const FREEZE_STEP = 300;
  const FREEZE_OVERLAP = 8;

  function restoreLayerFromCanvas(layer: {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
  }) {
    if (!preStrokeCanvas) return;
    layer.ctx.save();
    layer.ctx.resetTransform();
    layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    layer.ctx.drawImage(preStrokeCanvas, 0, 0);
    layer.ctx.restore();
  }

  // --- Brush cursor ---
  let brushCursorEl: HTMLDivElement;
  let brushDotEl: HTMLDivElement;
  let brushCursorVisible = false;
  let isDrawing = false;

  /** The brush outline under the pointer, as slop-animator's BrushCursor: the nominal stroke width
   *  (the size slider; light pressure draws thinner and full pressure wider, by Press), drawn as the
   *  actual nib for Calligraphy — flattened, and turned by the nib angle plus the view's own
   *  rotation — dashed for the eraser, with a dot on the exact point. Shown anywhere in the canvas
   *  area (a stroke can start off the page); hidden where no stroke can land (locked/hidden layer). */
  function updateBrushCursor(screenX: number, screenY: number) {
    if (!brushCursorEl || !brushDotEl || !canvasClipEl || !viewport || !layers) return;
    const isBrushTool = app.currentTool === "brush" || app.currentTool === "eraser";
    if (!isBrushTool || spaceHeld || viewport.panning || isDrawing) return hideBrushCursor();
    const layer = layers.active;
    if (refTransform) {
      hideBrushCursor(); // a drag moves the reference: handleCursorMove shows the handle cursors
      return;
    }
    if (paintBlock(layer) || layer.ref) {
      hideBrushCursor();
      canvasClipEl.style.cursor = "not-allowed";
      return;
    }
    const rect = canvasClipEl.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;
    const diameter = app.brushSettings.size * viewport.zoom;
    let height = diameter;
    let turn = 0;
    if (app.brushType === "calligraphy") {
      height = nibSemiAxes(diameter / 2, app.brushSettings.nibFlatness ?? 0).b * 2;
      turn = (app.brushSettings.nibAngle ?? 0) + (viewport.rotation * 180) / Math.PI;
    }
    const at = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    brushCursorEl.style.width = diameter + "px";
    brushCursorEl.style.height = height + "px";
    brushCursorEl.style.transform = `${at} rotate(${turn}deg)`;
    brushCursorEl.style.borderStyle = app.currentTool === "eraser" ? "dashed" : "solid";
    brushDotEl.style.transform = at;
    brushCursorEl.style.display = "block";
    brushDotEl.style.display = "block";
    canvasClipEl.style.cursor = "none";
    brushCursorVisible = true;
  }

  function hideBrushCursor() {
    if (brushCursorEl && brushCursorVisible) {
      brushCursorEl.style.display = "none";
      brushDotEl.style.display = "none";
      brushCursorVisible = false;
    }
  }

  // --- Where pixels may land ---
  const GROUP_SELECTED = "A group is selected — pick a layer to draw on";

  /** Why a pixel edit can't land on `layer` (the active one), or "": a group row selected (the
   *  active layer then falls back to the bottom one — strokes landed on Background), a lock, or
   *  the layer out of sight (a hidden layer or group: edits you can't see, with undo steps). */
  function paintBlock(layer: Layer): string {
    if (!layers) return "";
    if (layers.activeIsGroup) return GROUP_SELECTED;
    if (layers.isLocked(layer)) return "Layer is locked";
    if (layers.isHidden(layer)) return "Layer is hidden";
    return "";
  }

  // --- Layer resolution ---
  /** Pixels per document unit the layers (and the display canvas) are kept at: the screen's
   *  density with Sharp layers on, else 1. Saves and exports are document pixels either way, so
   *  the extra is only on screen — and 4× the memory at 2×. The selection overlay stays at the
   *  screen's density regardless (crisp handles). */
  function docDpr(): number {
    // The ratio the layers ARE at: it changes only with setPixelRatio (startup, the toggle), never
    // with the window's density — browser zoom or another monitor changed the ratio under 2×
    // canvases, and fills, lifts and new layers landed at the wrong scale.
    return layers ? layers.pixelRatio : wantedDpr();
  }

  /** The ratio Sharp layers asks for on this screen. */
  function wantedDpr(): number {
    return app.hiResLayers ? window.devicePixelRatio || 1 : 1;
  }

  /** Edit ▸ Settings ▸ Sharp layers: resample the open document to the new resolution. */
  function setLayerResolution(hi: boolean) {
    if (!layers || hi === app.hiResLayers) return;
    if (selection?.hasFloating) resolveFloat(true); // a float is at the old resolution
    if (outlineActive()) cancelOutline();
    app.hiResLayers = hi;
    layers.setPixelRatio(wantedDpr());
    history.clear(); // snapshots are the old resolution
    resizeCanvas();
    layers.composite();
    bumpLayerVersion();
    markSaved(); // resampling can drop a faint layer's last pixels: a new baseline, not a blanking
    debouncedSave();
    flashStatus(
      hi
        ? "Layers are at screen resolution now — undo history cleared"
        : "Layers are at document pixels now — undo history cleared",
      6000,
    );
  }

  // --- Eyedropper ---
  let eyedropperSwatchEl: HTMLDivElement;

  /** Colour of the composited document at canvas coords, or null off-canvas / on transparency. */
  function sampleColor(x: number, y: number): string | null {
    const dpr = docDpr();
    const px = Math.floor(x * dpr);
    const py = Math.floor(y * dpr);
    if (px < 0 || py < 0 || px >= canvasEl.width || py >= canvasEl.height) return null;
    const [r, g, b, a] = canvasEl.getContext("2d")!.getImageData(px, py, 1, 1).data;
    return a === 0 ? null : rgbToHex(r, g, b);
  }

  function showEyedropperSwatch(x: number, y: number, color: string | null) {
    if (!color) {
      eyedropperSwatchEl.style.display = "none";
      return;
    }
    const s = viewport.canvasToScreen(x, y);
    const rect = canvasClipEl.getBoundingClientRect();
    // Above-left of the point so a finger or Pencil tip doesn't cover it
    eyedropperSwatchEl.style.left = s.x - rect.left - 48 + "px";
    eyedropperSwatchEl.style.top = s.y - rect.top - 48 + "px";
    eyedropperSwatchEl.style.background = color;
    eyedropperSwatchEl.style.display = "block";
  }

  // --- Panning state ---
  let spaceHeld = false;

  // --- Temporary eraser ---
  let toolBeforeEraser: Tool | null = null;
  /** The tool the one-finger double-tap came from, to go back to (as slop-animator). */
  let toolBeforeEraserToggle: Tool | null = null;
  let toolBeforeEyedropper: Tool = "brush";
  let toolBeforeOutline: Tool = "brush";

  // --- Per-tool stroke settings ---
  // The active tool's values live in `app` (the toolbar binds there); this holds the other tool's.
  const strokeSlots: Record<SlotName, StrokeSlot> = {
    brush: readSlot(app),
    eraser: { ...readSlot(app), size: 8 },
  };

  // --- Settings persistence ---
  const STORAGE_KEY = "drawingAppSettings";

  interface SavedSettings {
    tool: string;
    brushType: string;
    size: number;
    opacity: number;
    smoothing: number;
    color: string;
    sizeRange: number;
    streamline?: number;
    curveCp1: { x: number; y: number };
    curveCp2: { x: number; y: number };
    /** Absent in settings saved before the eraser got its own curve: it falls back to the brush's. */
    eraserCurveCp1?: { x: number; y: number };
    eraserCurveCp2?: { x: number; y: number };
    taper?: boolean;
    sharpCorners?: boolean;
    drawBehind?: boolean;
    fillExpand?: number;
    fillSoftEdge?: number;
    keepProportions?: boolean;
    spineTools?: boolean;
    hiResLayers?: boolean;
    fillEnclosedGap?: number;
    fillColor?: string;
    projectName?: string;
    fillOpacity?: number;
    layerPanelWidth?: number;
    nibAngle?: number;
    nibFlatness?: number;
    dwellPool?: number;
    dryness?: number;
    dryTaper?: number;
    pencilGrade?: string;
    charcoalTexture?: string;
    /** Eraser's own stroke settings; the top-level size/opacity/... fields are the brush's. */
    eraser?: StrokeSlot;
  }

  function saveSettings() {
    const slots = allSlots(app, strokeSlots, app.currentTool);
    const data: SavedSettings = {
      // The eyedropper and Outline are transient; reopen on the tool they will return to.
      tool:
        app.currentTool === "eyedropper"
          ? toolBeforeEyedropper
          : app.currentTool === "outline"
            ? toolBeforeOutline
            : app.currentTool,
      brushType: slots.brush.brushType,
      size: slots.brush.size,
      opacity: slots.brush.opacity,
      smoothing: slots.brush.smoothing,
      color: app.brushSettings.color,
      fillColor: app.fillColor,
      projectName: app.projectName,
      fillOpacity: app.fillOpacity,
      sizeRange: slots.brush.sizeRange,
      streamline: slots.brush.streamline,
      eraser: slots.eraser,
      curveCp1: { ...pressureCurves.brush.cp1 },
      curveCp2: { ...pressureCurves.brush.cp2 },
      eraserCurveCp1: { ...pressureCurves.eraser.cp1 },
      eraserCurveCp2: { ...pressureCurves.eraser.cp2 },
      taper: app.brushSettings.taper,
      sharpCorners: app.brushSettings.sharpCorners,
      drawBehind: app.brushSettings.drawBehind,
      fillExpand: app.fillSettings.expand,
      fillSoftEdge: app.fillSettings.softEdge,
      keepProportions: app.keepProportions,
      spineTools: app.spineTools,
      hiResLayers: app.hiResLayers,
      fillEnclosedGap: app.fillEnclosedGap,
      layerPanelWidth: app.layerPanelWidth,
      nibAngle: app.brushSettings.nibAngle,
      nibFlatness: app.brushSettings.nibFlatness,
      dwellPool: app.brushSettings.dwellPool,
      dryness: app.brushSettings.dryness,
      dryTaper: app.brushSettings.dryTaper,
      pencilGrade: app.brushSettings.pencilGrade,
      charcoalTexture: app.brushSettings.charcoalTexture,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* quota exceeded */
    }
  }

  let saveTimer: ReturnType<typeof setTimeout>;
  function debouncedSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSettings, 300);
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data: SavedSettings = JSON.parse(raw);

      if (data.tool) app.currentTool = data.tool as Tool;
      if (data.brushType) app.brushType = data.brushType as BrushKind;
      if (data.size != null) app.brushSettings.size = data.size;
      if (data.opacity != null) app.brushSettings.opacity = data.opacity;
      if (data.smoothing != null) app.brushSettings.smoothing = data.smoothing;
      if (data.color) app.brushSettings.color = data.color;
      // Fill got its own colour later: a save without one starts from the brush's, so nothing changes.
      app.fillColor = data.fillColor ?? data.color ?? app.fillColor;
      if (data.fillOpacity != null) app.fillOpacity = data.fillOpacity;
      if (data.projectName) app.projectName = data.projectName;
      if (data.sizeRange != null) app.sizeRange = clampPress(data.sizeRange);
      if (data.streamline != null) app.streamline = data.streamline;
      if (data.drawBehind != null) app.brushSettings.drawBehind = data.drawBehind;
      if (data.fillExpand != null) app.fillSettings.expand = data.fillExpand;
      if (typeof data.fillSoftEdge === "number")
        app.fillSettings.softEdge = Math.max(0, Math.min(MAX_SOFT_EDGE, data.fillSoftEdge));
      if (typeof data.keepProportions === "boolean") app.keepProportions = data.keepProportions;
      if (typeof data.spineTools === "boolean") app.spineTools = data.spineTools;
      if (typeof data.hiResLayers === "boolean") app.hiResLayers = data.hiResLayers;
      if (data.fillEnclosedGap != null) app.fillEnclosedGap = clampGap(data.fillEnclosedGap);
      if (data.layerPanelWidth != null) {
        app.layerPanelWidth = clampPanelWidth(data.layerPanelWidth, window.innerWidth);
      }
      if (data.nibAngle != null) app.brushSettings.nibAngle = data.nibAngle;
      if (data.nibFlatness != null) app.brushSettings.nibFlatness = data.nibFlatness;
      if (data.dwellPool != null) app.brushSettings.dwellPool = data.dwellPool;
      if (data.dryness != null) app.brushSettings.dryness = data.dryness;
      if (data.dryTaper != null) app.brushSettings.dryTaper = data.dryTaper;
      if (data.pencilGrade != null) app.brushSettings.pencilGrade = data.pencilGrade;
      if (data.charcoalTexture != null) app.brushSettings.charcoalTexture = data.charcoalTexture;
      if (data.curveCp1 && data.curveCp2) {
        pressureCurves.brush.cp1 = data.curveCp1;
        pressureCurves.brush.cp2 = data.curveCp2;
        pressureCurves.brush.buildLUT();
      }
      // Settings saved before the split carry one curve: give the eraser the brush's.
      const eCp1 = data.eraserCurveCp1 ?? data.curveCp1;
      const eCp2 = data.eraserCurveCp2 ?? data.curveCp2;
      if (eCp1 && eCp2) {
        pressureCurves.eraser.cp1 = eCp1;
        pressureCurves.eraser.cp2 = eCp2;
        pressureCurves.eraser.buildLUT();
      }
      if (typeof data.taper === "boolean") app.brushSettings.taper = data.taper;
      if (typeof data.sharpCorners === "boolean")
        app.brushSettings.sharpCorners = data.sharpCorners;
      strokeSlots.brush = readSlot(app);
      strokeSlots.eraser = parseSlot(data.eraser, strokeSlots.eraser);
      if (app.currentTool === "eraser") writeSlot(app, strokeSlots.eraser);
      app.brushSettings.isEraser = app.currentTool === "eraser";
    } catch {
      /* corrupted */
    }
  }

  // --- Undo / Redo ---
  function undo() {
    if (!layers) return;
    // Not under an open stroke: its pre-stroke copy still holds the step, so the release would put
    // the undone pixels back and lose the step for good (a two-finger tap while the Pencil draws).
    if (openStrokePoints) return;
    // A live Outline preview looks like an edit already made, and undo is the artist taking it
    // back. Cancel it and stop there, or the undo would also take back the edit before it.
    if (outlineActive()) {
      cancelOutline();
      return;
    }
    if (selection?.hasFloating) {
      selection.cancel();
      return;
    }
    history.undo();
  }

  function redo() {
    if (!layers) return;
    if (openStrokePoints) return;
    if (outlineActive()) {
      cancelOutline();
      return;
    }
    if (selection?.hasFloating) {
      selection.cancel();
      return;
    }
    history.redo();
  }

  /**
   * Enter free transform mode (scale/rotate/skew handles). From 'selected',
   * lifts pixels into a floating canvas. No-op if already transforming/warping
   * or if there's nothing to transform.
   */
  /** Nothing selected: the transform actions take the whole active layer, as Photoshop's Ctrl+T —
   *  a marquee around its pixels, so the handles hug the art rather than the page. False (and says
   *  why) when there is nothing it could take. A reference is left to its own handles. */
  function selectLayerContent(): boolean {
    if (!selection || !layers) return false;
    if (selection.active) return true;
    const layer = layers.active;
    if (layers.activeIsGroup) return (flashStatus(GROUP_SELECTED), false);
    if (layer.ref) return false;
    if (layers.isLocked(layer)) return (flashStatus("Layer is locked"), false);
    if (layers.isHidden(layer)) return (flashStatus("Layer is hidden"), false);
    const { width, height } = layer.canvas;
    const b = alphaBounds(layer.ctx.getImageData(0, 0, width, height).data, width, height);
    if (!b) return (flashStatus("The layer is empty — nothing to transform"), false);
    const s = width / app.docWidth; // layer px per doc unit (the pixel ratio)
    const x = Math.floor(b.x / s);
    const y = Math.floor(b.y / s);
    selection.selectRect({
      x,
      y,
      w: Math.ceil((b.x + b.w) / s) - x,
      h: Math.ceil((b.y + b.h) / s) - y,
    });
    return true;
  }

  function enterFreeTransform() {
    if (!selection || !layers) return;
    // A reference shows its handles whenever it is active; say why when it can't.
    if (layers.active.ref) {
      const why = refHandlesBlock(layers.active);
      if (why) flashStatus(why);
      return;
    }
    if (!selectLayerContent() || selection.state !== "selected") return;
    const layer = layers.active;
    if (layers.isLocked(layer)) return;
    const dpr = docDpr();
    preSelectionSnapshot = layers.getSnapshot();
    floatLayer = layers.active;
    const lifted = selection.liftPixels(layer.ctx, dpr);
    if (!lifted) return;
    selection.beginTransform(lifted);
    layers.composite();
  }

  /**
   * Enter warp/mesh mode at the requested grid resolution.
   * - From 'selected', lifts pixels and goes straight to warping.
   * - From 'transforming', initializes the grid from the current matrix.
   * - From 'warping' at a different density, resamples (preserves edits via bilinear).
   */
  function enterWarp(rows: number, cols: number) {
    if (!selection || !layers) return;
    if (refTransform || layers.active.ref) {
      return flashStatus("A reference moves, scales and rotates only — Bake it to warp it");
    }
    if (!selectLayerContent()) return;
    if (selection.state === "selected") {
      const layer = layers.active;
      if (layers.isLocked(layer)) return;
      const dpr = docDpr();
      preSelectionSnapshot = layers.getSnapshot();
      floatLayer = layers.active;
      const lifted = selection.liftPixels(layer.ctx, dpr);
      if (!lifted) return;
      selection.beginTransform(lifted);
      layers.composite();
    }
    if (selection.state === "transforming") {
      selection.beginWarp(rows, cols);
    } else if (selection.state === "warping") {
      // W / M / Distort / Mesh while warping: finer carries the bends over, coarser would average
      // them away (a 5×5 bent mesh went to 2×2 on W), so it is refused once a point has moved —
      // the same rule as the mesh stepper's −.
      if (rows < selection.warpRows && !selection.warpUntouched)
        return flashStatus(
          `${rows === 2 ? "Distort" : "Mesh"} — only before you bend it: fewer points would lose the bends`,
        );
      selection.densifyWarp(rows, cols);
    }
  }

  function clearLayer() {
    if (!layers) return;
    const why = paintBlock(layers.active);
    if (why) return flashStatus(why);
    if (layers.active.ref) return flashStatus(REF_PAINT_REFUSED);
    if (outlineActive()) cancelOutline();
    const layer = layers.active;
    const before = layers.snapshotOf(layer);
    layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    pushPixelEdit(layers, layer, before);
    layers.composite();
    bumpLayerVersion();
  }

  /** Run `fn` (a save, an export, the blank-layers probe) on the document as it stands without
   *  pending edits: a lifted float drawn into its layer, as Apply would draw it, and a live Outline
   *  preview taken back out; then put the layer back. A lift leaves a hole in the layer until it is applied, and a save
   *  stored that hole: an autosave during a transform — every reference import starts as one —
   *  lost the lifted pixels if the tab closed before Enter. */
  function withPendingResolved<T>(fn: () => T): T {
    if (!layers) return fn();
    // A live Outline preview is written INTO its layer but isn't an edit until Apply: a save taken
    // meanwhile stored the hollowed layer, and Cancel (no layerVersion bump) never replaced it. So
    // saves see the layer as it was before the preview.
    if (outlineLayer && outlineBefore) {
      const layer = outlineLayer;
      const preview = layers.snapshotOf(layer);
      layer.ctx.putImageData(outlineBefore, 0, 0);
      try {
        return fn(); // (no float can be live: Outline and a float are on different tools)
      } finally {
        layer.ctx.putImageData(preview, 0, 0);
      }
    }
    if (!selection?.hasFloating) return fn();
    const layer = floatLayer ?? layers.active;
    const snap = layers.snapshotOf(layer);
    selection.renderFloatingTo(layer.ctx);
    try {
      return fn();
    } finally {
      layers.restoreTo(layer, snap);
    }
  }

  function saveImage() {
    if (!layers) return;
    const tmp = withPendingResolved(() => composeImage());
    const name = `${sanitizeFilename(app.projectName)}.png`;
    if (saveToFilesAvailable()) {
      // iPad: to the share sheet (Save to Files), as the PSD export — a download lands in
      // Downloads in the browser, and does nothing at all in the Home Screen app.
      tmp.toBlob((b) => {
        if (b) void sendToFiles(new File([b], name, { type: "image/png" }));
        else flashStatus("Couldn't export the PNG", 10000);
      }, "image/png");
      return;
    }
    const link = document.createElement("a");
    link.download = name;
    link.href = tmp.toDataURL("image/png");
    link.click();
  }

  /** The document flattened at document size, as the screen composites it. */
  function composeImage(): HTMLCanvasElement {
    const w = app.docWidth;
    const h = app.docHeight;
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    // The screen's own compositing (group visibility and opacity, blend modes), at document size.
    layers.drawTree(tmp.getContext("2d")!, w, h);
    return tmp;
  }

  function doExportPsd() {
    if (!layers) return;
    // "-export": the trimmed Spine PSD must not overwrite the project saved under the same name.
    const name = `${sanitizeFilename(app.projectName)}-export.psd`;
    if (saveToFilesAvailable()) {
      const buffer = withPendingResolved(() => psdBuffer(layers, true));
      void sendToFiles(new File([buffer], name, { type: "application/octet-stream" }));
      return;
    }
    withPendingResolved(() => exportPsd(layers, name));
  }

  // --- Save / Save as ---
  // Where the browser lets a page write to a file the user picks (Chrome and Edge on desktop), the
  // document keeps the file it was saved to or opened from: Save writes back to it, Save as picks
  // another. Elsewhere (Safari, iPad) Save downloads a copy, as it always did. The link is for the
  // session only — after a reload the first Save asks again.
  let docFile: FileSystemFileHandle | null = null;

  function doSavePsd() {
    if (!layers) return;
    // The Home Screen app can't download at all: Save goes to the share sheet there.
    if (saveToFilesAvailable() && isStandalone()) return void doSaveToFiles();
    if (!fileAccessAvailable()) {
      withPendingResolved(() => savePsd(layers, `${sanitizeFilename(app.projectName)}.psd`));
      return;
    }
    if (docFile) void writeDocTo(docFile);
    else void doSaveAs();
  }

  /** Ask for a file and save there; the document belongs to that file from now on, and takes its
   *  name. Without file access (Safari, iPad) it's a plain Save, a download. */
  async function doSaveAs() {
    if (!layers) return;
    if (!fileAccessAvailable()) return doSavePsd();
    let handle: FileSystemFileHandle | null;
    try {
      handle = await pickSaveFile(`${sanitizeFilename(app.projectName)}.psd`);
    } catch (e) {
      flashStatus(`Couldn't save — ${e instanceof Error ? e.message : String(e)}`, 10000);
      return;
    }
    if (!handle || !(await writeDocTo(handle))) return;
    docFile = handle;
    app.projectName = nameFromFile(handle.name);
  }

  /** Write the project over `handle`; whether it was written (a dismissed prompt says nothing). */
  async function writeDocTo(handle: FileSystemFileHandle): Promise<boolean> {
    if (!layers) return false;
    try {
      await writeFile(
        handle,
        withPendingResolved(() => psdBuffer(layers, false)),
      );
      flashStatus(`Saved ${handle.name}`);
      return true;
    } catch (e) {
      if (!isAbort(e)) {
        console.error(`saving "${handle.name}" failed`, e);
        flashStatus(
          `Couldn't save ${handle.name} — ${e instanceof Error ? e.message : String(e)}`,
          10000,
        );
      }
      return false;
    }
  }

  // --- Save to Files (iPad/iPhone) ---
  // A web page can only put a file where the user chooses via the share sheet: Safari has no save
  // picker, and a download always lands in Downloads as a new copy.
  let shareFileReady = $state<File | null>(null);

  async function doSaveToFiles() {
    if (!layers) return;
    const name = `${sanitizeFilename(app.projectName)}.psd`;
    const file = new File([withPendingResolved(() => psdBuffer(layers, false))], name, {
      type: "application/octet-stream",
    });
    await sendToFiles(file);
  }

  /** Hand a finished file to the share sheet (iPad/iPhone: Save to Files). Used by Save to Files
   *  and, there, by both exports and the Home Screen app's Save. */
  async function sendToFiles(file: File) {
    if (!canShareFile(file)) {
      // This browser won't share the file type: fall back to a download.
      downloadBlob(file, file.name);
      flashStatus(`Downloaded ${file.name}`);
      return;
    }
    // Try to ride the tap that started this. Building the PSD can outlast Safari's idea of a
    // "recent" tap, and then the sheet is refused — the dialog gives it a fresh one.
    const r = await shareFile(file);
    if (r.outcome === "shared") {
      flashStatus(`Sent ${file.name} to the share sheet`);
      return;
    }
    if (r.outcome === "dismissed") {
      flashStatus("Not saved — the share sheet was closed");
      return;
    }
    shareFileReady = file;
  }

  function newDocument(width: number, height: number, name: string) {
    if (!layers) return;
    app.projectName = name.trim() || "untitled";
    docFile = null; // a new document has no file until it's saved
    if (outlineActive()) cancelOutline();
    // Autosave paused over blank layers: the latest is the copy the pause protects — set it aside
    // before New drops it; the new document then autosaves as usual.
    void setAsideIfPaused()
      .then(() => clearAutosave())
      .catch((e) => console.error("clearing autosave failed", e));
    app.docWidth = width;
    app.docHeight = height;
    layers.tree.length = 0;
    layers.setDocumentSize(width, height);
    resizeCanvas();
    // White background layer
    const bg = layers.addLayer("Background");
    bg.ctx.fillStyle = "#ffffff";
    bg.ctx.fillRect(0, 0, width, height);
    layers.addLayer("Layer 1");
    history.clear(); // a new document starts with nothing to undo
    layers.composite();
    bumpLayerVersion();
    markSaved();
    fitDocumentInView();
    showNewDocDialog = false;
  }

  function resizeDocument(
    width: number,
    height: number,
    anchorX: number,
    anchorY: number,
    mode: "canvas" | "scale" = "canvas",
  ) {
    if (!layers) return;
    if (outlineActive()) cancelOutline();
    // A float and its Cancel snapshot are in the old canvas's coordinates: Apply landed off by the
    // anchor shift, Cancel wrote the old snapshot back at 0,0. Apply it first, as Sharp layers does.
    if (selection?.hasFloating) resolveFloat(true);
    app.docWidth = width;
    app.docHeight = height;
    // Scale resamples every layer to the new size; Canvas crops or extends around the anchor.
    if (mode === "scale") layers.scaleDocument(width, height);
    else layers.setDocumentSize(width, height, anchorX, anchorY);
    history.clear(); // snapshots are the old canvas size
    resizeCanvas();
    layers.composite();
    bumpLayerVersion();
    markSaved(); // a crop that empties layers is deliberate, not a blanking (the guard's baseline)
    fitDocumentInView();
    showResizeDialog = false;
  }

  /** Open a project: through the file dialog where the page can keep the file (then Save writes
   *  back to it), else the plain file input. */
  async function doOpenPsd() {
    if (!fileAccessAvailable()) {
      fileInputEl?.click();
      return;
    }
    try {
      const handle = await pickOpenFile();
      if (handle) openProjectFile(await handle.getFile(), handle);
    } catch (e) {
      flashStatus(`Couldn't open — ${e instanceof Error ? e.message : String(e)}`, 10000);
    }
  }

  function handleFileLoad() {
    const file = fileInputEl?.files?.[0];
    fileInputEl.value = "";
    if (file) openProjectFile(file, null);
  }

  /** Load a PSD as the document. `handle` is the file it came from (Chrome/Edge), which Save then
   *  writes back to; null for the file input, whose files can't be written. */
  function openProjectFile(file: File, handle: FileSystemFileHandle | null) {
    if (!layers) return;
    const reader = new FileReader();
    // A file that can't be read or parsed said nothing at all before: say what went wrong.
    const failed = (e: unknown) => {
      console.error(`opening "${file.name}" failed`, e);
      flashStatus(
        `Couldn't open ${file.name}${e instanceof Error && e.message ? ` — ${e.message}` : ""}`,
        10000,
      );
    };
    reader.onerror = () => failed(reader.error);
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      let size: { width: number; height: number };
      // `readPsd` parses the whole file before `loadPsd` touches the layers, so a damaged or
      // non-PSD file fails here with the open document unchanged.
      try {
        size = loadPsd(buffer, layers, docDpr(), bumpLayerVersion);
      } catch (e) {
        failed(e);
        return;
      }
      if (outlineActive()) cancelOutline();
      void setAsideIfPaused().catch((e) => console.error("setting the autosave aside failed", e));
      app.projectName = nameFromFile(file.name);
      docFile = handle;
      const { width, height } = size;
      history.clear(); // the stack's commands point at the layers this just replaced
      // Update document size from PSD dimensions
      app.docWidth = width;
      app.docHeight = height;
      layers.docWidth = width;
      layers.docHeight = height;
      resizeCanvas();
      layers.composite();
      bumpLayerVersion();
      markSaved();
      fitDocumentInView();
    };
    reader.readAsArrayBuffer(file);
  }

  function resetView() {
    if (!viewport) return;
    fitDocumentInView();
  }

  function fitDocumentInView() {
    if (!viewport || !canvasClipEl) return;
    viewport.resetView();
    const clipRect = canvasClipEl.getBoundingClientRect();
    const padding = 40;
    const scaleX = (clipRect.width - padding * 2) / app.docWidth;
    const scaleY = (clipRect.height - padding * 2) / app.docHeight;
    const zoom = Math.min(scaleX, scaleY, 1); // don't zoom past 100%
    viewport.zoom = zoom;
    viewport.panX = (clipRect.width - app.docWidth * zoom) / 2;
    viewport.panY = (clipRect.height - app.docHeight * zoom) / 2;
    viewport.applyTransformPublic();
    updateZoomDisplay();
  }

  /** Reset to 1:1 (100%) zoom, centered, rotation cleared. */
  function resetTo100Percent() {
    if (!viewport || !canvasClipEl) return;
    viewport.resetView();
    const clipRect = canvasClipEl.getBoundingClientRect();
    viewport.zoom = 1;
    viewport.panX = (clipRect.width - app.docWidth) / 2;
    viewport.panY = (clipRect.height - app.docHeight) / 2;
    viewport.applyTransformPublic();
    updateZoomDisplay();
  }

  function updateZoomDisplay() {
    if (!viewport) return;
    const zt = Math.round(viewport.zoom * 100) + "%";
    const deg = Math.round(viewport.rotation * (180 / Math.PI));
    app.zoomText = deg !== 0 ? `${zt} ${deg}\u00B0` : zt;
  }

  function resizeCanvas() {
    if (!canvasEl || !selectionOverlayEl || !layers) return;
    const dpr = docDpr();
    const docW = app.docWidth;
    const docH = app.docHeight;
    // Display canvas = document size (CSS transform handles zoom/pan)
    canvasEl.width = Math.round(docW * dpr);
    canvasEl.height = Math.round(docH * dpr);
    canvasEl.style.width = docW + "px";
    canvasEl.style.height = docH + "px";
    if (selection) selection.pageSize = { w: docW, h: docH }; // new selections stay on the page
    // Size the transform container to the document
    canvasContainerEl.style.width = docW + "px";
    canvasContainerEl.style.height = docH + "px";
    layers.composite();
  }

  // --- Stroke handler ---
  // --- Move tool (2026-10-02) ---
  // Moves whole layers: the rows picked in the layer panel, else the active layer, or every layer
  // in the active group. During the drag the compositor only DRAWS them offset (`moveOffset`); the
  // release shifts their pixels by whole device pixels (no resampling) and moves references by
  // their corners, one undo step for all. Not the marquee machinery, which is built around one
  // layer. Content dragged past the canvas edge is cut off at the release (undo brings it back).
  let moveGesture: {
    start: { x: number; y: number };
    layers: Layer[];
    /** References among them, with their pixels and placement from before the press: the preview
     *  re-draws them, so undo can't read "before" at the release. */
    refs: { layer: Layer; before: ImageData; refBefore: RefPlacement }[];
    dx: number;
    dy: number;
  } | null = null;
  let moveFrame = 0;

  /** What a Move drag would take now: the picked rows, else the active layer or group. */
  function moveTargets() {
    if (!layers) return { ids: [] as number[], locked: 0, hidden: 0 };
    const picks = app.layerSelection.filter((id) => layers!.findNode(id));
    return layersToMove(layers.tree, picks.length > 0 ? picks : [layers.activeId]);
  }

  /** The Move box (2026-10-02): the painted bounds of what a drag would move, in page units — the
   *  only on-canvas sign of it on iPad, which has no hover cursor. Worked out when the layers, the
   *  tool or the pick change (an effect below), and only SHIFTED while dragging. */
  let moveBoxBase: { x: number; y: number; w: number; h: number } | null = null;

  function measureMoveBox() {
    moveBoxBase = null;
    if (!layers || app.currentTool !== "move") return;
    const dpr = docDpr();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const id of moveTargets().ids) {
      const layer = layers.findLayer(id);
      if (!layer) continue;
      const { width: w, height: h } = layer.canvas;
      const b = alphaBounds(layer.ctx.getImageData(0, 0, w, h).data, w, h);
      if (!b) continue;
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    if (x0 < x1) moveBoxBase = { x: x0 / dpr, y: y0 / dpr, w: (x1 - x0) / dpr, h: (y1 - y0) / dpr };
  }

  function showMoveBox(dx = 0, dy = 0) {
    const b = moveBoxBase;
    selection?.setMoveBox(b ? { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h } : null);
  }

  $effect(() => {
    void app.layerVersion;
    void app.currentTool;
    void app.layerSelection;
    untrack(() => {
      if (!layersReady) return;
      measureMoveBox();
      showMoveBox();
    });
  });

  /** A reference's corners moved by (dx, dy). */
  const shiftedCorners = (ref: RefPlacement, dx: number, dy: number) =>
    ref.corners.map((c) => ({ x: c.x + dx, y: c.y + dy })) as Corners;

  /** Draw the drag as it stands: plain layers just drawn offset; references RE-DRAWN from their
   *  originals at the moved corners (fast) — their pixels are cut at the canvas edge, so shifting
   *  them lost whatever had been dragged off the page until the release re-drew it (2026-10-02). */
  function drawMovePreview() {
    moveFrame = 0;
    const g = moveGesture;
    if (!g || !layers) return;
    for (const r of g.refs)
      layers.renderRef(r.layer, shiftedCorners(r.refBefore, g.dx, g.dy), true);
    layers.moveOffset = {
      ids: new Set(g.layers.filter((l) => !l.ref).map((l) => l.id)),
      dx: g.dx,
      dy: g.dy,
    };
    layers.composite();
    showMoveBox(g.dx, g.dy);
  }

  function moveStroke(points: InputPoint[], done: boolean) {
    if (!layers) return;
    const p = points[points.length - 1];
    if (!moveGesture) {
      if (points.length !== 1 || done) return; // a refused press: ignore the rest of it
      const found = moveTargets();
      const left = found.locked + found.hidden;
      if (found.ids.length === 0) {
        return flashStatus(
          found.locked > 0 ? "Locked — nothing to move" : "Hidden — nothing to move",
        );
      }
      if (left > 0) {
        flashStatus(`Moving ${found.ids.length}; leaving ${left} locked or hidden`);
      }
      // A lifted selection or an Outline preview is unfinished pixels on one of them: settle first.
      if (selection?.hasFloating) resolveFloat(true);
      if (outlineActive()) cancelOutline();
      const moving = found.ids.map((id) => layers!.findLayer(id)!);
      moveGesture = {
        start: p,
        layers: moving,
        refs: moving
          .filter((l) => l.ref)
          .map((l) => ({ layer: l, before: layers!.snapshotOf(l), refBefore: l.ref! })),
        dx: 0,
        dy: 0,
      };
      return;
    }
    // Whole device pixels, so the release shifts pixels without resampling them.
    const dpr = docDpr();
    const g = moveGesture;
    g.dx = Math.round((p.x - g.start.x) * dpr) / dpr;
    g.dy = Math.round((p.y - g.start.y) * dpr) / dpr;
    if (!done) {
      if (!moveFrame) moveFrame = requestAnimationFrame(drawMovePreview);
      return;
    }
    cancelAnimationFrame(moveFrame);
    moveFrame = 0;
    moveGesture = null;
    layers.moveOffset = null;
    const { dx, dy } = g;
    if (dx === 0 && dy === 0) {
      // Put back the references the preview may have re-drawn (fast) at their own place.
      for (const r of g.refs) layers.renderRef(r.layer);
      layers.composite();
      return;
    }
    const refs = new Map(g.refs.map((r) => [r.layer, r]));
    const edits = g.layers.map((layer) => {
      const r = refs.get(layer);
      if (r) {
        layer.ref = { src: r.refBefore.src, corners: shiftedCorners(r.refBefore, dx, dy) };
        layers!.renderRef(layer);
        return { layer, before: r.before, refBefore: r.refBefore };
      }
      const before = layers!.snapshotOf(layer);
      const tmp = document.createElement("canvas");
      tmp.width = layer.canvas.width;
      tmp.height = layer.canvas.height;
      tmp.getContext("2d")!.drawImage(layer.canvas, 0, 0);
      layer.ctx.save();
      layer.ctx.resetTransform();
      layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      layer.ctx.drawImage(tmp, Math.round(dx * dpr), Math.round(dy * dpr));
      layer.ctx.restore();
      return { layer, before };
    });
    pushLayersEdit(layers, edits);
    layers.composite();
    bumpLayerVersion();
  }

  function handleStroke(rawPoints: InputPoint[], done: boolean) {
    if (rawPoints.length === 0 || !layers) return;
    // The rest of a stroke that a tool switch already committed (see setTool).
    if (dropStrokeUntilUp) {
      if (done) dropStrokeUntilUp = false;
      return;
    }
    isDrawing = !done;
    if (!done) hideBrushCursor();
    else if (done) {
      // Restore cursor after stroke ends — use last point's screen position
      // (will be updated on next mousemove anyway)
    }

    const curve = activePressureCurve();
    const points = rawPoints.map((p) => ({
      ...p,
      pressure: curve.evaluate(p.pressure),
    }));

    // Eyedropper: reads the composite, so it ignores the active layer's lock.
    // Picks on RELEASE — drag to slide the sample point out from under the pen tip.
    if (app.currentTool === "eyedropper") {
      const p = points[points.length - 1];
      const color = sampleColor(p.x, p.y);
      if (!done) {
        showEyedropperSwatch(p.x, p.y, color);
        return;
      }
      eyedropperSwatchEl.style.display = "none";
      if (color) {
        if (app.eyedropperTarget === "fill") app.fillColor = color;
        else app.brushSettings.color = color;
        setTool(toolBeforeEyedropper);
      }
      return;
    }

    if (app.currentTool === "move") {
      moveStroke(points, done);
      return;
    }

    // A reference with its handles showing: any tool's drag moves/scales it (as slop-animator).
    if (refTransform) {
      refGesture(points, done);
      canvasClipEl.style.cursor = selection.getCursor(
        selection.hitTest(points[points.length - 1].x, points[points.length - 1].y) ?? "move",
      );
      return;
    }

    // Outline is driven from the toolbar; a canvas press only (re)starts a preview when none is live
    // (entering refused on a locked or empty layer, then the artist switched layers).
    if (app.currentTool === "outline") {
      if (!outlineActive() && points.length === 1 && !done) enterOutline();
      return;
    }

    // A stroke under way keeps its layer (checked for lock/reference when it started).
    const continuing = strokeLayer !== null && (points.length > 1 || done);
    const layer = continuing ? strokeLayer! : layers.active;
    const dpr = docDpr();

    if (!continuing && app.currentTool !== "select" && app.currentTool !== "lasso") {
      const why = paintBlock(layer);
      if (why) {
        if (points.length === 1 && !done) flashStatus(why);
        return;
      }
    }
    // A reference is drawn from its original, so paint on it would be wiped by its next move:
    // brush, eraser and fill are refused until it is baked.
    if (!continuing && layer.ref && app.currentTool !== "select" && app.currentTool !== "lasso") {
      if (points.length === 1 && !done) flashStatus(refHandlesBlock(layer) || REF_PAINT_REFUSED);
      return;
    }

    // Selection tool
    if (app.currentTool === "select" || app.currentTool === "lasso") {
      const p = points[points.length - 1];

      if (points.length === 1 && !done) {
        const handle = selection.hitTest(p.x, p.y);
        if (layer.ref) {
          // A reference without handles (loading, locked or hidden) can't be selected from.
          flashStatus(refHandlesBlock(layer) || REF_PAINT_REFUSED);
          return;
        } else if (selection.state === "selected" && handle === "move" && paintBlock(layer)) {
          flashStatus(paintBlock(layer)); // nothing to lift from a group, a locked or hidden layer
        } else if (selection.state === "selected" && handle === "move") {
          // First drag inside a fresh selection: lift pixels and enter transform mode.
          preSelectionSnapshot = layers.getSnapshot();
          floatLayer = layers.active;
          const lifted = selection.liftPixels(layer.ctx, dpr);
          if (lifted) {
            selection.beginTransform(lifted);
            layers.composite();
            selectionMode = "drag";
            selection.startDrag("move", p.x, p.y);
          }
        } else if (
          (selection.state === "transforming" || selection.state === "warping") &&
          handle
        ) {
          selectionMode = "drag";
          selection.startDrag(handle, p.x, p.y);
        } else {
          // Outside any selection (or idle) → start a new one.
          if (selection.hasFloating) selection.commit();
          else if (selection.active) selection.cancel();
          selectionMode = "create";
          // From the tool, not a stored mode: a reference's handles (pasteFloat) set it to rect,
          // and a reload restored the Lasso tool without it — lasso drags made rectangles.
          selection.mode = app.currentTool === "lasso" ? "lasso" : "rect";
          selection.startCreate(p.x, p.y);
        }
      } else if (!done) {
        if (selectionMode === "create") selection.updateCreate(p.x, p.y);
        else if (selectionMode === "drag") selection.updateDrag(p.x, p.y);
      } else {
        // The pointerup sample is not a move event; skipping it left the handle or marquee edge
        // where the last move landed, short of the Pencil.
        if (selectionMode === "create") selection.updateCreate(p.x, p.y);
        else if (selectionMode === "drag") selection.updateDrag(p.x, p.y);
        if (selectionMode === "create") selection.endCreate();
        selection.endDrag();
        selectionMode = null;
      }

      canvasClipEl.style.cursor = selection.getCursor(selection.hitTest(p.x, p.y));
      return;
    }

    // Fill tool
    if (app.currentTool === "fill") {
      if (points.length === 1 && !done) {
        const before = layers.getSnapshot();
        const color = hexToRgba(app.fillColor, app.fillOpacity);
        const clipSel = selection?.state === "selected" ? selection : null;
        if (clipSel || layer.alphaLock) {
          // Run flood fill on a temp canvas (1:1 with layer's physical pixels), then composite
          // back through the selection clip and/or alpha lock.
          const tmp = document.createElement("canvas");
          tmp.width = layer.canvas.width;
          tmp.height = layer.canvas.height;
          const tmpCtx = tmp.getContext("2d", { willReadFrequently: true })!;
          tmpCtx.drawImage(layer.canvas, 0, 0);
          floodFill(tmpCtx, points[0].x * dpr, points[0].y * dpr, color, {
            ...app.fillSettings,
            gap: app.fillEnclosedGap,
            // Expand paints BEHIND existing content, which alpha lock would refuse entirely;
            // without it the fill recolours the region and source-atop keeps it to existing pixels.
            expand: layer.alphaLock ? 0 : app.fillSettings.expand,
          });
          layer.ctx.save();
          try {
            clipSel?.applyClip(layer.ctx);
            // `copy` replaces instead of blending: tmp already holds the layer's pixels, so
            // source-over would draw semi-transparent edges on top of themselves and darken them.
            layer.ctx.globalCompositeOperation = layer.alphaLock ? "source-atop" : "copy";
            // tmp has physical pixel dimensions; layer.ctx has dpr scaling, so draw
            // tmp at its CSS-pixel size to land 1:1 in physical pixels.
            layer.ctx.drawImage(tmp, 0, 0, tmp.width / dpr, tmp.height / dpr);
          } finally {
            // layer.ctx is long-lived; a leaked clip or `copy` mode would corrupt every later draw
            layer.ctx.restore();
          }
        } else {
          floodFill(layer.ctx, points[0].x * dpr, points[0].y * dpr, color, {
            ...app.fillSettings,
            gap: app.fillEnclosedGap,
          });
        }
        // Nothing landed (already this colour, or clipped away): no empty undo step
        if (sameImageData(before, layers.getSnapshot())) return;
        pushPixelEdit(layers, layer, before);
        layers.composite();
        bumpLayerVersion();
      }
      return;
    }

    // Brush stroke
    openStrokePoints = done ? null : rawPoints;
    if (done) strokeLayer = null;
    const kind = app.brushType;
    // smooth / ink / calligraphy / dry redraw the whole stroke each frame from a pre-stroke copy;
    // the stamp tips draw incrementally. A per-segment redraw would re-composite each overlap and
    // harden the antialiased edges (see the engines' own notes).
    const fullRedraw =
      kind === "smooth" || kind === "ink" || kind === "calligraphy" || kind === "dry";
    // Mouse input has no pressure: draw at the nominal width instead of the widest.
    const sizeRange = (points[0]?.hasPressure ?? true) ? app.sizeRange : 1;
    const strokeSettings = {
      ...app.brushSettings,
      alphaLock: layer.alphaLock,
      // Smooth is a distance on screen, so it averages the same hand wobble at any zoom.
      pathSmoothRadius: pathSmoothRadius(app.brushSettings.smoothing, viewport.zoom),
    };

    function drawFullStroke(
      ctx: CanvasRenderingContext2D,
      pts: InputPoint[],
      finished: boolean,
      from = 0,
      to = Infinity,
    ) {
      if (kind === "ink") drawInkStroke(ctx, pts, strokeSettings, sizeRange, from, to);
      else if (kind === "calligraphy") {
        drawCalligraphyStroke(ctx, pts, strokeSettings, sizeRange, from, to);
      } else if (kind === "dry") drawDryStroke(ctx, pts, strokeSettings, sizeRange);
      else drawStroke(ctx, pts, strokeSettings, finished, sizeRange);
    }

    /** Where this frame's draw starts: the whole stroke, or just past the frozen part. */
    const unfrozenFrom = () => (frozenTo === 0 ? 0 : frozenTo - FREEZE_OVERLAP);

    /** Bake the stroke's settled part into the pre-stroke copy, once it has grown by FREEZE_STEP
     *  points (see `frozenTo`). Settled = at least 2 × the widest nib plus 30 px of path, and 40
     *  points, behind the pen: Calligraphy's normals reach half a width back, its smoothing 2
     *  points, Ink's Pool 32 ms. */
    function freezeSettled(pts: InputPoint[]) {
      const canFreeze =
        (kind === "ink" || kind === "calligraphy") &&
        strokeSettings.opacity >= 100 &&
        !(import.meta.env.DEV && (window as unknown as { slopNoFreeze?: boolean }).slopNoFreeze);
      if (!canFreeze || !preStrokeCanvas) return;
      // Travel, not raw path length: a resting pen's jitter would "travel" the margin standing
      // still (slop-animator's review, 2026-10-02 — see `settledIndex`).
      const i = settledIndex(pts, 2 * widthRange(strokeSettings.size, sizeRange).max + 30, 40);
      if (i - frozenTo < FREEZE_STEP) return;
      const f = preStrokeCanvas.getContext("2d")!;
      f.save();
      try {
        f.setTransform(layer.ctx.getTransform());
        selection?.applyClip(f);
        drawFullStroke(f, pts, false, unfrozenFrom(), i);
      } finally {
        f.restore();
      }
      frozenTo = i;
    }

    if (points.length <= 1 && !done) {
      strokeLayer = layer;
      frozenTo = 0;
      preStrokeSnapshot = layers.getSnapshot();
      if (fullRedraw) {
        saveLayerToCanvas(layer);
      }
      resetStampState();
    }

    if (fullRedraw) {
      // Batch restore+draw+composite to once per frame — Apple Pencil fires at
      // 240Hz but screen refreshes at 60-120Hz, so most events are wasted work.
      if (done) {
        smoothPendingPoints = null;
        restoreLayerFromCanvas(layer);
        layer.ctx.save();
        selection?.applyClip(layer.ctx);
        drawFullStroke(layer.ctx, points, true, unfrozenFrom());
        layer.ctx.restore();
        layers.composite();
        if (preStrokeSnapshot) {
          pushPixelEdit(layers, layer, preStrokeSnapshot);
          preStrokeSnapshot = null;
        }
        bumpLayerVersion();
      } else {
        const alreadyScheduled = smoothPendingPoints !== null;
        smoothPendingPoints = points;
        if (alreadyScheduled) return;
        requestAnimationFrame(() => {
          const latest = smoothPendingPoints;
          smoothPendingPoints = null;
          if (!latest || !layers) return;
          freezeSettled(latest);
          restoreLayerFromCanvas(layer);
          layer.ctx.save();
          selection?.applyClip(layer.ctx);
          drawFullStroke(layer.ctx, latest, false, unfrozenFrom());
          layer.ctx.restore();
          layers.composite();
        });
      }
    } else {
      // Stamp engine: incremental, only draws new points
      layer.ctx.save();
      selection?.applyClip(layer.ctx);
      drawStampStrokeIncremental(
        layer.ctx,
        points,
        { ...strokeSettings, brushType: kind },
        sizeRange,
      );
      layer.ctx.restore();
      scheduleComposite();

      if (done) {
        layers.composite();
        if (preStrokeSnapshot) {
          pushPixelEdit(layers, layer, preStrokeSnapshot);
          preStrokeSnapshot = null;
        }
        bumpLayerVersion();
      }
    }
  }

  // --- Set tool ---
  function setTool(tool: Tool) {
    // The tool can change under an open stroke (X, a finger on the toolbar). Commit it now with the
    // settings that STARTED it — setTool swaps them below — and ignore the rest of that stroke.
    if (openStrokePoints && tool !== app.currentTool) {
      handleStroke(openStrokePoints, true);
      dropStrokeUntilUp = true;
    }
    // A floating transform/warp must resolve before switching tools (it has uncommitted
    // pixels). A plain marquee survives — brush/fill/eraser will clip to it.
    if (selection?.hasFloating && tool !== app.currentTool) {
      selection.commit();
    }
    if (tool === "eyedropper" && app.currentTool !== "eyedropper") {
      toolBeforeEyedropper = app.currentTool;
      app.eyedropperTarget = app.currentTool === "fill" ? "fill" : "brush";
    }
    // Leaving Outline cancels a live preview: entering it already rewrote the layer, so keeping
    // it would outline the drawing on a stray tap. The knobs survive, so re-entering is cheap.
    if (app.currentTool === "outline" && tool !== "outline" && outlineActive()) {
      cancelOutline(false);
    }
    if (tool === "outline" && app.currentTool !== "outline") {
      toolBeforeOutline = app.currentTool === "eyedropper" ? toolBeforeEyedropper : app.currentTool;
    }
    swapSlots(app, strokeSlots, app.currentTool, tool);
    app.currentTool = tool;
    app.brushSettings.isEraser = tool === "eraser";
    if (tool === "select") selection.mode = "rect";
    if (tool === "lasso") selection.mode = "lasso";
    updateCursor();
    debouncedSave();
    // After the switch (a floating selection has been committed above), so the snapshot holds it.
    if (tool === "outline") enterOutline();
  }

  function updateCursor() {
    if (!canvasClipEl) return;
    const isBrushTool = app.currentTool === "brush" || app.currentTool === "eraser";
    if (isBrushTool) {
      canvasClipEl.style.cursor = "none";
    } else {
      canvasClipEl.style.cursor = "crosshair";
      hideBrushCursor();
    }
  }

  // --- Keyboard shortcuts ---
  function handleKeyDown(e: KeyboardEvent) {
    if (selection) selection.shiftHeld = e.shiftKey;
    // A dialog owns the keyboard while it is open (it handles Enter/Escape itself).
    if (
      showNewDocDialog ||
      showResizeDialog ||
      showSettingsDialog ||
      shareFileReady ||
      textDialog ||
      restoreDialog
    )
      return;
    const target = e.target as HTMLElement;
    if (isTextEntry(target)) return;
    // Esc / Enter with a toolbar menu open belong to the menu (it closes on Esc): they also
    // cancelled a live transform or Outline preview behind it, which Cancel can't take back.
    if ((e.key === "Escape" || e.key === "Enter") && document.querySelector('[role="menu"]'))
      return;
    // A dropdown keeps focus after a pick; its letter keys jump between options, so only the
    // Ctrl/Cmd shortcuts get through (undo must not die because the brush type was just changed).
    if (target.tagName === "SELECT" && !e.ctrlKey && !e.metaKey) return;

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void doSaveAs();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      doSavePsd();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "o") {
      e.preventDefault();
      void doOpenPsd();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault();
      showNewDocDialog = true;
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g" && !e.shiftKey) {
      // Group the active layer or group (Photoshop's Group Layers; the panel's New group button) —
      // or the rows picked together, as the panel's button does then.
      e.preventDefault();
      if (!layers) return;
      const ids = app.layerSelection.filter((id) => layers!.findNode(id));
      // As the panel's button: the pick in Select mode (any count), or several picked rows.
      if (app.layerSelecting && ids.length === 0)
        return flashStatus("Pick the rows to group first");
      if (app.layerSelecting || ids.length > 1) {
        for (const id of topSelection(layers.tree, ids)) {
          const why = dragBlock(layers.tree, id);
          if (why) return flashStatus(why);
        }
        structuralEdit(layers, () => layers!.groupSelected(ids));
        app.layerSelection = [];
        app.layerSelecting = false;
      } else {
        structuralEdit(layers, () => layers!.groupActive());
      }
      bumpLayerVersion();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      if (selection?.state === "selected" || selection?.hasFloating) e.preventDefault();
      copySelection();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
      if (selection?.state === "selected") e.preventDefault();
      cutSelection();
      return;
    }
    // Ctrl/Cmd+V is handled by the `paste` event (it carries the system clipboard's image).
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
    if ((e.key === "Delete" || e.key === "Backspace") && selection?.state === "selected") {
      e.preventDefault();
      deleteSelection();
      return;
    }

    if (e.key === "Enter" && outlineActive()) {
      e.preventDefault();
      applyOutline();
      return;
    }
    if (e.key === "Escape" && outlineActive()) {
      e.preventDefault();
      cancelOutline();
      return;
    }
    if (e.key === "Enter" && selection?.active) {
      e.preventDefault();
      resolveFloat(true);
      return;
    }
    if (e.key === "Escape" && selection?.active) {
      e.preventDefault();
      resolveFloat(false);
      return;
    }

    // Distort/Warp: W = 4-corner distort (2×2 grid). M = mesh warp (3×3 grid).
    if ((e.key === "w" || e.key === "W") && selection?.active) {
      e.preventDefault();
      enterWarp(2, 2);
      return;
    }
    if ((e.key === "m" || e.key === "M") && selection?.active) {
      e.preventDefault();
      enterWarp(3, 3);
      return;
    }

    // ↑/↓: the row above/below becomes active (as slop-animator). A focused slider or dropdown
    // keeps its own arrow keys, and a lifted selection keeps its layer: Apply draws onto the
    // ACTIVE layer, so switching mid-transform would land it on another one.
    if (
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      !selection?.hasFloating &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      target.tagName !== "INPUT" &&
      target.tagName !== "SELECT"
    ) {
      e.preventDefault();
      const next = adjacentRow(layers.tree, layers.activeId, e.key === "ArrowUp" ? "up" : "down");
      if (next !== null) {
        app.layerSelection = []; // ↑/↓ moves the active row; a pick of several rows ends
        layers.activeId = next;
        bumpLayerVersion();
      }
      return;
    }

    if (e.key === "b") setTool("brush");
    if (e.key === "e") setTool("eraser");
    if (e.key === "s") setTool("select");
    if (e.key === "l") setTool("lasso");
    if (e.key === "v") setTool("move");
    if (e.key === "g") setTool("fill");
    if (e.key === "i") setTool("eyedropper");

    if (e.key === "r" || e.key === "R") {
      const step = (15 * Math.PI) / 180;
      viewport.rotateAroundCenter(e.shiftKey ? -step : step);
      updateZoomDisplay();
    }

    if (e.key === "[") {
      app.brushSettings.size = Math.max(1, app.brushSettings.size - 2);
      debouncedSave();
    }
    if (e.key === "]") {
      app.brushSettings.size = Math.min(80, app.brushSettings.size + 2);
      debouncedSave();
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      viewport.setZoom(viewport.zoom * 1.2);
      updateZoomDisplay();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "-") {
      e.preventDefault();
      viewport.setZoom(viewport.zoom / 1.2);
      updateZoomDisplay();
    }
    // Plain digits, matching slop-animator's `0` for fit. These were Cmd/Ctrl+0 and +1, which
    // browsers reserve for page-zoom-reset and switch-to-tab-N: they are handled ahead of the page,
    // so preventDefault could not claim them — the app command never ran and the browser did
    // something disruptive instead. No digit shortcuts existed to collide with, and this handler
    // already bails inside INPUT/SELECT.
    if (!e.ctrlKey && !e.metaKey && e.key === "0") {
      e.preventDefault();
      resetView();
    }
    if (!e.ctrlKey && !e.metaKey && e.key === "1") {
      e.preventDefault();
      resetTo100Percent();
    }

    // Hold X for temporary eraser
    if (e.key === "x" && !e.repeat && !toolBeforeEraser && app.currentTool !== "eraser") {
      toolBeforeEraser = app.currentTool;
      setTool("eraser");
    }

    // Space for pan. Its default is claimed here and on keyup: Chrome focuses a clicked button, and
    // the keyup of a Space-pan activated it again (an extra Undo, a second Flip). Text fields and
    // dropdowns never get this far (checked above), so typing a space is unaffected.
    if (e.code === "Space") e.preventDefault();
    if (e.code === "Space" && !spaceHeld) {
      spaceHeld = true;
      if (canvasClipEl) canvasClipEl.style.cursor = "grab";
      hideBrushCursor();
    }
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (selection) selection.shiftHeld = e.shiftKey;
    if (e.key === "x" && toolBeforeEraser) {
      setTool(toolBeforeEraser);
      toolBeforeEraser = null;
    }
    if (e.code === "Space") {
      // Only a Space that panned (see handleKeyDown): in a dialog it must still press its button.
      if (spaceHeld && !isTextEntry(e.target as HTMLElement)) e.preventDefault();
      spaceHeld = false;
      updateCursor();
    }
  }

  // Re-save 3s after the last document change. layerVersion covers strokes, fills, layer edits and
  // undo; the doc size covers a resize.
  $effect(() => {
    void app.layerVersion;
    void app.docWidth;
    void app.docHeight;
    if (!autosaveReady) return;
    autosaveDirty = true;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosaveWhenQuiet, 3000);
  });

  // The tab shows which project is open.
  $effect(() => {
    document.title = `${app.projectName} — slop-paint`;
  });

  // Re-save the settings (they carry the project name) when it is renamed.
  $effect(() => {
    void app.projectName;
    untrack(() => debouncedSave());
  });

  // A backgrounded tab can be killed at any moment (routinely on iPad), so don't wait out the
  // debounce. The write is async, so this shrinks the window rather than closing it.
  $effect(() => {
    const onHide = () => {
      clearTimeout(autosaveTimer);
      flushAutosave();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
      else checkBlankOnReturn();
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", checkBlankOnReturn);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", checkBlankOnReturn);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });

  // --- Init on mount ---
  $effect(() => {
    if (!canvasEl || !selectionOverlayEl || !canvasContainerEl || !canvasClipEl || !workspaceEl)
      return;

    // Use untrack to prevent reactive writes during init from creating circular dependencies.
    // The onChange callback calls bumpLayerVersion() which writes to app.layerVersion —
    // without untrack, this would trigger other effects and exceed max update depth.
    return untrack(() => init());
  });

  /** Fill every area the active layer's outlines enclose, behind the lines (inside the selection, if
   *  there is one). One undo step; says so in the status bar when nothing was filled. */
  function fillAllEnclosed() {
    if (!layers) return;
    const layer = layers.active;
    const why = paintBlock(layer);
    if (why) return flashStatus(why);
    if (layer.ref) return flashStatus(REF_PAINT_REFUSED);
    // Fill enclosed only paints EMPTY interiors, which alpha lock refuses: it could never land.
    if (layer.alphaLock)
      return flashStatus("Alpha lock is on — Fill enclosed only paints empty areas");
    // With Soft, Expand is applied when painting (`fillRegionBehind`), so its edge is feathered;
    // at Soft 0 the region comes back grown in whole pixels, as before.
    const soft = app.fillSettings.softEdge ?? 0;
    const expand = app.fillSettings.expand ?? 0;
    const { region, area } = enclosedFillRegion(layer.canvas, {
      gap: app.fillEnclosedGap,
      expand: soft > 0 ? 0 : expand,
    });
    if (area === 0) {
      return flashStatus(
        "Nothing enclosed — the outline isn't closed (raise Bridge), or it's already filled",
      );
    }
    const before = layers.getSnapshot();
    const color = hexToRgba(app.fillColor, app.fillOpacity);
    if (selection?.state === "selected") {
      // Same as the click fill: paint a temp copy, composite back through the clip.
      const dpr = docDpr();
      const tmp = document.createElement("canvas");
      tmp.width = layer.canvas.width;
      tmp.height = layer.canvas.height;
      const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
      tctx.drawImage(layer.canvas, 0, 0);
      fillRegionBehind(tctx, region, color, soft, soft > 0 ? expand : 0);
      layer.ctx.save();
      try {
        selection.applyClip(layer.ctx);
        layer.ctx.globalCompositeOperation = "copy";
        layer.ctx.drawImage(tmp, 0, 0, tmp.width / dpr, tmp.height / dpr);
      } finally {
        layer.ctx.restore();
      }
    } else {
      fillRegionBehind(layer.ctx, region, color, soft, soft > 0 ? expand : 0);
    }
    if (sameImageData(before, layers.getSnapshot())) {
      return flashStatus("Nothing filled — the enclosed areas are outside the selection");
    }
    pushPixelEdit(layers, layer, before);
    layers.composite();
    bumpLayerVersion();
  }

  // --- Outline tool (from slop-animator) ---
  // The preview is written INTO the active layer and re-derived from the snapshot on every knob
  // change, so what you see is the real compositor's output (layer and group opacity). Apply keeps
  // it as one undo step; Cancel puts the snapshot back.
  let outlineLayer: Layer | null = null;
  let outlineBefore: ImageData | null = null; // the WHOLE layer, for Cancel and the undo entry
  // Everything below works on `outlineRect` only: the ink's bounds grown by `OUTLINE_MARGIN`, the
  // furthest the band can reach, so a small drawing on a big canvas doesn't pay for the full size.
  let outlineRect: { x: number; y: number; w: number; h: number } | null = null; // device px
  let outlineSrc: ImageData | null = null; // outlineBefore cut to outlineRect
  let outlineAlpha: Uint8Array | null = null; // alpha plane of outlineSrc
  let outlineField: Float32Array | null = null; // depends on the ART only — once per entry
  let outlineDepth: Float32Array | null = null; // localDepth of the field — once per entry
  let outlineCov: Uint8ClampedArray | null = null; // coverage buffer, reused across previews
  // RGBA of outlineSrc with its colour bled outward (`bleedColor`); only its alpha changes per preview
  let outlinePreviewImg: ImageData | null = null;
  let outlineNoise: OutlineNoisePlanes | null = null; // depends on the seed only
  let outlineNoiseSeed: number | null = null;
  /** Holds the region's outline when a marquee clips the write: `putImageData` ignores clip paths,
   *  so the clipped path has to arrive by `drawImage`. */
  let outlineScratch: HTMLCanvasElement | null = null;
  let outlineRaf = 0;

  function outlineActive(): boolean {
    return outlineBefore !== null;
  }

  function enterOutline() {
    // Re-entry while a preview is live must no-op: snapshotting now would capture the PREVIEW, and
    // Cancel would then restore an outline instead of the original art.
    if (outlineActive() || !layers) return;
    const layer = layers.active;
    if (layers.activeIsGroup) return flashStatus(GROUP_SELECTED);
    if (layers.isLocked(layer)) return flashStatus("Layer is locked — nothing to outline");
    if (layer.ref) return flashStatus(REF_PAINT_REFUSED);
    if (layers.isHidden(layer)) return flashStatus("Layer is hidden — show it to outline it");
    const cw = layer.canvas.width,
      ch = layer.canvas.height;
    const before = layer.ctx.getImageData(0, 0, cw, ch);
    const ink = alphaBounds(before.data, cw, ch);
    if (!ink) return flashStatus("Nothing to outline — this layer is empty");
    const x0 = Math.max(0, ink.x - OUTLINE_MARGIN),
      y0 = Math.max(0, ink.y - OUTLINE_MARGIN);
    const x1 = Math.min(cw, ink.x + ink.w + OUTLINE_MARGIN),
      y1 = Math.min(ch, ink.y + ink.h + OUTLINE_MARGIN);
    outlineLayer = layer;
    outlineBefore = before;
    outlineRect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    outlineSrc = layer.ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    app.outlineActive = true;
    refreshOutlinePreview();
  }

  /** Coalesced to one animation frame: a slider drag fires an input per pointer event, and each
   *  preview is a pass over the whole region. */
  function scheduleOutlinePreview() {
    if (outlineRaf) return;
    outlineRaf = requestAnimationFrame(() => {
      outlineRaf = 0;
      refreshOutlinePreview();
    });
  }

  function refreshOutlinePreview() {
    const layer = outlineLayer,
      src = outlineSrc,
      r = outlineRect;
    if (!layer || !src || !r || !layers) return;
    const { w, h } = r;
    const ctx = layer.ctx;
    if (!outlineAlpha) {
      outlineAlpha = new Uint8Array(w * h);
      for (let i = 0, p = 3; i < outlineAlpha.length; i++, p += 4) outlineAlpha[i] = src.data[p];
    }
    const alpha = outlineAlpha;
    outlineField ??= signedDistanceField(alpha, w, h);
    outlineDepth ??= localDepth(outlineField, w, h);
    // Sampled at CANVAS coordinates, so the region's cut does not move the wobble.
    if (outlineNoise === null || outlineNoiseSeed !== app.outline.seed) {
      outlineNoise = buildNoisePlanes(w, h, app.outline.seed, r.x, r.y);
      outlineNoiseSeed = app.outline.seed;
    }
    outlineCov ??= new Uint8ClampedArray(w * h);
    const cov = outlineMask(
      alpha,
      w,
      h,
      { ...app.outline },
      outlineField,
      outlineNoise,
      outlineDepth,
      outlineCov,
    );
    // Only alpha changes, so coloured art keeps its colour — bled outward first, because an outward
    // wobble lands on transparent pixels whose stored RGB is black.
    outlinePreviewImg ??= new ImageData(bleedColor(src.data, w, h), w, h);
    const next = outlinePreviewImg;
    // Alpha lock: the outline may hollow the art but never put ink where there was none.
    const lock = layer.alphaLock;
    for (let i = 0, p = 3; i < cov.length; i++, p += 4)
      next.data[p] = lock ? Math.min(cov[i], alpha[i]) : cov[i];
    // A marquee clips the WRITE, not the maths: the field is built from the whole drawing, so where
    // the line meets the cut it is simply truncated — no line is drawn along the marquee itself.
    if (selection?.state === "selected") {
      const dpr = docDpr();
      ctx.putImageData(src, r.x, r.y); // outside the marquee nothing changes
      if (!outlineScratch) {
        outlineScratch = document.createElement("canvas");
        outlineScratch.width = w;
        outlineScratch.height = h;
      }
      outlineScratch.getContext("2d")!.putImageData(next, 0, 0);
      ctx.save();
      try {
        selection.applyClip(ctx); // layer.ctx carries the dpr transform applyClip expects
        // Inside the marquee the outline REPLACES the art: drawing over it would leave the solid
        // fill showing through the hollowed middle.
        ctx.clearRect(r.x / dpr, r.y / dpr, w / dpr, h / dpr);
        ctx.drawImage(outlineScratch, r.x / dpr, r.y / dpr, w / dpr, h / dpr);
      } finally {
        ctx.restore();
      }
    } else {
      ctx.putImageData(next, r.x, r.y);
    }
    layers.composite();
  }

  function applyOutline() {
    const layer = outlineLayer,
      before = outlineBefore;
    if (!layer || !before || !layers) return;
    if (outlineRaf) {
      cancelAnimationFrame(outlineRaf);
      outlineRaf = 0;
      refreshOutlinePreview(); // the pending frame's settings are the ones being applied
    }
    clearOutline();
    // A shape thinner than the line stays solid, so an outline can change nothing: no empty step.
    if (!sameImageData(before, layers.snapshotOf(layer))) {
      pushPixelEdit(layers, layer, before);
      bumpLayerVersion();
    } else {
      flashStatus("Nothing changed — the shapes are thinner than the line");
    }
    if (app.currentTool === "outline") setTool(toolBeforeOutline); // one-shot: hand the tool back
  }

  /** Put the art back. `handBack` returns to the tool Outline was entered from; setTool passes
   *  false, being mid-switch already. */
  function cancelOutline(handBack = true) {
    if (outlineLayer && outlineBefore) outlineLayer.ctx.putImageData(outlineBefore, 0, 0);
    clearOutline();
    layers?.composite();
    if (handBack && app.currentTool === "outline") setTool(toolBeforeOutline);
  }

  function clearOutline() {
    if (outlineRaf) {
      cancelAnimationFrame(outlineRaf);
      outlineRaf = 0;
    }
    outlineLayer = null;
    outlineBefore = null;
    outlineRect = null;
    outlineSrc = null;
    outlineAlpha = null;
    outlineField = null;
    outlineDepth = null;
    outlineCov = null;
    outlinePreviewImg = null;
    outlineNoise = null;
    outlineNoiseSeed = null;
    outlineScratch = null;
    app.outlineActive = false;
  }

  // A knob change re-derives the preview from the untouched snapshot, once per frame.
  $effect(() => {
    void app.outline.thickness;
    void app.outline.wobble;
    void app.outline.variation;
    void app.outline.seed;
    if (untrack(outlineActive)) scheduleOutlinePreview();
  });

  // Selecting a reference layer switches to Select (its row holds Free transform, Flip and Keep
  // proportions); selecting away hands the tool back (`ref-tool.ts`, as slop-animator). Every way
  // the active layer changes (a tap, ↑/↓, undo, an import, an opened file) lands here; the latch
  // acts on a CHANGE only, so a tool picked while on a reference stays picked.
  let lastOnRef = false;
  let toolBeforeRef: Tool | null = null;
  $effect(() => {
    void app.layerVersion;
    const onRef = layersReady && !!layers.active?.ref;
    untrack(() => {
      if (onRef === lastOnRef) return;
      lastOnRef = onRef;
      const next = refFocusChange<Tool>(onRef, app.currentTool, toolBeforeRef, "brush");
      toolBeforeRef = next.before;
      if (next.tool !== app.currentTool) setTool(next.tool);
    });
  });

  // A reference's handles follow the active layer (see syncRefHandles). Selection changes too: a
  // Select all or Esc clears the handles, and they come straight back. And the tool (2026-10-02):
  // Move hides them, as a drag there moves the whole layer — without this, switching between Move
  // and Select left them up under Move and missing under Select until the layers next changed.
  $effect(() => {
    void app.layerVersion;
    void app.selectionVersion;
    void app.currentTool;
    untrack(syncRefHandles);
  });

  // A float belongs to the layer it came from, as the Outline preview below does: selecting another
  // layer applies it THERE first — as switching tools does — instead of Apply later dropping it on
  // whichever layer is active by then (moving pixels between layers is Cut and Paste). Leaving a
  // float without Apply or Cancel applies it, because Apply can be undone and Cancel can't; only an
  // explicit Esc / ✗ / undo discards it, or its layer being deleted (nowhere left to apply it).
  $effect(() => {
    void app.layerVersion;
    untrack(() => {
      if (!selection?.hasFloating || !floatLayer || layers.activeId === floatLayer.id) return;
      if (!layers.findLayer(floatLayer.id)) return selection.cancel();
      // Said out loud, so the switch doesn't apply it silently (undo takes it back).
      const name = floatLayer.name;
      selection.commit();
      flashStatus(`Applied the transform to ${name} — undo to take it back`);
    });
  });

  // The preview belongs to the layer it started on: selecting another layer (which add, duplicate
  // and merge also do) or locking this one cancels it rather than leaving it baked in.
  $effect(() => {
    void app.layerVersion;
    untrack(() => {
      if (outlineLayer && (layers.activeId !== outlineLayer.id || layers.isLocked(outlineLayer))) {
        cancelOutline();
      }
    });
  });

  // The PAGE must never scroll — `app.css` pins `#app` so it cannot be dragged. iOS can still shift it
  // to reveal a focused text field above the on-screen keyboard (the text dialog, a layer rename, the
  // dialogs' number fields), and does not always shift it back: the app ends up pushed up with blank
  // space below. Snap it back when focus leaves a field, when the visual viewport resizes (the
  // keyboard opening or closing), and on the page's own `scroll` — Chrome for iPad scrolls it a moment
  // AFTER the first two have fired. A no-op wherever the page is already at 0 (always on desktop);
  // element scrollers (the layer list) don't fire `scroll` on window, so they're never touched.
  // Ported from slop-animator (its CLAUDE.md gotcha #15): this undoes the real page scroll, but NOT
  // Chrome for iPad's leftover shift after the keyboard, which lives in Chrome's native view out of
  // the page's reach — there Safari, or the Home Screen app, is the way out.
  $effect(() => {
    const resetPageScroll = () => {
      if (window.scrollY !== 0 || (document.scrollingElement?.scrollTop ?? 0) !== 0)
        window.scrollTo(0, 0);
    };
    const onFocusOut = () => requestAnimationFrame(resetPageScroll);
    document.addEventListener("focusout", onFocusOut);
    window.visualViewport?.addEventListener("resize", resetPageScroll);
    window.addEventListener("scroll", resetPageScroll, { passive: true });
    return () => {
      document.removeEventListener("focusout", onFocusOut);
      window.visualViewport?.removeEventListener("resize", resetPageScroll);
      window.removeEventListener("scroll", resetPageScroll);
    };
  });

  // iPad shows no tooltips, so a control's `title` goes to the status bar: on hover (desktop) and
  // on press (touch), read from the nearest ancestor that has one.
  // A `pointerover` resolving to the SAME element as the last write is ignored: pointer capture
  // (the canvas takes it on every press) fires boundary `pointerover`s that would otherwise clear a
  // message the press's own action just wrote. A `pointerdown` always writes, so pressing the
  // canvas still clears a stale hint. (From slop-animator.)
  let hintSource: Element | null = null;
  function onPointerHint(e: PointerEvent) {
    const el = (e.target as Element | null)?.closest("[title]") ?? null;
    if (e.type === "pointerover" && el === hintSource) return;
    hintSource = el;
    app.statusHint = el?.getAttribute("title") ?? "";
  }

  /** Mirror the selection. A plain selection is lifted first (same as Free transform), so the flip
   *  shows as a float with handles; lift + commit stay one undo step. */
  function flipSelection(axis: "h" | "v") {
    if (!selection) return;
    if (layers.active.ref) {
      if (!refTransform) return enterFreeTransform(); // says why there are no handles
      selection.flip(axis);
      storeRefPlacement();
      return;
    }
    if (!selectLayerContent()) return;
    if (selection.state === "selected") enterFreeTransform();
    selection.flip(axis);
  }

  function toggleKeepProportions() {
    app.keepProportions = !app.keepProportions;
    debouncedSave();
  }

  // Selection reads this at drag time; the toggle lives in app state so it persists.
  $effect(() => {
    if (selection) selection.keepProportions = app.keepProportions;
  });

  // --- Autosave (IndexedDB, one slot, the project as a PSD) ---
  // The gate stays shut until the startup restore has settled: until then `layers` holds the blank
  // startup document, and a save landing mid-restore would overwrite the user's work with it.
  let autosaveReady = false;
  let autosaveDirty = false;
  let autosaveTimer: ReturnType<typeof setTimeout>;

  // Encoding the PSD blocks the page — 0.5–0.9 s on a Mac for a 1920×1080 document at dpr 2 with five
  // layers, several times that on iPad — and pen events that arrive meanwhile are lost: the stroke
  // jumped a straight chord across the gap. The 3 s timer counts from a stroke's END, so the next
  // stroke was usually under way when it fired, about two seconds in. So the save waits while any
  // pointer is pressed and until AUTOSAVE_QUIET_MS after the last one lifts. (The hide-flush below
  // still saves at once: nobody is drawing on a hidden tab.)
  const AUTOSAVE_QUIET_MS = 1500;
  /** A pressed pointer that has sent nothing for this long is taken as lifted: an `up` that was
   *  somehow missed must not hold the autosave off for good. (A moving pen reports constantly.) */
  const POINTER_STALE_MS = 5000;
  const pointersDown = new Map<number, number>(); // id → when it last reported
  let lastPointerUp = 0;
  $effect(() => {
    const seen = (e: PointerEvent) => {
      if (e.type === "pointerdown" || pointersDown.has(e.pointerId)) {
        pointersDown.set(e.pointerId, performance.now());
      }
    };
    const up = (e: PointerEvent) => {
      pointersDown.delete(e.pointerId);
      lastPointerUp = performance.now();
    };
    window.addEventListener("pointerdown", seen, true);
    window.addEventListener("pointermove", seen, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", seen, true);
      window.removeEventListener("pointermove", seen, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  });

  /** The timed autosave: now if nobody is drawing, else as soon as they've stopped for a moment. */
  function autosaveWhenQuiet() {
    const now = performance.now();
    for (const [id, at] of pointersDown) if (now - at > POINTER_STALE_MS) pointersDown.delete(id);
    const wait =
      pointersDown.size > 0 ? AUTOSAVE_QUIET_MS : lastPointerUp + AUTOSAVE_QUIET_MS - now;
    if (wait > 0) {
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(autosaveWhenQuiet, wait);
      return;
    }
    flushAutosave();
  }

  function flushAutosave() {
    if (!autosaveReady || !autosaveDirty || !layers) return;
    // Paused over blank layers (the dialog closed without a choice): say so again at each save it
    // skips — a later status message had wiped the first notice, and work went unsaved silently.
    if (autosaveHalted) return flashStatus(AUTOSAVE_PAUSED, 0);
    const inked = inkedLayerIds();
    if (blankedSince(inked)) return haltForBlankLayers();
    autosaveDirty = false;
    let buffer: ArrayBuffer;
    try {
      buffer = withPendingResolved(() => psdBuffer(layers, false));
    } catch (e) {
      autosaveDirty = true;
      console.error("autosave encode failed", e);
      return;
    }
    inkedAtSave = inked;
    historyAtSave = app.historyVersion;
    const meta = {
      savedAt: Date.now(),
      projectName: app.projectName,
      layerCount: layers.flatLayers().length,
      inkedCount: inked.size,
    };
    void saveAutosave(buffer, meta).then(
      () => {
        clearSticky("Autosave is failing");
      },
      (e) => {
        // Keep it dirty so the next change or the hide-flush retries, and SAY so: a silent
        // failure (iPad quota, a stale tab after a deploy) lets hours of work look saved.
        autosaveDirty = true;
        console.error("autosave failed", e);
        flashStatus(
          `Autosave is failing (${e instanceof Error ? e.message : String(e)}) — use File ▸ Save so this work isn't lost.`,
          0,
        );
      },
    );
  }

  /** Restore the autosaved project, if any. Returns false when the restore failed (autosave then
   *  stays off for the session rather than overwriting the stored copy with a blank document). */
  async function restoreAutosave(): Promise<boolean> {
    try {
      const buffer = await loadAutosave();
      if (buffer) loadAutosaveBuffer(buffer);
      else markSaved();
      return true;
    } catch (e) {
      console.error("autosave restore failed", e);
      flashStatus(
        `Couldn't load your autosaved work (${e instanceof Error ? e.message : String(e)}). Autosave is off so the saved copy isn't overwritten — reload to retry, or use File ▸ Open.`,
        0,
      );
      return false;
    }
  }

  /** Make an autosaved PSD the document (startup, or File ▸ Restore autosave…). */
  function loadAutosaveBuffer(buffer: ArrayBuffer) {
    if (!layers) return;
    const dpr = docDpr();
    const { width, height } = loadPsd(buffer, layers, dpr, bumpLayerVersion);
    if (outlineActive()) cancelOutline();
    history.clear(); // restored document: nothing from this session to undo
    app.docWidth = width;
    app.docHeight = height;
    layers.docWidth = width;
    layers.docHeight = height;
    resizeCanvas();
    layers.composite();
    bumpLayerVersion();
    fitDocumentInView();
    markSaved();
  }

  // --- Blank layers guard ---
  // An iPad reclaims a backgrounded page's image memory: a 40-layer document came back with every
  // layer still listed and every one EMPTY, and the next autosave would have replaced the only
  // stored copy with that. So each autosave, and each return from the background, first checks
  // whether layers lost all their pixels with no undo step to explain it (`looksBlanked`); if so,
  // autosave pauses and the restore dialog opens.
  let inkedAtSave = new Set<number>(); // layers with pixels at the last save (or restore)
  let historyAtSave = 0; // app.historyVersion then: how many undo steps have happened since
  let autosaveHalted = false;
  const AUTOSAVE_PAUSED =
    "Your layers went blank — autosave is paused so the saved copy is kept. File ▸ Restore autosave… brings it back, or keep the blank layers there.";
  let restoreDialog = $state<{ blanked: boolean; entries: AutosaveEntry[] } | null>(null);
  let probeCanvas: HTMLCanvasElement | null = null;

  /** Ids of the layers that have any pixels. Each is drawn into a small probe (high-quality
   *  downscaling averages, so a thin line still leaves some alpha) rather than read whole. */
  function inkedLayerIds(): Set<number> {
    // A lifted float leaves a hole (a whole-layer transform, an empty layer) until Apply, and no
    // undo step exists yet: probe the document as it will be, or the guard took it for a blanking.
    return withPendingResolved(probeInked);
  }

  function probeInked(): Set<number> {
    const out = new Set<number>();
    if (!layers) return out;
    const W = 256;
    const H = Math.max(1, Math.round((W * app.docHeight) / app.docWidth));
    probeCanvas ??= document.createElement("canvas");
    probeCanvas.width = W;
    probeCanvas.height = H;
    const ctx = probeCanvas.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = "high";
    for (const layer of layers.flatLayers()) {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(layer.canvas, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i]) {
          out.add(layer.id);
          break;
        }
      }
    }
    return out;
  }

  /** The document now counts as saved in this state: the guard compares against it. */
  function markSaved() {
    inkedAtSave = inkedLayerIds();
    historyAtSave = app.historyVersion;
  }

  function blankedSince(inked: Set<number>): boolean {
    if (!layers) return false;
    const existing = new Set(layers.flatLayers().map((l) => l.id));
    return looksBlanked(inkedAtSave, inked, existing, app.historyVersion - historyAtSave);
  }

  function haltForBlankLayers() {
    autosaveHalted = true;
    clearTimeout(autosaveTimer);
    flashStatus(AUTOSAVE_PAUSED, 0);
    void openRestoreDialog(true);
  }

  // Dev builds only: blank every layer's pixels, as the iPad does, to try the guard on a desktop.
  if (import.meta.env.DEV) {
    (window as unknown as { slopBlankLayers: () => void }).slopBlankLayers = () => {
      for (const layer of layers?.flatLayers() ?? []) {
        layer.ctx.save();
        layer.ctx.resetTransform();
        layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        layer.ctx.restore();
      }
      layers?.composite();
    };
  }

  /** A new document replaces one whose autosave is paused over blank layers: set the protected
   *  latest copy aside (it stays in File ▸ Restore autosave…) and let autosave run again. On a
   *  failure it stays paused, as resuming could overwrite that copy. */
  async function setAsideIfPaused() {
    if (!autosaveHalted) return;
    await keepLatestAutosave();
    autosaveHalted = false;
    clearSticky(AUTOSAVE_PAUSED);
  }

  /** Back from the background: were the layers blanked while away? */
  function checkBlankOnReturn() {
    if (!autosaveReady || autosaveHalted || !layers) return;
    if (blankedSince(inkedLayerIds())) haltForBlankLayers();
  }

  async function openRestoreDialog(blanked: boolean) {
    try {
      restoreDialog = { blanked, entries: await listAutosaves() };
    } catch (e) {
      flashStatus(
        `Couldn't list the autosaves — ${e instanceof Error ? e.message : String(e)}`,
        10000,
      );
    }
  }

  async function restoreAutosaveEntry(entry: AutosaveEntry) {
    try {
      const buffer = await loadAutosave(entry.key);
      if (!buffer) throw new Error("that copy is gone");
      loadAutosaveBuffer(buffer);
      app.projectName = entry.projectName;
      docFile = null; // it may not match the file the document came from
      autosaveHalted = false;
      clearSticky(AUTOSAVE_PAUSED);
      restoreDialog = null;
      flashStatus(`Restored the copy saved ${new Date(entry.savedAt).toLocaleTimeString()}`, 6000);
    } catch (e) {
      flashStatus(`Couldn't restore — ${e instanceof Error ? e.message : String(e)}`, 10000);
    }
  }

  /** The user keeps the blank layers: set the last good copy aside, where autosave can't reach it,
   *  and resume. */
  async function keepBlankLayers() {
    try {
      await keepLatestAutosave();
    } catch (e) {
      flashStatus(
        `Couldn't set the saved copy aside — ${e instanceof Error ? e.message : String(e)}`,
        0,
      );
      return; // stay paused: resuming now could overwrite the only good copy
    }
    markSaved();
    autosaveHalted = false;
    clearSticky(AUTOSAVE_PAUSED);
    restoreDialog = null;
    flashStatus("Autosave is back on — the earlier copy stays in File ▸ Restore autosave…", 8000);
  }

  // Image memory the layers take, shown in the Document menu. On iPad a document over the limit
  // gets a warning: it's what a backgrounded app loses first (see the blank layers guard).
  const onAppleTouch = isAppleTouch(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
  );
  const memoryUse = $derived.by(() => {
    void app.layerVersion;
    const count = layersReady && layers ? layers.flatLayers().length : 0;
    const bytes = layerMemoryBytes(count, app.docWidth, app.docHeight, docDpr());
    return { text: formatBytes(bytes), warn: onAppleTouch && bytes > IPAD_MEMORY_WARN_BYTES };
  });
  let memoryWarned = false;
  $effect(() => {
    const { warn, text } = memoryUse;
    if (!warn) {
      memoryWarned = false;
      return;
    }
    if (memoryWarned) return;
    memoryWarned = true;
    untrack(() =>
      flashStatus(
        `This document's layers take ~${text} — an iPad may blank them while the app is in the background. Turn off Edit ▸ Settings ▸ Sharp layers, merge layers, or Save to Files often.`,
        12000,
      ),
    );
  });

  // Mirrors of imperative state, so buttons can dim when they would do nothing.
  const undoAvailable = $derived.by(() => {
    void app.historyVersion;
    return history.canUndo;
  });
  const redoAvailable = $derived.by(() => {
    void app.historyVersion;
    return history.canRedo;
  });
  const selectionActive = $derived.by(() => {
    void app.selectionVersion;
    return selection?.state === "selected" && !selection.handlesOnly;
  });
  // Pixels at the layer's physical resolution, plus where they were copied from (doc units).
  // $state.raw so Paste's dimmed state follows a copy (a copy bumps no other version).
  let pixelClipboard: { canvas: HTMLCanvasElement; rect: SelectionRect } | null = $state.raw(null);
  const clipboardFull = $derived(pixelClipboard !== null);
  // The selection's state for the Select/Lasso row (the selection object itself is not reactive).
  // A reference's handles are not a selection: nothing to apply, cancel or clip to.
  const selectionState = $derived.by(() => {
    void app.selectionVersion;
    return selection?.handlesOnly ? "idle" : (selection?.state ?? "idle");
  });
  const warpIsMesh = $derived.by(() => {
    void app.selectionVersion;
    return !!selection && (selection.warpRows !== 2 || selection.warpCols !== 2);
  });
  // Mesh density for row 2's stepper (the grid is always square). A warp drag's release bumps
  // selectionVersion, so `meshUntouched` follows the first bend.
  const meshSize = $derived.by(() => {
    void app.selectionVersion;
    return selection?.warpRows ?? MESH_MIN;
  });
  const meshUntouched = $derived.by(() => {
    void app.selectionVersion;
    return !!selection?.warpUntouched;
  });

  /** Row 2's − / +: a mesh one point finer or coarser a side (coarser only while unbent). */
  function stepMesh(dir: 1 | -1) {
    if (!selection || selectionState !== "warping" || !warpIsMesh) return;
    const why = meshStepBlock(selection.warpRows, dir, selection.warpUntouched);
    if (why) return flashStatus(`Mesh — ${why}`);
    const n = selection.warpRows + dir;
    selection.densifyWarp(n, n);
    scheduleComposite();
  }
  const refActive = $derived.by(() => {
    void app.layerVersion;
    void app.selectionVersion;
    return layersReady && !!layers.active?.ref;
  });
  // Why the lifting actions (transform, flip, cut, delete) can't act on the active layer, or "".
  const liftBlock = $derived.by(() => {
    void app.layerVersion;
    const layer = layersReady ? layers.active : null;
    if (layersReady && layers.activeIsGroup) return "a group is selected — pick a layer";
    if (layer && layers.isLocked(layer)) return "the layer is locked";
    if (layer?.ref) return "it's a reference — Bake it to edit its pixels";
    if (layer && layers.isHidden(layer)) return "the layer is hidden";
    return "";
  });
  // Copy also takes a float (as shown, transform applied); cut and delete need a plain marquee.
  const canCopy = $derived.by(() => {
    void app.selectionVersion;
    return selection?.state === "selected" || !!selection?.hasFloating;
  });

  // --- Clipboard ---

  /** The selection's pixels, scaled to document (CSS) pixels like the PNG export. */
  function toDocResolution(pixels: HTMLCanvasElement, rect: SelectionRect): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(rect.w));
    out.height = Math.max(1, Math.round(rect.h));
    out.getContext("2d")!.drawImage(pixels, 0, 0, out.width, out.height);
    return out;
  }

  /**
   * Also put the copy on the SYSTEM clipboard as a PNG, so it can be pasted into other apps.
   * Best effort: the internal copy already worked. Safari needs the ClipboardItem built
   * synchronously inside the gesture with a Blob PROMISE (from slop-animator).
   */
  function copyToSystemClipboard(canvas: HTMLCanvasElement) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return;
    const png = new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
    );
    void navigator.clipboard.write([new ClipboardItem({ "image/png": png })]).catch(() => {});
  }

  function copySelection() {
    if (selection?.hasFloating) return copyFloat();
    if (!selection || selection.state !== "selected" || !selection.rect || !layers) return;
    if (outlineActive()) cancelOutline(); // copy the art, not the preview
    const dpr = docDpr();
    const pixels = selection.copyPixels(layers.active.ctx, dpr);
    if (!pixels) return;
    pixelClipboard = { canvas: pixels, rect: { ...selection.rect } };
    copyToSystemClipboard(toDocResolution(pixels, selection.rect));
  }

  /** Copy the float as it is shown — scaled, rotated or warped — cropped to its bounds. Pasting it
   *  lands next to where it floats. */
  function copyFloat() {
    if (!selection?.hasFloating) return;
    // A mesh's inner points can be dragged past its outer ring, so bound every grid point.
    const pts =
      selection.state === "warping" ? selection.warpGrid.flat() : selection.getScreenBounds();
    if (!pts?.length) return;
    const x0 = Math.floor(Math.min(...pts.map((p) => p.x)));
    const y0 = Math.floor(Math.min(...pts.map((p) => p.y)));
    const x1 = Math.ceil(Math.max(...pts.map((p) => p.x)));
    const y1 = Math.ceil(Math.max(...pts.map((p) => p.y)));
    const rect = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
    const dpr = docDpr();
    const pixels = document.createElement("canvas");
    pixels.width = Math.round(rect.w * dpr);
    pixels.height = Math.round(rect.h * dpr);
    const ctx = pixels.getContext("2d")!;
    // Layer resolution, like a marquee copy: doc units × dpr, shifted to the crop's corner.
    ctx.setTransform(dpr, 0, 0, dpr, -rect.x * dpr, -rect.y * dpr);
    selection.renderFloatingTo(ctx);
    pixelClipboard = { canvas: pixels, rect };
    copyToSystemClipboard(toDocResolution(pixels, rect));
  }

  function selectAll() {
    if (!selection) return;
    if (selection.hasFloating) selection.commit(); // as starting a new marquee does
    selection.selectRect({ x: 0, y: 0, w: app.docWidth, h: app.docHeight });
  }

  function deselect() {
    if (selection?.state === "selected") selection.cancel();
  }

  function deleteSelection() {
    if (!selection || selection.state !== "selected" || !layers) return;
    if (outlineActive()) cancelOutline();
    const layer = layers.active;
    const why = paintBlock(layer);
    if (why) return flashStatus(why);
    if (layer.ref) return flashStatus(REF_PAINT_REFUSED);
    const dpr = docDpr();
    const before = layers.getSnapshot();
    selection.clearRegion(layer.ctx, dpr);
    selection.cancel(); // drop the marquee
    if (sameImageData(before, layers.getSnapshot())) return;
    pushPixelEdit(layers, layer, before);
    layers.composite();
    bumpLayerVersion();
  }

  function cutSelection() {
    copySelection();
    deleteSelection();
  }

  /** Float `pixels` at `rect` on the active layer with transform handles; Enter/Esc resolves it. */
  function startPasteFloat(pixels: HTMLCanvasElement, rect: SelectionRect): boolean {
    if (!selection || !layers) return false;
    const why = paintBlock(layers.active);
    if (why) return (flashStatus(why), false);
    if (layers.active.ref) {
      flashStatus("This layer is a reference — pick a drawing layer to paste onto");
      return false;
    }
    // Leaving a float applies it (undoable; Cancel isn't). setTool only does that when the tool
    // CHANGES, so on Select the float was cancelled below and a transform was lost.
    if (selection.hasFloating) selection.commit();
    setTool("select");
    if (selection.active) selection.cancel(); // a plain marquee
    preSelectionSnapshot = layers.getSnapshot(); // commit pushes it; cancel restores it (no-op)
    floatLayer = layers.active;
    selection.pasteFloat(pixels, rect);
    return true;
  }

  function pasteInternal(): boolean {
    if (!pixelClipboard) return false;
    const copy = document.createElement("canvas");
    copy.width = pixelClipboard.canvas.width;
    copy.height = pixelClipboard.canvas.height;
    copy.getContext("2d")!.drawImage(pixelClipboard.canvas, 0, 0);
    return startPasteFloat(
      copy,
      placeInternalPaste(pixelClipboard.rect, app.docWidth, app.docHeight),
    );
  }

  async function pasteImageBlob(blob: Blob) {
    const bmp = await createImageBitmap(blob);
    // Our own copy comes back from the system clipboard at document size: prefer the internal one,
    // which keeps its position and full resolution.
    if (
      pixelClipboard &&
      bmp.width === Math.round(pixelClipboard.rect.w) &&
      bmp.height === Math.round(pixelClipboard.rect.h)
    ) {
      bmp.close();
      pasteInternal();
      return;
    }
    bmp.close();
    // An image from another app is a reference (as in slop-animator), not pixels for this layer.
    await importReferenceFile(blob); // a clipboard file is always "image.png": the layer is "ref"
  }

  /** Read an image file (or a pasted one) whole — its bytes go into the PSD as the Smart Object's
   *  embedded original — and add it as a reference. */
  async function importReferenceFile(blob: Blob, fileName?: string) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ext = blob.type.startsWith("image/") ? blob.type.slice(6) : "png";
    importReference(await decodeRefSource(bytes, fileName ?? `pasted.${ext}`), fileName);
  }

  /**
   * Add a reference layer just below the active one (under the drawing that traces over it), faint
   * and tagged `[ignore]` so Spine skips it, fitted to the page (1 image px = 1 doc px, scaled down
   * only). It keeps its original, so it can be moved and scaled again later without losing quality;
   * painting on it is refused until it is baked. One undo step; it becomes the active layer, so its
   * handles show at once (see syncRefHandles) — every drag is its own step, nothing to apply.
   */
  function importReference(src: RefSource, fileName?: string) {
    if (!layers || !selection) return;
    if (outlineActive()) cancelOutline();
    if (selection.hasFloating) selection.commit(); // a float belongs to the layer it came from
    const rect = placeExternalImage(src.width, src.height, app.docWidth, app.docHeight);
    let added: Layer | null = null;
    structuralEdit(layers, () => {
      const layer = layers.addLayerBelow(referenceLayerName(fileName));
      layer.opacity = REFERENCE_OPACITY;
      layer.ref = { src, corners: cornersFromRect(rect) };
      layers.renderRef(layer);
      added = layer;
    });
    layers.composite();
    bumpLayerVersion();
    if (added) syncRefHandles();
    flashStatus("Reference added — drag to place it; pick your layer to draw again", 6000);
  }

  // --- Text references ---
  // A text layer is a reference drawn from its settings (text-layout.ts): ghost type and guide
  // lines to letter over. The dialog previews every change on the canvas; OK is one undo step
  // (adding: the new layer; editing: the placement swap, as a transform is), Cancel puts back what
  // was there.
  let textDialog = $state<{ adding: boolean; initial: TextSpec } | null>(null);
  /** The layer being previewed, what to put back on Cancel (`beforeTree` when it is new). */
  let textEdit: {
    layer: Layer;
    before: RefPlacement | undefined;
    beforeTree: StructSnapshot | null;
  } | null = null;
  /** Drops a preview whose font finished loading after a newer change (or the dialog closed). */
  let textSeq = 0;
  /** The user's font library, for the dialog's list (the library itself isn't reactive). */
  let fontList = $state<{ font: string; weight: number; italic: boolean }[]>([]);
  function refreshFontList() {
    fontList = libraryFonts().map((f) => ({ font: f.family, weight: f.weight, italic: f.italic }));
  }
  void fontLibraryReady().then(refreshFontList);

  /** Import a font file into the library; text layers that were waiting for it get it now. */
  async function addFont(file: File) {
    try {
      const f = await addFontFile(file);
      refreshFontList();
      const face = { font: f.family, weight: f.weight, italic: f.italic };
      const woke = await refreshTextFonts();
      flashStatus(
        `Added ${fontLabel(face)}` +
          (woke
            ? ` — ${woke} text layer${woke > 1 ? "s" : ""} use${woke > 1 ? "" : "s"} it again`
            : ""),
      );
      return face;
    } catch (e) {
      flashStatus(e instanceof Error ? e.message : "Couldn't add that font");
      return null;
    }
  }

  /**
   * Take a font out of this device's library. Text layers using it keep their look: they switch to
   * their current picture (`savedOnly` — their raster copy) and are marked missing, as an opened
   * file without the font is; adding it again brings them back (`refreshTextFonts`). A layer whose
   * font is also installed on the system just goes on drawing from there.
   */
  async function removeFont(key: string) {
    const face = fontList.find((f) => fontKey(f) === key);
    if (!face) return;
    try {
      await removeLibraryFont(key);
    } catch (e) {
      flashStatus(e instanceof Error ? e.message : "Couldn't remove that font");
      return;
    }
    refreshFontList();
    let kept = 0;
    if (layers) {
      const seen = new Set<RefSource>();
      for (const l of layers.flatLayers()) {
        const src = l.ref?.src;
        const text = src?.text;
        if (!src || !text || text.savedOnly || seen.has(src)) continue;
        seen.add(src);
        if ((await fontSource(text.spec)) !== "missing") continue;
        src.text = { ...text, fontMissing: true, savedOnly: true };
        kept++;
      }
      if (kept) bumpLayerVersion();
    }
    flashStatus(
      `Removed ${fontLabel(face)} from this device` +
        (kept
          ? ` — ${kept} text layer${kept > 1 ? "s" : ""} keep${kept > 1 ? "" : "s"} its look until it's added again`
          : ""),
    );
  }

  /**
   * Rebuild every text layer whose font was missing and now isn't (it was just added). Their
   * sources are updated in place — duplicates share one, and undo holds the same object — and
   * drawn from their settings again. Returns how many sources came back.
   */
  async function refreshTextFonts(): Promise<number> {
    if (!layers) return 0;
    const waiting = new Set<RefSource>();
    for (const l of layers.flatLayers()) if (l.ref?.src.text?.fontMissing) waiting.add(l.ref.src);
    let woke = 0;
    for (const src of waiting) {
      const text = src.text!;
      if ((await fontSource(text.spec)) === "missing") continue;
      const fresh = await buildTextSource(text.spec, src.id);
      src.image = fresh.image;
      src.text = fresh.text;
      src.bytes = fresh.bytes;
      src.width = fresh.width;
      src.height = fresh.height;
      woke++;
    }
    if (!woke) return 0;
    for (const l of layers.flatLayers()) if (l.ref && waiting.has(l.ref.src)) layers.renderRef(l);
    layers.composite();
    bumpLayerVersion();
    return woke;
  }

  /** A new text starts with the last one's look (session only). */
  let lastTextSpec: TextSpec = { ...DEFAULT_TEXT_SPEC };

  /** Set while the first font loads, so a second tap can't add a second layer. */
  let textAdding = false;

  /** Add an empty text layer below the active one, centred on the page, and open the dialog. */
  async function addText() {
    if (!layers || !selection || textDialog || textAdding) return;
    if (outlineActive()) cancelOutline();
    if (selection.hasFloating) selection.commit(); // a float belongs to the layer it came from
    const spec = { ...lastTextSpec, text: "" };
    textAdding = true;
    const src = await buildTextSource(spec).finally(() => (textAdding = false));
    const { layout } = src.text!;
    const beforeTree = layers.captureStructure();
    const layer = layers.addLayerBelow(textLayerName(""));
    layer.opacity = REFERENCE_OPACITY;
    const rect = placeExternalImage(layout.width, layout.height, app.docWidth, app.docHeight);
    layer.ref = { src, corners: cornersFromRect(rect) };
    layers.renderRef(layer);
    layers.composite();
    bumpLayerVersion();
    textEdit = { layer, before: undefined, beforeTree };
    textDialog = { adding: true, initial: spec };
  }

  /** Open the dialog on the active text layer. */
  function editText() {
    if (!layers || textDialog) return;
    const layer = layers.active;
    const text = layer.ref?.src.text;
    if (!text) return;
    if (layers.isLocked(layer)) return flashStatus("Layer is locked");
    if (layers.isHidden(layer)) return flashStatus("Layer is hidden");
    textEdit = { layer, before: layer.ref, beforeTree: null };
    textDialog = { adding: false, initial: text.spec };
  }

  /** Re-draw the text layer with `spec`, keeping its placement (refitted to the new box). */
  async function previewText(spec: TextSpec) {
    const edit = textEdit;
    if (!edit) return;
    const n = ++textSeq;
    const src = await buildTextSource(spec);
    if (n !== textSeq || textEdit !== edit || !edit.layer.ref?.src.text) return;
    const { corners } = edit.layer.ref;
    const was = edit.layer.ref.src.text.layout;
    const now = src.text!.layout;
    edit.layer.ref = {
      src,
      corners: refitCorners(corners, was.width, was.height, now.width, now.height, spec.align),
    };
    layers.renderRef(edit.layer);
    layers.composite();
    bumpLayerVersion();
  }

  async function confirmText(spec: TextSpec) {
    const edit = textEdit;
    if (!edit || !textDialog) return;
    textDialog = null;
    await previewText(spec); // the last change may not be showing yet
    textEdit = null;
    lastTextSpec = { ...spec, text: "" };
    const { layer } = edit;
    if (edit.beforeTree) {
      // One step that adds the finished layer: undo removes it, redo brings it back as it is now.
      layer.name = textLayerName(spec.text);
      const after = layers.captureStructure();
      layers.restoreStructure(edit.beforeTree);
      structuralEdit(layers, () => layers.restoreStructure(after));
    } else if (
      edit.before &&
      JSON.stringify(edit.before.src.text?.spec) === JSON.stringify(spec) &&
      layer.ref !== edit.before
    ) {
      // Changed and changed back: nothing to record, and the exact old placement returns.
      layer.ref = edit.before;
      layers.renderRef(layer);
    } else if (layer.ref !== edit.before) {
      pushRefEdit(layers, layer.id, edit.before, layer.ref);
    }
    layers.composite();
    bumpLayerVersion();
  }

  function cancelText() {
    const edit = textEdit;
    textDialog = null;
    textEdit = null;
    textSeq++;
    if (!edit) return;
    if (edit.beforeTree) {
      layers.restoreStructure(edit.beforeTree);
    } else {
      edit.layer.ref = edit.before;
      layers.renderRef(edit.layer);
    }
    layers.composite();
    bumpLayerVersion();
  }

  // --- Reference handles ---
  // As slop-animator: while a reference is the active layer its transform handles show, whatever
  // the tool, and any drag on the canvas moves it (corners scale, top handle rotates). It moves
  // from its ORIGINAL, re-drawn in its own layer as it goes — so it keeps its place in the layer
  // order, and scaling down and up again loses nothing. Each drag is one undo step; there is
  // nothing to apply, so picking another layer (or anything else) simply leaves it where it is.
  // The Selection only supplies the handles (`handlesOnly`: no float, nothing pending).
  let refTransform: { layer: Layer; at: RefPlacement } | null = null;
  const REF_PAINT_REFUSED = "It's a reference — Bake it (in the layer strip) to paint on it";

  /** Why the active reference shows no handles, or "" — also the reason a drag on it does nothing. */
  function refHandlesBlock(layer: Layer): string {
    if (!layer.ref) return "";
    if (!layer.ref.src.image) return "The reference is still loading — try again in a moment";
    if (layers.isLocked(layer)) return "Layer is locked";
    if (layers.isHidden(layer)) return "Layer is hidden";
    return "";
  }

  /** Show the active reference's handles, or drop them when the active layer is no longer one —
   *  called on every layer / selection change. A float from another layer is left to resolve
   *  first; a plain marquee gives way (a reference has no pixels of its own to select). */
  function syncRefHandles() {
    if (!layersReady || !selection) return;
    const layer = layers.active;
    // Not under the Move tool: there a drag moves the whole layer, reference or not.
    const want =
      !!layer.ref && !refHandlesBlock(layer) && !outlineActive() && app.currentTool !== "move";
    // Still showing, for this layer, at the placement it has (undo/redo replaces `ref`)?
    const current =
      !!refTransform &&
      refTransform.layer === layer &&
      refTransform.at === layer.ref &&
      selection.handlesOnly;
    if (current && want) return;
    if (refTransform) {
      refTransform = null;
      if (selection.handlesOnly) selection.cancel();
    }
    if (!want || selection.hasFloating || !layer.ref?.src.image) return;
    if (selection.active) selection.cancel();
    const img = layer.ref.src.image;
    refTransform = { layer, at: layer.ref };
    selection.pasteFloat(
      img,
      { x: 0, y: 0, w: img.width, h: img.height },
      matrixFromCorners(img.width, img.height, layer.ref.corners),
      true,
    );
  }

  /** A canvas gesture while a reference's handles show: a handle scales/rotates, anywhere else
   *  moves it. The layer is re-drawn as it goes; the release stores the placement (one step). */
  function refGesture(points: InputPoint[], done: boolean) {
    if (!refTransform || !selection) return;
    const p = points[points.length - 1];
    if (points.length === 1 && !done) {
      selection.startDrag(selection.hitTest(p.x, p.y) ?? "move", p.x, p.y);
      return;
    }
    selection.updateDrag(p.x, p.y);
    if (done) {
      selection.endDrag();
      storeRefPlacement();
    }
  }

  let refRenderFrame = 0;
  /** Re-draw the reference where its handles are now, once per frame while they move. */
  function scheduleRefRender() {
    if (refRenderFrame) return;
    refRenderFrame = requestAnimationFrame(() => {
      refRenderFrame = 0;
      if (!refTransform || !selection?.rect) return;
      layers.renderRef(
        refTransform.layer,
        cornersFromMatrix(selection.rect, selection.matrix),
        true,
      );
      layers.composite();
    });
  }

  /** The handles' placement becomes the reference's, drawn at full quality — one undo step, none
   *  when it didn't move (a tap). */
  function storeRefPlacement() {
    if (!refTransform || !selection?.rect) return;
    const { layer, at: before } = refTransform;
    cancelAnimationFrame(refRenderFrame);
    refRenderFrame = 0;
    const after: RefPlacement = {
      src: before.src,
      corners: cornersFromMatrix(selection.rect, selection.matrix),
    };
    const moved = after.corners.some(
      (q, i) =>
        Math.abs(q.x - before.corners[i].x) > 1e-6 || Math.abs(q.y - before.corners[i].y) > 1e-6,
    );
    if (moved) {
      layer.ref = after;
      refTransform.at = after;
      pushRefEdit(layers, layer.id, before, after);
    }
    layers.renderRef(layer);
    layers.composite();
    bumpLayerVersion();
  }

  /** Enter/Esc and ✓/✗: apply or cancel the selection. */
  function resolveFloat(apply: boolean) {
    if (!selection) return;
    if (apply) selection.commit();
    else selection.cancel();
  }

  function handleImageFile() {
    const file = imageInputEl?.files?.[0];
    imageInputEl.value = "";
    if (!file) return;
    void importReferenceFile(file, file.name).catch(() => flashStatus("Couldn't read that image"));
  }

  /** Ctrl/Cmd+V: an image on the system clipboard wins, else the internal copy. */
  function handlePaste(e: ClipboardEvent) {
    const t = e.target as HTMLElement | null;
    if (isTextEntry(t)) return;
    const file = [...(e.clipboardData?.items ?? [])]
      .find((i) => i.kind === "file" && i.type.startsWith("image/"))
      ?.getAsFile();
    e.preventDefault();
    if (file) return void pasteImageBlob(file).catch(() => pasteInternal());
    // Only an image's address (as Midjourney's on iPad, see clipboardImage): fetch it.
    const d = e.clipboardData;
    const url = d
      ? imageUrlFromClipboard(
          d.getData("text/html"),
          d.getData("text/uri-list"),
          d.getData("text/plain"),
        )
      : null;
    if (!url) return void pasteInternal();
    void fetchImage(url).then(async (blob) => {
      if (blob) return pasteImageBlob(blob);
      if (!pasteInternal())
        flashStatus(
          `Couldn't fetch the copied image from ${new URL(url).host} — save it and use File ▸ Import image…`,
          10000,
        );
    });
  }

  /** Edit menu Paste (no keyboard on iPad): read the system clipboard if allowed, else internal. */
  /**
   * The image on the system clipboard, if any. Browsers expose only the image types they can
   * convert, and a copy can carry only the image's ADDRESS (the guess for Midjourney's images in
   * Chrome on iPad, which gave no image), so an http(s) address is fetched instead — it needs the server to
   * allow cross-origin reads (Midjourney's does). `null` when there is neither.
   */
  async function clipboardImage(items: ClipboardItems): Promise<Blob | null> {
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) return item.getType(type);
    }
    for (const item of items) {
      const read = async (type: string) =>
        item.types.includes(type) ? (await item.getType(type)).text() : "";
      const url = imageUrlFromClipboard(
        await read("text/html"),
        await read("text/uri-list"),
        await read("text/plain"),
      );
      const blob = url ? await fetchImage(url) : null;
      if (blob) return blob;
    }
    return null;
  }

  /** Fetch an image from another site (it must allow cross-origin reads); `null` if it can't be
   *  read or isn't an image. */
  async function fetchImage(url: string): Promise<Blob | null> {
    try {
      const res = await fetch(url, { mode: "cors", credentials: "omit" });
      const blob = res.ok ? await res.blob() : null;
      return blob?.type.startsWith("image/") ? blob : null;
    } catch {
      return null; // blocked cross-origin, or offline
    }
  }

  /** What the clipboard holds, for a message when it holds no image: "text/plain, text/uri-list". */
  function clipboardTypes(items: ClipboardItems): string {
    const types = [...new Set(items.flatMap((i) => [...i.types]))];
    return types.length ? types.join(", ") : "nothing";
  }

  /** File ▸ Import image from clipboard: only an image on the SYSTEM clipboard, always as a
   *  reference (Edit ▸ Paste also falls back to the internal copy, so it is not obviously this).
   *  `clipboard.read()` is called before any await, so Safari still counts it as the tap's. */
  async function importReferenceFromClipboard() {
    let items: ClipboardItems;
    try {
      if (!navigator.clipboard?.read) throw new Error("unsupported");
      items = await navigator.clipboard.read();
    } catch (e) {
      // Say what the browser said: iOS refuses for several reasons (the Paste callout dismissed, no
      // tap to count the read as the user's, no support), and each has a different remedy.
      const why = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      return flashStatus(`Can't read the clipboard (${why}) — try File ▸ Import image…`, 10000);
    }
    const blob = await clipboardImage(items);
    if (blob) return importReferenceFile(blob);
    flashStatus(
      `No image the browser can read on the clipboard (it holds: ${clipboardTypes(items)}) — save the image and use File ▸ Import image…`,
      10000,
    );
  }

  async function pasteFromMenu() {
    // Why the system clipboard couldn't be read (Chrome: its Clipboard permission blocked or the
    // prompt dismissed) — said out loud, as "Nothing to paste" hid an image the user HAD copied.
    let readError = "";
    let holds = "";
    try {
      if (!navigator.clipboard?.read) throw new Error("not supported here");
      const items = await navigator.clipboard.read();
      holds = clipboardTypes(items);
      const blob = await clipboardImage(items);
      if (blob) return pasteImageBlob(blob);
    } catch (e) {
      readError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    const pasted = pasteInternal();
    if (readError) {
      const what = pasted ? "Pasted the last copy made here" : "Nothing pasted";
      flashStatus(
        `${what} — can't read the clipboard (${readError}). Allow Clipboard for this site, or use Cmd/Ctrl+V`,
        10000,
      );
    } else if (!pasted)
      flashStatus(
        `Nothing to paste — no image the browser can read on the clipboard (it holds: ${holds})`,
        10000,
      );
  }

  function init(): () => void {
    viewport = new Viewport(canvasContainerEl);
    // Accelerated on purpose. `willReadFrequently` paints every composite in
    // software — a full retina frame per stroke, which is what made brushes lag
    // on iPad. The eyedropper's one-pixel read is the rare getImageData; layer
    // canvases are the ones snapshotted, and they request the flag themselves.
    const ctx = canvasEl.getContext("2d")!;
    layers = new LayerManager(canvasEl, ctx, () => bumpLayerVersion());
    selection = new Selection(selectionOverlayEl);

    // Undo/redo repaint: commands change pixels or the tree, then this refreshes the view.
    history.onChange = () => app.historyVersion++;

    setOnHistoryApplied(() => {
      // Undo/redo can bring back or take away picked rows: start again from the active one.
      app.layerSelection = [];
      layers.composite();
      bumpLayerVersion();
    });

    // Selection callbacks
    selection.onCommit = () => {
      const layer = floatLayer ?? layers.active;
      const before = preSelectionSnapshot;
      preSelectionSnapshot = null;
      floatLayer = null;
      selection.renderFloatingTo(layer.ctx);
      // Applying an untouched lift changes nothing: no empty undo step (an import applied as it
      // landed made the next undo appear to do nothing).
      if (before && !sameImageData(before, layers.snapshotOf(layer))) {
        pushPixelEdit(layers, layer, before);
      }
      layers.composite();
      bumpLayerVersion();
    };

    selection.onCancel = () => {
      const layer = floatLayer ?? layers.active;
      floatLayer = null;
      if (preSelectionSnapshot) {
        layers.restoreTo(layer, preSelectionSnapshot);
        preSelectionSnapshot = null;
        layers.composite();
        bumpLayerVersion();
      }
    };

    selection.onChange = () => {
      if (refTransform) scheduleRefRender();
      else scheduleComposite();
    };
    // A lifted selection is drawn by the compositor, inside its layer — in its place in the stack,
    // with its opacity and blend mode (the overlay only holds the handles). A reference's handles
    // (`handlesOnly`) float nothing: the reference redraws itself.
    // Keyed on `floatLayer`, which every lift/paste sets and Apply/Cancel clear BEFORE they redraw:
    // at Apply the float is already drawn into its layer while `hasFloating` is still true, so
    // falling back to the active layer here drew it twice (a one-frame darkening on every Apply).
    layers.floatPreview = () =>
      floatLayer && selection.hasFloating && !selection.handlesOnly
        ? { layerId: floatLayer.id, render: (c) => selection.renderFloatingTo(c) }
        : null;

    selection.onStateChange = () => {
      bumpSelectionVersion();
      // Starting a transform or paste changes what the compositor draws (the float is part of it).
      scheduleComposite();
      if (outlineActive()) scheduleOutlinePreview(); // a marquee made or cleared re-clips it
    };

    // Page → overlay pixels: the pixel ratio, then the same pan/rotate/zoom the page container gets
    // as a CSS transform (origin 0 0, at the canvas area's top-left).
    selection.viewTransform = () =>
      new DOMMatrix()
        .scale(window.devicePixelRatio || 1)
        .translate(viewport.panX, viewport.panY)
        .rotate((viewport.rotation * 180) / Math.PI)
        .scale(viewport.zoom);
    // The overlay backs the whole canvas area at the pixel ratio; the area changes with the layout
    // (panel drag, panel moving beside or below the toolbar, the iPad turning).
    const sizeOverlay = () => {
      const dpr = window.devicePixelRatio || 1;
      selectionOverlayEl.width = Math.round(canvasClipEl.clientWidth * dpr);
      selectionOverlayEl.height = Math.round(canvasClipEl.clientHeight * dpr);
      if (selection.active) selection.drawOverlay();
    };
    const overlayResize = new ResizeObserver(sizeOverlay);
    overlayResize.observe(canvasClipEl);
    sizeOverlay();

    // Keep selection's hit areas at a constant screen size by feeding it the viewport zoom.
    selection.screenScale = viewport.zoom;
    viewport.onChange = () => {
      selection.screenScale = viewport.zoom;
    };

    // Set document size on layers and resize canvas
    layers.setDocumentSize(app.docWidth, app.docHeight);
    resizeCanvas();
    // White background layer
    const bg = layers.addLayer("Background");
    bg.ctx.fillStyle = "#ffffff";
    bg.ctx.fillRect(0, 0, app.docWidth, app.docHeight);
    layers.addLayer("Layer 1");
    loadSettings();
    layers.setPixelRatio(wantedDpr()); // the saved layer resolution, before anything is drawn or restored
    resizeCanvas();
    updateCursor();
    layersReady = true;
    void restoreAutosave().then((ok) => {
      autosaveReady = ok;
    });
    // After layout settles, center the document in the viewport
    requestAnimationFrame(() => {
      resizeCanvas();
      fitDocumentInView();
    });

    // Input handling
    const cleanupInput = setupInput(
      canvasClipEl, // the whole canvas area, so a gesture can start off the page
      handleStroke,
      (sx, sy) => viewport.screenToCanvas(sx, sy),
      {
        // Streamline is a brush preference. On select and lasso it made handles trail the Pencil
        // and stop short of the lift.
        streamline: () =>
          app.currentTool === "brush" || app.currentTool === "eraser" ? app.streamline / 100 : 0,
        // The stamp tips follow the points exactly, so they always get a short string
        // (STAMP_MIN_ROPE_PX): at Stream 0 a thin Pencil line came out stepped on iPad.
        minRopePx: () =>
          (app.currentTool === "brush" || app.currentTool === "eraser") &&
          (app.brushType === "pencil" ||
            app.brushType === "charcoal" ||
            app.brushType === "airbrush")
            ? STAMP_MIN_ROPE_PX
            : 0,
      },
    );

    // Touch gestures
    // A press on the canvas leaves a text field (layer rename, size box, project name): the canvas
    // blocks the browser's focus change on press (so a slider keeps focus), which also kept the
    // field focused — on iPad the keyboard stayed up and a rename stayed uncommitted.
    const blurTextEntry = () => {
      const el = document.activeElement as HTMLElement | null;
      if (el && isTextEntry(el)) el.blur();
    };
    canvasClipEl.addEventListener("pointerdown", blurTextEntry, true);
    const cleanupTouch = setupTouchGestures(canvasClipEl, viewport, {
      onUndo: undo,
      onRedo: redo,
      onToggleEraser: () => {
        if (app.currentTool === "eraser") {
          setTool(toolBeforeEraserToggle ?? "brush");
          toolBeforeEraserToggle = null;
        } else {
          toolBeforeEraserToggle = app.currentTool;
          setTool("eraser");
        }
      },
      onViewportChange: () => updateZoomDisplay(),
      isDrawing: () => isDrawing,
    });

    // Wheel zoom (needs passive: false)
    // As in slop-animator: a trackpad pinch arrives as a wheel event with ctrlKey set, so Ctrl/Cmd
    // zooms; a plain wheel — a two-finger trackpad swipe, or a mouse wheel — pans.
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) viewport.zoomAt(e.clientX, e.clientY, e.deltaY);
      else viewport.panBy(-e.deltaX, -e.deltaY); // content follows the scroll
      updateZoomDisplay();
      updateBrushCursor(e.clientX, e.clientY);
    }
    canvasClipEl.addEventListener("wheel", handleWheel, { passive: false }); // the canvas only, so the layer list scrolls

    // Canvas panning (capture phase)
    function handlePanDown(e: PointerEvent) {
      if (e.button === 1 || (e.button === 0 && spaceHeld)) {
        e.preventDefault();
        e.stopPropagation();
        viewport.startPan(e.clientX, e.clientY);
        canvasClipEl.setPointerCapture(e.pointerId);
        canvasClipEl.style.cursor = "grabbing";
        hideBrushCursor();
      }
    }
    function handlePanMove(e: PointerEvent) {
      if (viewport.panning) {
        e.preventDefault();
        e.stopPropagation();
        viewport.updatePan(e.clientX, e.clientY);
      }
    }
    function handlePanUp(e: PointerEvent) {
      if (viewport.panning) {
        e.preventDefault();
        e.stopPropagation();
        viewport.endPan();
        const isBrushTool = app.currentTool === "brush" || app.currentTool === "eraser";
        canvasClipEl.style.cursor = spaceHeld ? "grab" : isBrushTool ? "none" : "crosshair";
        if (!spaceHeld) updateBrushCursor(e.clientX, e.clientY);
      }
    }
    canvasClipEl.addEventListener("pointerdown", handlePanDown, { capture: true });
    canvasClipEl.addEventListener("pointermove", handlePanMove, { capture: true });
    canvasClipEl.addEventListener("pointerup", handlePanUp, { capture: true });

    // Brush + selection-handle hover cursor tracking
    function handleCursorMove(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      if (viewport.panning || isDrawing || spaceHeld) return; // other handlers own the cursor

      const isBrushTool = app.currentTool === "brush" || app.currentTool === "eraser";

      // Move: four arrows, or not-allowed when everything it would take is locked or hidden.
      if (app.currentTool === "move") {
        canvasClipEl.style.cursor = moveTargets().ids.length > 0 ? "move" : "not-allowed";
        hideBrushCursor();
        return;
      }

      // Non-brush tools manage their own cursor here (brush tools delegate to updateBrushCursor).
      // When a selection / transform / warp is live, hit-test for the right handle cursor.
      if (refTransform && app.currentTool !== "eyedropper") {
        // Any drag moves a reference whose handles show, so off the handles the cursor says move.
        const p = viewport.screenToCanvas(e.clientX, e.clientY);
        canvasClipEl.style.cursor = selection.getCursor(selection.hitTest(p.x, p.y) ?? "move");
        hideBrushCursor();
        return;
      }
      if (!isBrushTool) {
        if (selection?.active) {
          const p = viewport.screenToCanvas(e.clientX, e.clientY);
          const handle = selection.hitTest(p.x, p.y);
          canvasClipEl.style.cursor = handle ? selection.getCursor(handle) : "crosshair";
        } else {
          canvasClipEl.style.cursor = "crosshair";
        }
        hideBrushCursor();
        return;
      }

      updateBrushCursor(e.clientX, e.clientY);
    }
    function handleCursorLeave(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      hideBrushCursor();
    }
    canvasClipEl.addEventListener("pointermove", handleCursorMove);
    canvasClipEl.addEventListener("pointerleave", handleCursorLeave);

    return () => {
      cleanupInput();
      cleanupTouch();
      canvasClipEl.removeEventListener("pointerdown", blurTextEntry, true);
      canvasClipEl.removeEventListener("wheel", handleWheel);
      canvasClipEl.removeEventListener("pointerdown", handlePanDown, { capture: true });
      overlayResize.disconnect();
      canvasClipEl.removeEventListener("pointermove", handlePanMove, { capture: true });
      canvasClipEl.removeEventListener("pointerup", handlePanUp, { capture: true });
      canvasClipEl.removeEventListener("pointermove", handleCursorMove);
      canvasClipEl.removeEventListener("pointerleave", handleCursorLeave);
    };
  }
</script>

<ShareReadyDialog file={shareFileReady} onClose={() => (shareFileReady = null)} />
<RestoreDialog
  dialog={restoreDialog}
  onRestore={(entry) => void restoreAutosaveEntry(entry)}
  onKeep={() => void keepBlankLayers()}
  onClose={() => (restoreDialog = null)}
/>

<svelte:window
  onpointerovercapture={onPointerHint}
  onpointerdowncapture={onPointerHint}
  onblur={() => {
    if (selection) selection.shiftHeld = false;
  }}
  onkeydown={handleKeyDown}
  onkeyup={handleKeyUp}
  onpaste={handlePaste}
  bind:innerWidth={viewportW}
  onresize={() => {
    // Keep the panel inside half the viewport when the window shrinks.
    app.layerPanelWidth = clampPanelWidth(app.layerPanelWidth, window.innerWidth);
    resizeCanvas();
  }}
/>

<div class="flex h-full w-full flex-col bg-canvas-bg">
  <!-- One grid, two arrangements, so switching never re-mounts the toolbar, canvas or panel. -->
  <div
    class="workspace-layout grid min-h-0 flex-1 overflow-hidden"
    style:grid-template-columns="minmax(0, 1fr) auto"
    style:grid-template-rows="auto auto minmax(0, 1fr)"
    style:grid-template-areas={panelBeside
      ? '"row1 row1" "row2 panel" "canvas panel"'
      : '"row1 row1" "row2 row2" "canvas panel"'}
    bind:this={workspaceEl}
  >
    <!-- `contents`: the Toolbar's two rows are grid items themselves (areas row1 / row2). -->
    <div class="contents">
      {#if layersReady}
        <Toolbar
          {setTool}
          {undo}
          {redo}
          {clearLayer}
          fillEnclosed={fillAllEnclosed}
          {applyOutline}
          {cancelOutline}
          canUndo={undoAvailable}
          canRedo={redoAvailable}
          hasSelection={selectionActive}
          hasClipboard={clipboardFull}
          {canCopy}
          {selectAll}
          {deselect}
          selectionMode={selectionState}
          {warpIsMesh}
          {meshSize}
          {meshUntouched}
          {stepMesh}
          {liftBlock}
          {refActive}
          transform={enterFreeTransform}
          distort={() => enterWarp(2, 2)}
          mesh={() => enterWarp(3, 3)}
          flip={flipSelection}
          {toggleKeepProportions}
          applyFloat={() => resolveFloat(true)}
          cancelFloat={() => resolveFloat(false)}
          copy={copySelection}
          cut={cutSelection}
          paste={() => void pasteFromMenu()}
          {deleteSelection}
          {saveImage}
          exportPsd={doExportPsd}
          savePsd={doSavePsd}
          saveToFiles={saveToFilesAvailable() ? () => void doSaveToFiles() : null}
          restoreAutosave={() => void openRestoreDialog(false)}
          {memoryUse}
          saveAs={fileAccessAvailable() ? () => void doSaveAs() : null}
          openPsd={() => void doOpenPsd()}
          importReference={() => imageInputEl?.click()}
          importReferenceFromClipboard={() => void importReferenceFromClipboard()}
          newDoc={() => {
            showNewDocDialog = true;
          }}
          resizeDoc={() => {
            showResizeDialog = true;
          }}
          openSettings={() => {
            showSettingsDialog = true;
          }}
          {resetView}
          reset100={resetTo100Percent}
          onSettingsChange={debouncedSave}
        />
      {/if}
    </div>

    <div
      class="relative min-h-0 min-w-0 touch-none overflow-hidden bg-canvas-bg"
      style:grid-area="canvas"
      bind:this={canvasClipEl}
    >
      <!-- Pan/zoom box matches slop-animator: no `will-change`, checkerboard behind the canvas. -->
      <div class="absolute touch-none" bind:this={canvasContainerEl}>
        <div class="canvas-checkerboard pointer-events-none absolute inset-0"></div>
        <canvas bind:this={canvasEl} class="relative block touch-none"></canvas>
      </div>
      <!-- The selection overlay covers the whole canvas area rather than just the page, so
           transform handles past the page edge stay visible; it draws through the view transform.
           z-10: a CSS-transformed sibling can composite above a later one on WebKit. -->
      <canvas
        bind:this={selectionOverlayEl}
        class="pointer-events-none absolute inset-0 z-10 h-full w-full touch-none"
      ></canvas>
      <!-- Brush outline + centre dot, styled as slop-animator's (a dark ring with a light halo reads
           on any colour; the old `mix-blend-mode: difference` tinted it). Positioned by transform. -->
      <div
        bind:this={brushCursorEl}
        class="pointer-events-none absolute top-0 left-0 z-20 rounded-full"
        style="display: none; border: 1.5px solid rgba(0,0,0,0.7); box-shadow: 0 0 0 1.5px rgba(255,255,255,0.6);"
      ></div>
      <div
        bind:this={brushDotEl}
        class="pointer-events-none absolute top-0 left-0 z-20 size-[3px] rounded-full"
        style="display: none; background: rgba(0,0,0,0.7); box-shadow: 0 0 0 1px rgba(255,255,255,0.6);"
      ></div>
      <div
        bind:this={eyedropperSwatchEl}
        class="pointer-events-none absolute z-20 h-9 w-9 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
        style="display: none;"
      ></div>
    </div>

    {#if layersReady}
      <div class="flex min-h-0" style:grid-area="panel">
        <LayerPanel
          {layers}
          onWidthChange={debouncedSave}
          onAddText={() => void addText()}
          onEditText={editText}
          settlePending={() => {
            if (selection?.hasFloating) resolveFloat(true);
            if (outlineActive()) cancelOutline();
          }}
        />
      </div>
    {/if}
  </div>

  {#if layersReady}
    <StatusBar {selection} />
  {/if}

  <input
    type="file"
    accept="image/*"
    class="hidden"
    bind:this={imageInputEl}
    onchange={handleImageFile}
  />
  <!-- The PSD MIME types as well as the extension: iPad Safari greys out files whose type the
       `accept` list doesn't name. -->
  <input
    type="file"
    accept=".psd,image/vnd.adobe.photoshop,image/x-photoshop,application/x-photoshop,application/photoshop,application/psd,image/psd"
    class="hidden"
    bind:this={fileInputEl}
    onchange={handleFileLoad}
  />

  <SettingsDialog
    open={showSettingsDialog}
    onChange={debouncedSave}
    onLayerResolution={setLayerResolution}
    fonts={fontList.map((f) => ({ key: fontKey(f), label: fontLabel(f) }))}
    onAddFont={(file) => void addFont(file)}
    onRemoveFont={(key) => void removeFont(key)}
    onClose={() => {
      showSettingsDialog = false;
    }}
  />

  <NewDocDialog
    open={showNewDocDialog}
    onConfirm={newDocument}
    onCancel={() => {
      showNewDocDialog = false;
    }}
  />

  <TextDialog
    open={!!textDialog}
    adding={textDialog?.adding ?? false}
    initial={textDialog?.initial ?? DEFAULT_TEXT_SPEC}
    onChange={(spec) => void previewText(spec)}
    onConfirm={(spec) => void confirmText(spec)}
    onCancel={cancelText}
    fonts={fontList}
    checkFont={fontSource}
    onAddFont={addFont}
  />

  <ResizeDocDialog
    open={showResizeDialog}
    onConfirm={resizeDocument}
    onCancel={() => {
      showResizeDialog = false;
    }}
  />
</div>
