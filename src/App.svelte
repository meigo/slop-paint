<script lang="ts">
  import Toolbar from "./lib/Toolbar.svelte";
  import LayerPanel from "./lib/LayerPanel.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import NewDocDialog from "./lib/NewDocDialog.svelte";
  import ResizeDocDialog from "./lib/ResizeDocDialog.svelte";
  import { setupInput, type InputPoint } from "./input";
  import { drawStroke } from "./brush";
  import { drawInkStroke } from "./ink-brush";
  import { drawCalligraphyStroke } from "./calligraphy-brush";
  import { drawStampStrokeIncremental, resetStampState } from "./stamp-brush";
  import { LayerManager, type Layer } from "./layers";
  import {
    enclosedFillRegion,
    fillRegionBehind,
    floodFill,
    hexToRgba,
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
  import { clampPanelWidth, panelBesideToolbar } from "./panel-layout";
  import { Selection, type SelectionRect } from "./selection";
  import {
    placeExternalImage,
    placeInternalPaste,
    referenceLayerName,
    REFERENCE_OPACITY,
  } from "./paste";
  import { Viewport } from "./viewport";
  import { setupTouchGestures } from "./touch-gestures";
  import { exportPsd, savePsd, loadPsd, psdBuffer } from "./export-psd";
  import { clearAutosave, loadAutosave, saveAutosave } from "./persist/autosave";
  import { history, pushPixelEdit, setOnHistoryApplied, structuralEdit } from "./undo";
  import { canShareFile, saveToFilesAvailable, shareFile } from "./share";
  import { downloadBlob } from "./download";
  import ShareReadyDialog from "./lib/ShareReadyDialog.svelte";
  import { untrack } from "svelte";
  import {
    app,
    pressureCurves,
    activePressureCurve,
    bumpLayerVersion,
    bumpSelectionVersion,
    flashStatus,
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
  // The layer panel runs full height beside the toolbar rows when row 1 still fits next to it
  // (desktop, iPad landscape); otherwise it sits below them (portrait iPad). Re-evaluated as the
  // window turns or the panel is dragged wider.
  const panelBeside = $derived(panelBesideToolbar(viewportW, app.layerPanelWidth));
  let fileInputEl: HTMLInputElement;
  let imageInputEl: HTMLInputElement;

  // --- Core objects (imperative, not $state) ---
  let viewport = $state.raw() as Viewport;
  let layers = $state.raw() as LayerManager;
  let selection = $state.raw() as Selection;

  // --- Expose layers for child components ---
  let layersReady = $state(false);
  let showNewDocDialog = $state(false);
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
  let brushCursorVisible = false;
  let isDrawing = false;

  function updateBrushCursor(screenX: number, screenY: number) {
    if (!brushCursorEl || !canvasClipEl || !viewport) return;
    const isBrushTool = app.currentTool === "brush" || app.currentTool === "eraser";
    const shouldShow = isBrushTool && !spaceHeld && !viewport.panning && !isDrawing;
    if (!shouldShow) {
      if (brushCursorVisible) {
        brushCursorEl.style.display = "none";
        brushCursorVisible = false;
      }
      return;
    }
    // Check if pointer is over the document area
    const canvasPos = viewport.screenToCanvas(screenX, screenY);
    const overCanvas =
      canvasPos.x >= 0 &&
      canvasPos.x <= app.docWidth &&
      canvasPos.y >= 0 &&
      canvasPos.y <= app.docHeight;
    if (!overCanvas) {
      if (brushCursorVisible) {
        brushCursorEl.style.display = "none";
        brushCursorVisible = false;
      }
      return;
    }
    const rect = canvasClipEl.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;
    // Cursor matches the slider's nominal size — equal to mouse stroke width (which renders
    // at minSize = settings.size). Pen at higher pressure can exceed this up to sizeRange×.
    const diameter = app.brushSettings.size * viewport.zoom;
    if (diameter < 4) {
      if (brushCursorVisible) {
        brushCursorEl.style.display = "none";
        brushCursorVisible = false;
      }
      canvasEl.style.cursor = "crosshair";
      return;
    }
    brushCursorEl.style.display = "block";
    brushCursorEl.style.width = diameter + "px";
    brushCursorEl.style.height = diameter + "px";
    brushCursorEl.style.left = x - diameter / 2 + "px";
    brushCursorEl.style.top = y - diameter / 2 + "px";
    canvasEl.style.cursor = "none";
    brushCursorVisible = true;
  }

  function hideBrushCursor() {
    if (brushCursorEl && brushCursorVisible) {
      brushCursorEl.style.display = "none";
      brushCursorVisible = false;
    }
  }

  // --- Eyedropper ---
  let eyedropperSwatchEl: HTMLDivElement;

  /** Colour of the composited document at canvas coords, or null off-canvas / on transparency. */
  function sampleColor(x: number, y: number): string | null {
    const dpr = window.devicePixelRatio || 1;
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
  let toolBeforePencilToggle: Tool | null = null;
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
    drawBehind?: boolean;
    fillAlphaThreshold?: number;
    fillExpand?: number;
    keepProportions?: boolean;
    fillEnclosedGap?: number;
    layerPanelWidth?: number;
    nibAngle?: number;
    nibFlatness?: number;
    dwellPool?: number;
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
      sizeRange: slots.brush.sizeRange,
      streamline: slots.brush.streamline,
      eraser: slots.eraser,
      curveCp1: { ...pressureCurves.brush.cp1 },
      curveCp2: { ...pressureCurves.brush.cp2 },
      eraserCurveCp1: { ...pressureCurves.eraser.cp1 },
      eraserCurveCp2: { ...pressureCurves.eraser.cp2 },
      taper: app.brushSettings.taper,
      drawBehind: app.brushSettings.drawBehind,
      fillAlphaThreshold: app.fillSettings.alphaThreshold,
      fillExpand: app.fillSettings.expand,
      keepProportions: app.keepProportions,
      fillEnclosedGap: app.fillEnclosedGap,
      layerPanelWidth: app.layerPanelWidth,
      nibAngle: app.brushSettings.nibAngle,
      nibFlatness: app.brushSettings.nibFlatness,
      dwellPool: app.brushSettings.dwellPool,
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
      if (data.sizeRange != null) app.sizeRange = data.sizeRange;
      if (data.streamline != null) app.streamline = data.streamline;
      if (data.drawBehind != null) app.brushSettings.drawBehind = data.drawBehind;
      if (data.fillAlphaThreshold != null)
        app.fillSettings.alphaThreshold = data.fillAlphaThreshold;
      if (data.fillExpand != null) app.fillSettings.expand = data.fillExpand;
      if (typeof data.keepProportions === "boolean") app.keepProportions = data.keepProportions;
      if (data.fillEnclosedGap != null) app.fillEnclosedGap = clampGap(data.fillEnclosedGap);
      if (data.layerPanelWidth != null) {
        app.layerPanelWidth = clampPanelWidth(data.layerPanelWidth, window.innerWidth);
      }
      if (data.nibAngle != null) app.brushSettings.nibAngle = data.nibAngle;
      if (data.nibFlatness != null) app.brushSettings.nibFlatness = data.nibFlatness;
      if (data.dwellPool != null) app.brushSettings.dwellPool = data.dwellPool;
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
  function enterFreeTransform() {
    if (!selection || !layers) return;
    if (selection.state !== "selected") return;
    const layer = layers.active;
    if (layer.locked) return;
    const dpr = window.devicePixelRatio || 1;
    preSelectionSnapshot = layers.getSnapshot();
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
    if (selection.state === "selected") {
      const layer = layers.active;
      if (layer.locked) return;
      const dpr = window.devicePixelRatio || 1;
      preSelectionSnapshot = layers.getSnapshot();
      const lifted = selection.liftPixels(layer.ctx, dpr);
      if (!lifted) return;
      selection.beginTransform(lifted);
      layers.composite();
    }
    if (selection.state === "transforming") {
      selection.beginWarp(rows, cols);
    } else if (selection.state === "warping") {
      selection.densifyWarp(rows, cols);
    }
  }

  function clearLayer() {
    if (!layers) return;
    if (outlineActive()) cancelOutline();
    const layer = layers.active;
    const before = layers.snapshotOf(layer);
    layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    pushPixelEdit(layers, layer, before);
    layers.composite();
    bumpLayerVersion();
  }

  /** Run `fn` (a save or export) with a lifted float drawn into its layer, as Apply would draw it,
   *  then put the layer back. A lift leaves a hole in the layer until it is applied, and a save
   *  stored that hole: an autosave during a transform — every reference import starts as one —
   *  lost the lifted pixels if the tab closed before Enter. */
  function withFloatApplied<T>(fn: () => T): T {
    if (!selection?.hasFloating || !layers) return fn();
    const layer = layers.active;
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
    withFloatApplied(() => composeImage());
  }

  function composeImage() {
    const w = app.docWidth;
    const h = app.docHeight;
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext("2d")!;
    for (const layer of layers.flatLayers()) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity / 100;
      ctx.drawImage(layer.canvas, 0, 0, w, h);
    }
    const link = document.createElement("a");
    link.download = "drawing.png";
    link.href = tmp.toDataURL("image/png");
    link.click();
  }

  function doExportPsd() {
    if (!layers) return;
    withFloatApplied(() => exportPsd(layers));
  }

  function doSavePsd() {
    if (!layers) return;
    withFloatApplied(() => savePsd(layers));
  }

  // --- Save to Files (iPad/iPhone) ---
  // A web page can only put a file where the user chooses via the share sheet: Safari has no save
  // picker, and a download always lands in Downloads as a new copy.
  let shareFileReady = $state<File | null>(null);

  async function doSaveToFiles() {
    if (!layers) return;
    const file = new File([withFloatApplied(() => psdBuffer(layers, false))], "project.psd", {
      type: "application/octet-stream",
    });
    if (!canShareFile(file)) {
      // This browser won't share a PSD: fall back to a download.
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

  function newDocument(width: number, height: number) {
    if (!layers) return;
    if (outlineActive()) cancelOutline();
    void clearAutosave().catch((e) => console.error("clearing autosave failed", e));
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
    fitDocumentInView();
    showNewDocDialog = false;
  }

  function resizeDocument(width: number, height: number, anchorX: number, anchorY: number) {
    if (!layers) return;
    if (outlineActive()) cancelOutline();
    app.docWidth = width;
    app.docHeight = height;
    layers.setDocumentSize(width, height, anchorX, anchorY);
    history.clear(); // snapshots are the old canvas size
    resizeCanvas();
    layers.composite();
    bumpLayerVersion();
    fitDocumentInView();
    showResizeDialog = false;
  }

  function doOpenPsd() {
    fileInputEl?.click();
  }

  function handleFileLoad() {
    const file = fileInputEl?.files?.[0];
    if (!file || !layers) return;
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      if (outlineActive()) cancelOutline();
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = loadPsd(buffer, layers, dpr);
      history.clear(); // the stack's commands point at the layers this just replaced
      // Update document size from PSD dimensions
      app.docWidth = width;
      app.docHeight = height;
      layers.docWidth = width;
      layers.docHeight = height;
      resizeCanvas();
      layers.composite();
      bumpLayerVersion();
      fitDocumentInView();
    };
    reader.readAsArrayBuffer(file);
    fileInputEl.value = "";
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
    const dpr = window.devicePixelRatio || 1;
    const docW = app.docWidth;
    const docH = app.docHeight;
    // Display canvas = document size (CSS transform handles zoom/pan)
    canvasEl.width = docW * dpr;
    canvasEl.height = docH * dpr;
    canvasEl.style.width = docW + "px";
    canvasEl.style.height = docH + "px";
    selectionOverlayEl.width = docW;
    selectionOverlayEl.height = docH;
    selectionOverlayEl.style.width = docW + "px";
    selectionOverlayEl.style.height = docH + "px";
    // Size the transform container to the document
    canvasContainerEl.style.width = docW + "px";
    canvasContainerEl.style.height = docH + "px";
    layers.setDpr(dpr);
    layers.composite();
  }

  // --- Stroke handler ---
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
        app.brushSettings.color = color;
        setTool(toolBeforeEyedropper);
      }
      return;
    }

    // Outline is driven from the toolbar; a canvas press only (re)starts a preview when none is live
    // (entering refused on a locked or empty layer, then the artist switched layers).
    if (app.currentTool === "outline") {
      if (!outlineActive() && points.length === 1 && !done) enterOutline();
      return;
    }

    const layer = layers.active;
    const dpr = window.devicePixelRatio || 1;

    if (layer.locked && app.currentTool !== "select" && app.currentTool !== "lasso") return;

    // Selection tool
    if (app.currentTool === "select" || app.currentTool === "lasso") {
      const p = points[points.length - 1];

      if (points.length === 1 && !done) {
        const handle = selection.hitTest(p.x, p.y);
        if (selection.state === "selected" && handle === "move") {
          // First drag inside a fresh selection: lift pixels and enter transform mode.
          preSelectionSnapshot = layers.getSnapshot();
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

      canvasEl.style.cursor = selection.getCursor(selection.hitTest(p.x, p.y));
      return;
    }

    // Fill tool
    if (app.currentTool === "fill") {
      if (points.length === 1 && !done) {
        const before = layers.getSnapshot();
        const color = hexToRgba(app.brushSettings.color, app.brushSettings.opacity);
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
          floodFill(layer.ctx, points[0].x * dpr, points[0].y * dpr, color, app.fillSettings);
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
    const kind = app.brushType;
    // smooth / ink / calligraphy redraw the whole stroke each frame from a pre-stroke copy; the
    // stamp tips draw incrementally. A per-segment redraw would re-composite each overlap and
    // harden the antialiased edges (see the engines' own notes).
    const fullRedraw = kind === "smooth" || kind === "ink" || kind === "calligraphy";
    // Mouse input has no pressure: draw at the nominal width instead of the widest.
    const sizeRange = (points[0]?.hasPressure ?? true) ? app.sizeRange : 1;
    const strokeSettings = { ...app.brushSettings, alphaLock: layer.alphaLock };

    function drawFullStroke(ctx: CanvasRenderingContext2D, pts: InputPoint[], finished: boolean) {
      if (kind === "ink") drawInkStroke(ctx, pts, strokeSettings, sizeRange);
      else if (kind === "calligraphy") drawCalligraphyStroke(ctx, pts, strokeSettings, sizeRange);
      else drawStroke(ctx, pts, strokeSettings, finished, sizeRange);
    }

    if (points.length <= 1 && !done) {
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
        drawFullStroke(layer.ctx, points, true);
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
          const active = layers.active;
          restoreLayerFromCanvas(active);
          active.ctx.save();
          selection?.applyClip(active.ctx);
          drawFullStroke(active.ctx, latest, false);
          active.ctx.restore();
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
    if (!canvasEl) return;
    const isBrushTool = app.currentTool === "brush" || app.currentTool === "eraser";
    if (isBrushTool) {
      canvasEl.style.cursor = "none";
    } else {
      canvasEl.style.cursor = "crosshair";
      hideBrushCursor();
    }
  }

  // --- Keyboard shortcuts ---
  function handleKeyDown(e: KeyboardEvent) {
    if (selection) selection.shiftHeld = e.shiftKey;
    // A dialog owns the keyboard while it is open (it handles Enter/Escape itself).
    if (showNewDocDialog || showResizeDialog || shareFileReady) return;
    if (
      (e.target as HTMLElement).tagName === "INPUT" ||
      (e.target as HTMLElement).tagName === "SELECT"
    )
      return;

    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      doSavePsd();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "o") {
      e.preventDefault();
      doOpenPsd();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault();
      showNewDocDialog = true;
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
      selection.commit();
      return;
    }
    if (e.key === "Escape" && selection?.active) {
      e.preventDefault();
      selection.cancel();
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

    if (e.key === "b") setTool("brush");
    if (e.key === "e") setTool("eraser");
    if (e.key === "s") setTool("select");
    if (e.key === "l") setTool("lasso");
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

    // Space for pan
    if (e.code === "Space" && !spaceHeld) {
      spaceHeld = true;
      if (canvasEl) canvasEl.style.cursor = "grab";
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
    autosaveTimer = setTimeout(flushAutosave, 3000);
  });

  // A lift paints the active layer's own content on the selection overlay, so it has to fade with
  // the layer's (and its groups') opacity, or it jumps to full strength until it is committed.
  $effect(() => {
    void app.layerVersion;
    if (!layersReady || !selection) return;
    selection.contentAlpha = layers.contentAlpha(layers.activeId);
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
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
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
    if (layer.locked) return flashStatus("Layer is locked");
    // Fill enclosed only paints EMPTY interiors, which alpha lock refuses: it could never land.
    if (layer.alphaLock)
      return flashStatus("Alpha lock is on — Fill enclosed only paints empty areas");
    const { region, area } = enclosedFillRegion(layer.canvas, {
      gap: app.fillEnclosedGap,
      expand: app.fillSettings.expand,
    });
    if (area === 0) {
      return flashStatus(
        "Nothing enclosed — the outline isn't closed (raise Bridge), or it's already filled",
      );
    }
    const before = layers.getSnapshot();
    const color = hexToRgba(app.brushSettings.color, app.brushSettings.opacity);
    if (selection?.state === "selected") {
      // Same as the click fill: paint a temp copy, composite back through the clip.
      const dpr = window.devicePixelRatio || 1;
      const tmp = document.createElement("canvas");
      tmp.width = layer.canvas.width;
      tmp.height = layer.canvas.height;
      const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
      tctx.drawImage(layer.canvas, 0, 0);
      fillRegionBehind(tctx, region, color);
      layer.ctx.save();
      try {
        selection.applyClip(layer.ctx);
        layer.ctx.globalCompositeOperation = "copy";
        layer.ctx.drawImage(tmp, 0, 0, tmp.width / dpr, tmp.height / dpr);
      } finally {
        layer.ctx.restore();
      }
    } else {
      fillRegionBehind(layer.ctx, region, color);
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
    if (layer.locked) return flashStatus("Layer is locked — nothing to outline");
    if (!layer.visible) return flashStatus("Layer is hidden — show it to outline it");
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
      const dpr = window.devicePixelRatio || 1;
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

  // The preview belongs to the layer it started on: selecting another layer (which add, duplicate
  // and merge also do) or locking this one cancels it rather than leaving it baked in.
  $effect(() => {
    void app.layerVersion;
    untrack(() => {
      if (outlineLayer && (layers.activeId !== outlineLayer.id || outlineLayer.locked)) {
        cancelOutline();
      }
    });
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

  function flushAutosave() {
    if (!autosaveReady || !autosaveDirty || !layers) return;
    autosaveDirty = false;
    let buffer: ArrayBuffer;
    try {
      buffer = withFloatApplied(() => psdBuffer(layers, false));
    } catch (e) {
      autosaveDirty = true;
      console.error("autosave encode failed", e);
      return;
    }
    void saveAutosave(buffer).then(
      () => {
        if (app.statusMessage.startsWith("Autosave is failing")) flashStatus("");
      },
      (e) => {
        // Keep it dirty so the next change or the hide-flush retries, and SAY so: a silent
        // failure (iPad quota, a stale tab after a deploy) lets hours of work look saved.
        autosaveDirty = true;
        console.error("autosave failed", e);
        flashStatus(
          `Autosave is failing (${e instanceof Error ? e.message : String(e)}) — use File ▸ Save project so this work isn't lost.`,
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
      if (!buffer || !layers) return true;
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = loadPsd(buffer, layers, dpr);
      history.clear(); // restored document: nothing from this session to undo
      app.docWidth = width;
      app.docHeight = height;
      layers.docWidth = width;
      layers.docHeight = height;
      resizeCanvas();
      layers.composite();
      bumpLayerVersion();
      fitDocumentInView();
      return true;
    } catch (e) {
      console.error("autosave restore failed", e);
      flashStatus(
        `Couldn't load your autosaved work (${e instanceof Error ? e.message : String(e)}). Autosave is off so the saved copy isn't overwritten — reload to retry, or use File ▸ Open project.`,
        0,
      );
      return false;
    }
  }

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
    return selection?.state === "selected";
  });
  // Pixels at the layer's physical resolution, plus where they were copied from (doc units).
  // $state.raw so Paste's dimmed state follows a copy (a copy bumps no other version).
  let pixelClipboard: { canvas: HTMLCanvasElement; rect: SelectionRect } | null = $state.raw(null);
  const clipboardFull = $derived(pixelClipboard !== null);
  // The selection's state for the Select/Lasso row (the selection object itself is not reactive).
  const selectionState = $derived.by(() => {
    void app.selectionVersion;
    return selection?.state ?? "idle";
  });
  const warpIsMesh = $derived.by(() => {
    void app.selectionVersion;
    return !!selection && (selection.warpRows !== 2 || selection.warpCols !== 2);
  });
  // Why the lifting actions (transform, flip, cut, delete) can't act on the active layer, or "".
  const liftBlock = $derived.by(() => {
    void app.layerVersion;
    const layer = layersReady ? layers.active : null;
    if (layer?.locked) return "the layer is locked";
    if (layer && !layer.visible) return "the layer is hidden";
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
    const dpr = window.devicePixelRatio || 1;
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
    const dpr = window.devicePixelRatio || 1;
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
    if (layer.locked) return;
    const dpr = window.devicePixelRatio || 1;
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
    if (!selection || !layers || layers.active.locked) return false;
    setTool("select"); // commits any floating selection first
    if (selection.active) selection.cancel();
    preSelectionSnapshot = layers.getSnapshot(); // commit pushes it; cancel restores it (no-op)
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
    // An image from another app is a reference (as in slop-animator), not pixels for this layer.
    importReference(bmp); // a clipboard file is always "image.png", so the layer is just "ref"
    bmp.close();
  }

  /**
   * Add `img` as a reference: a new ordinary layer just below the active one (under the drawing
   * that traces over it), faint and tagged `[ignore]`
   * so Spine skips it, fitted to the page (1 image px = 1 doc px, scaled down only). One undo step.
   * Then it is lifted into Free transform to be placed — Enter keeps the move, Esc leaves it where
   * it landed.
   */
  function importReference(img: ImageBitmap, fileName?: string) {
    if (!layers || !selection) return;
    if (outlineActive()) cancelOutline();
    setTool("select"); // applies any float first
    if (selection.active) selection.cancel();
    const rect = placeExternalImage(img.width, img.height, app.docWidth, app.docHeight);
    structuralEdit(layers, () => {
      const layer = layers.addLayerBelow(referenceLayerName(fileName));
      layer.opacity = REFERENCE_OPACITY;
      layer.ctx.imageSmoothingQuality = "high";
      layer.ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h); // layer.ctx is in doc units
    });
    layers.composite();
    bumpLayerVersion();
    selection.selectRect(rect);
    enterFreeTransform();
    flashStatus("Reference added — drag to place it, Enter to apply", 4000);
  }

  function handleImageFile() {
    const file = imageInputEl?.files?.[0];
    imageInputEl.value = "";
    if (!file) return;
    void createImageBitmap(file)
      .then((bmp) => {
        importReference(bmp, file.name);
        bmp.close();
      })
      .catch(() => flashStatus("Couldn't read that image"));
  }

  /** Ctrl/Cmd+V: an image on the system clipboard wins, else the internal copy. */
  function handlePaste(e: ClipboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") return;
    const file = [...(e.clipboardData?.items ?? [])]
      .find((i) => i.kind === "file" && i.type.startsWith("image/"))
      ?.getAsFile();
    e.preventDefault();
    if (file) void pasteImageBlob(file).catch(() => pasteInternal());
    else pasteInternal();
  }

  /** Edit menu Paste (no keyboard on iPad): read the system clipboard if allowed, else internal. */
  async function pasteFromMenu() {
    try {
      const items = (await navigator.clipboard?.read?.()) ?? [];
      for (const item of items) {
        const type = item.types.find((ty) => ty.startsWith("image/"));
        if (type) {
          await pasteImageBlob(await item.getType(type));
          return;
        }
      }
    } catch {
      /* permission denied or unsupported: fall back to the internal copy */
    }
    if (!pasteInternal()) flashStatus("Nothing to paste — copy a selection or an image first");
  }

  function init(): () => void {
    viewport = new Viewport(canvasContainerEl);
    const ctx = canvasEl.getContext("2d", { willReadFrequently: true })!;
    layers = new LayerManager(canvasEl, ctx, () => bumpLayerVersion());
    selection = new Selection(selectionOverlayEl);

    // Undo/redo repaint: commands change pixels or the tree, then this refreshes the view.
    history.onChange = () => app.historyVersion++;

    setOnHistoryApplied(() => {
      layers.composite();
      bumpLayerVersion();
    });

    // Selection callbacks
    selection.onCommit = () => {
      const layer = layers.active;
      const before = preSelectionSnapshot;
      preSelectionSnapshot = null;
      selection.renderFloatingTo(layer.ctx);
      if (before) pushPixelEdit(layers, layer, before);
      layers.composite();
      bumpLayerVersion();
    };

    selection.onCancel = () => {
      if (preSelectionSnapshot) {
        layers.restoreSnapshot(preSelectionSnapshot);
        preSelectionSnapshot = null;
        layers.composite();
        bumpLayerVersion();
      }
    };

    selection.onChange = () => {
      scheduleComposite();
    };

    selection.onStateChange = () => {
      bumpSelectionVersion();
      if (outlineActive()) scheduleOutlinePreview(); // a marquee made or cleared re-clips it
    };

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
      canvasEl,
      handleStroke,
      (sx, sy) => viewport.screenToCanvas(sx, sy),
      {
        // Streamline is a brush preference. On select and lasso it made handles trail the Pencil
        // and stop short of the lift.
        streamline: () =>
          app.currentTool === "brush" || app.currentTool === "eraser" ? app.streamline / 100 : 0,
        onPencilDoubleTap: () => {
          if (app.currentTool === "eraser") {
            setTool(toolBeforePencilToggle ?? "brush");
            toolBeforePencilToggle = null;
          } else {
            toolBeforePencilToggle = app.currentTool;
            setTool("eraser");
          }
        },
      },
    );

    // Touch gestures
    const cleanupTouch = setupTouchGestures(canvasClipEl, viewport, {
      onUndo: undo,
      onRedo: redo,
      onViewportChange: () => updateZoomDisplay(),
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
        canvasEl.setPointerCapture(e.pointerId);
        canvasEl.style.cursor = "grabbing";
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
        canvasEl.style.cursor = spaceHeld ? "grab" : isBrushTool ? "none" : "crosshair";
        if (!spaceHeld) updateBrushCursor(e.clientX, e.clientY);
      }
    }
    canvasEl.addEventListener("pointerdown", handlePanDown, { capture: true });
    canvasEl.addEventListener("pointermove", handlePanMove, { capture: true });
    canvasEl.addEventListener("pointerup", handlePanUp, { capture: true });

    // Brush + selection-handle hover cursor tracking
    function handleCursorMove(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      if (viewport.panning || isDrawing || spaceHeld) return; // other handlers own the cursor

      const isBrushTool = app.currentTool === "brush" || app.currentTool === "eraser";

      // Non-brush tools manage their own cursor here (brush tools delegate to updateBrushCursor).
      // When a selection / transform / warp is live, hit-test for the right handle cursor.
      if (!isBrushTool) {
        if (selection?.active) {
          const p = viewport.screenToCanvas(e.clientX, e.clientY);
          const handle = selection.hitTest(p.x, p.y);
          canvasEl.style.cursor = handle ? selection.getCursor(handle) : "crosshair";
        } else {
          canvasEl.style.cursor = "crosshair";
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
      canvasClipEl.removeEventListener("wheel", handleWheel);
      canvasEl.removeEventListener("pointerdown", handlePanDown, { capture: true });
      canvasEl.removeEventListener("pointermove", handlePanMove, { capture: true });
      canvasEl.removeEventListener("pointerup", handlePanUp, { capture: true });
      canvasClipEl.removeEventListener("pointermove", handleCursorMove);
      canvasClipEl.removeEventListener("pointerleave", handleCursorLeave);
    };
  }
</script>

<ShareReadyDialog file={shareFileReady} onClose={() => (shareFileReady = null)} />

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
    style:grid-template-rows="auto minmax(0, 1fr)"
    style:grid-template-areas={panelBeside
      ? '"toolbar panel" "canvas panel"'
      : '"toolbar toolbar" "canvas panel"'}
    bind:this={workspaceEl}
  >
    <div class="relative z-20 flex min-w-0 flex-col" style:grid-area="toolbar">
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
          {liftBlock}
          transform={enterFreeTransform}
          distort={() => enterWarp(2, 2)}
          mesh={() => enterWarp(3, 3)}
          flip={flipSelection}
          {toggleKeepProportions}
          applyFloat={() => selection.commit()}
          cancelFloat={() => selection.cancel()}
          copy={copySelection}
          cut={cutSelection}
          paste={() => void pasteFromMenu()}
          {deleteSelection}
          {saveImage}
          exportPsd={doExportPsd}
          savePsd={doSavePsd}
          saveToFiles={saveToFilesAvailable() ? () => void doSaveToFiles() : null}
          openPsd={doOpenPsd}
          importReference={() => imageInputEl?.click()}
          newDoc={() => {
            showNewDocDialog = true;
          }}
          resizeDoc={() => {
            showResizeDialog = true;
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
      <div class="absolute touch-none will-change-transform" bind:this={canvasContainerEl}>
        <canvas bind:this={canvasEl} class="canvas-checkerboard block touch-none"></canvas>
        <canvas
          bind:this={selectionOverlayEl}
          class="pointer-events-none absolute inset-0 touch-none"
        ></canvas>
      </div>
      <div
        bind:this={brushCursorEl}
        class="pointer-events-none absolute rounded-full border"
        style="display: none; border-color: rgba(0,0,0,0.5); box-shadow: 0 0 0 1px rgba(255,255,255,0.5); mix-blend-mode: difference;"
      ></div>
      <div
        bind:this={eyedropperSwatchEl}
        class="pointer-events-none absolute h-9 w-9 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
        style="display: none;"
      ></div>
    </div>

    {#if layersReady}
      <div class="flex min-h-0" style:grid-area="panel">
        <LayerPanel {layers} onWidthChange={debouncedSave} />
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
  <input
    type="file"
    accept=".psd"
    class="hidden"
    bind:this={fileInputEl}
    onchange={handleFileLoad}
  />

  <NewDocDialog
    open={showNewDocDialog}
    onConfirm={newDocument}
    onCancel={() => {
      showNewDocDialog = false;
    }}
  />

  <ResizeDocDialog
    open={showResizeDialog}
    onConfirm={resizeDocument}
    onCancel={() => {
      showResizeDialog = false;
    }}
  />
</div>
