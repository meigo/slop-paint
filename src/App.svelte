<script lang="ts">
  import Toolbar from "./lib/Toolbar.svelte";
  import LayerPanel from "./lib/LayerPanel.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import SelectionActions from "./lib/SelectionActions.svelte";
  import NewDocDialog from "./lib/NewDocDialog.svelte";
  import ResizeDocDialog from "./lib/ResizeDocDialog.svelte";
  import { setupInput, type InputPoint } from "./input";
  import { drawStroke } from "./brush";
  import { drawStampStrokeIncremental, resetStampState } from "./stamp-brush";
  import { LayerManager } from "./layers";
  import {
    enclosedFillRegion,
    fillRegionBehind,
    floodFill,
    hexToRgba,
    rgbToHex,
    sameImageData,
  } from "./fill";
  import { clampGap } from "./fill-holes";
  import { Selection, type SelectionRect } from "./selection";
  import { placeExternalImage, placeInternalPaste } from "./paste";
  import { Viewport } from "./viewport";
  import { setupTouchGestures } from "./touch-gestures";
  import { exportPsd, savePsd, loadPsd } from "./export-psd";
  import { untrack } from "svelte";
  import {
    app,
    pressureCurve,
    bumpLayerVersion,
    bumpSelectionVersion,
    flashStatus,
    type Tool,
  } from "./appState.svelte.js";
  import type { BrushType } from "./brush-textures";
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
  let fileInputEl: HTMLInputElement;

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
    drawBehind?: boolean;
    fillAlphaThreshold?: number;
    fillExpand?: number;
    keepProportions?: boolean;
    fillEnclosedGap?: number;
    /** Eraser's own stroke settings; the top-level size/opacity/... fields are the brush's. */
    eraser?: StrokeSlot;
  }

  function saveSettings() {
    const slots = allSlots(app, strokeSlots, app.currentTool);
    const data: SavedSettings = {
      // The eyedropper is transient; reopen on the tool it will return to.
      tool: app.currentTool === "eyedropper" ? toolBeforeEyedropper : app.currentTool,
      brushType: slots.brush.brushType,
      size: slots.brush.size,
      opacity: slots.brush.opacity,
      smoothing: slots.brush.smoothing,
      color: app.brushSettings.color,
      sizeRange: slots.brush.sizeRange,
      streamline: slots.brush.streamline,
      eraser: slots.eraser,
      curveCp1: { ...pressureCurve.cp1 },
      curveCp2: { ...pressureCurve.cp2 },
      drawBehind: app.brushSettings.drawBehind,
      fillAlphaThreshold: app.fillSettings.alphaThreshold,
      fillExpand: app.fillSettings.expand,
      keepProportions: app.keepProportions,
      fillEnclosedGap: app.fillEnclosedGap,
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
      if (data.brushType) app.brushType = data.brushType as BrushType;
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
      if (data.curveCp1 && data.curveCp2) {
        pressureCurve.cp1 = data.curveCp1;
        pressureCurve.cp2 = data.curveCp2;
        pressureCurve.buildLUT();
      }
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
    if (selection?.hasFloating) {
      selection.cancel();
      return;
    }
    const layer = layers.active;
    const current = layers.getSnapshot();
    const prev = layer.history.undo(current);
    if (prev) {
      layers.restoreSnapshot(prev);
      layers.composite();
      bumpLayerVersion();
    }
  }

  function redo() {
    if (!layers) return;
    if (selection?.hasFloating) {
      selection.cancel();
      return;
    }
    const layer = layers.active;
    const current = layers.getSnapshot();
    const next = layer.history.redo(current);
    if (next) {
      layers.restoreSnapshot(next);
      layers.composite();
      bumpLayerVersion();
    }
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
    const layer = layers.active;
    layer.history.push(layers.getSnapshot());
    layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    layers.composite();
    bumpLayerVersion();
  }

  function saveImage() {
    if (!layers) return;
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
    exportPsd(layers);
  }

  function doSavePsd() {
    if (!layers) return;
    savePsd(layers);
  }

  function newDocument(width: number, height: number) {
    if (!layers) return;
    app.docWidth = width;
    app.docHeight = height;
    layers.tree.length = 0;
    layers.setDocumentSize(width, height);
    resizeCanvas();
    // White background layer
    const bg = layers.addLayer("Background");
    bg.ctx.fillStyle = "#ffffff";
    bg.ctx.fillRect(0, 0, width, height);
    bg.history.push(bg.ctx.getImageData(0, 0, bg.canvas.width, bg.canvas.height));
    layers.addLayer("Layer 1");
    layers.composite();
    bumpLayerVersion();
    fitDocumentInView();
    showNewDocDialog = false;
  }

  function resizeDocument(width: number, height: number, anchorX: number, anchorY: number) {
    if (!layers) return;
    app.docWidth = width;
    app.docHeight = height;
    layers.setDocumentSize(width, height, anchorX, anchorY);
    for (const layer of layers.flatLayers()) layer.history.clear();
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
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = loadPsd(buffer, layers, dpr);
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
    isDrawing = !done;
    if (!done) hideBrushCursor();
    else if (done) {
      // Restore cursor after stroke ends — use last point's screen position
      // (will be updated on next mousemove anyway)
    }

    const points = rawPoints.map((p) => ({
      ...p,
      pressure: pressureCurve.evaluate(p.pressure),
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
        layer.history.push(before);
        layers.composite();
        bumpLayerVersion();
      }
      return;
    }

    // Brush stroke
    if (points.length <= 1 && !done) {
      preStrokeSnapshot = layers.getSnapshot();
      if (app.brushType === "smooth") {
        saveLayerToCanvas(layer);
      }
      resetStampState();
    }

    if (app.brushType === "smooth") {
      // Perfect-freehand: redraws entire stroke each frame (not incremental).
      // Batch restore+draw+composite to once per frame — Apple Pencil fires at
      // 240Hz but screen refreshes at 60-120Hz, so most events are wasted work.
      if (done) {
        smoothPendingPoints = null;
        restoreLayerFromCanvas(layer);
        layer.ctx.save();
        selection?.applyClip(layer.ctx);
        drawStroke(
          layer.ctx,
          points,
          { ...app.brushSettings, alphaLock: layer.alphaLock },
          true,
          app.sizeRange,
        );
        layer.ctx.restore();
        layers.composite();
        if (preStrokeSnapshot) {
          layer.history.push(preStrokeSnapshot);
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
          drawStroke(
            active.ctx,
            latest,
            { ...app.brushSettings, alphaLock: active.alphaLock },
            false,
            app.sizeRange,
          );
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
        { ...app.brushSettings, brushType: app.brushType, alphaLock: layer.alphaLock },
        app.sizeRange,
      );
      layer.ctx.restore();
      scheduleComposite();

      if (done) {
        layers.composite();
        if (preStrokeSnapshot) {
          layer.history.push(preStrokeSnapshot);
          preStrokeSnapshot = null;
        }
        bumpLayerVersion();
      }
    }
  }

  // --- Set tool ---
  function setTool(tool: Tool) {
    // A floating transform/warp must resolve before switching tools (it has uncommitted
    // pixels). A plain marquee survives — brush/fill/eraser will clip to it.
    if (selection?.hasFloating && tool !== app.currentTool) {
      selection.commit();
    }
    if (tool === "eyedropper" && app.currentTool !== "eyedropper") {
      toolBeforeEyedropper = app.currentTool;
    }
    swapSlots(app, strokeSlots, app.currentTool, tool);
    app.currentTool = tool;
    app.brushSettings.isEraser = tool === "eraser";
    if (tool === "select") selection.mode = "rect";
    if (tool === "lasso") selection.mode = "lasso";
    updateCursor();
    debouncedSave();
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
      if (selection?.state === "selected") e.preventDefault();
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
    layer.history.push(before);
    layers.composite();
    bumpLayerVersion();
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

  // --- Clipboard ---
  // Pixels at the layer's physical resolution, plus where they were copied from (doc units).
  let pixelClipboard: { canvas: HTMLCanvasElement; rect: SelectionRect } | null = null;

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
    if (!selection || selection.state !== "selected" || !selection.rect || !layers) return;
    const dpr = window.devicePixelRatio || 1;
    const pixels = selection.copyPixels(layers.active.ctx, dpr);
    if (!pixels) return;
    pixelClipboard = { canvas: pixels, rect: { ...selection.rect } };
    copyToSystemClipboard(toDocResolution(pixels, selection.rect));
  }

  function deleteSelection() {
    if (!selection || selection.state !== "selected" || !layers) return;
    const layer = layers.active;
    if (layer.locked) return;
    const dpr = window.devicePixelRatio || 1;
    const before = layers.getSnapshot();
    selection.clearRegion(layer.ctx, dpr);
    selection.cancel(); // drop the marquee
    if (sameImageData(before, layers.getSnapshot())) return;
    layer.history.push(before);
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
    const cvs = document.createElement("canvas");
    cvs.width = bmp.width;
    cvs.height = bmp.height;
    cvs.getContext("2d")!.drawImage(bmp, 0, 0);
    const rect = placeExternalImage(bmp.width, bmp.height, app.docWidth, app.docHeight);
    bmp.close();
    startPasteFloat(cvs, rect);
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
    pasteInternal();
  }

  function init(): () => void {
    viewport = new Viewport(canvasContainerEl);
    const ctx = canvasEl.getContext("2d", { willReadFrequently: true })!;
    layers = new LayerManager(canvasEl, ctx, () => bumpLayerVersion());
    selection = new Selection(selectionOverlayEl);

    // Selection callbacks
    selection.onCommit = () => {
      const layer = layers.active;
      if (preSelectionSnapshot) {
        layer.history.push(preSelectionSnapshot);
        preSelectionSnapshot = null;
      }
      selection.renderFloatingTo(layer.ctx);
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
    bg.history.push(bg.ctx.getImageData(0, 0, bg.canvas.width, bg.canvas.height));
    layers.addLayer("Layer 1");
    loadSettings();
    updateCursor();
    layersReady = true;
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
        streamline: () => app.streamline / 100,
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
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      viewport.zoomAt(e.clientX, e.clientY, e.deltaY);
      updateZoomDisplay();
      updateBrushCursor(e.clientX, e.clientY);
    }
    workspaceEl.addEventListener("wheel", handleWheel, { passive: false });

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
      workspaceEl.removeEventListener("wheel", handleWheel);
      canvasEl.removeEventListener("pointerdown", handlePanDown, { capture: true });
      canvasEl.removeEventListener("pointermove", handlePanMove, { capture: true });
      canvasEl.removeEventListener("pointerup", handlePanUp, { capture: true });
      canvasClipEl.removeEventListener("pointermove", handleCursorMove);
      canvasClipEl.removeEventListener("pointerleave", handleCursorLeave);
    };
  }
</script>

<svelte:window
  onblur={() => {
    if (selection) selection.shiftHeld = false;
  }}
  onkeydown={handleKeyDown}
  onkeyup={handleKeyUp}
  onpaste={handlePaste}
  onresize={resizeCanvas}
/>

<div class="flex h-full w-full flex-col bg-canvas-bg">
  {#if layersReady}
    <Toolbar
      {setTool}
      {undo}
      {redo}
      {clearLayer}
      fillEnclosed={fillAllEnclosed}
      copy={copySelection}
      cut={cutSelection}
      paste={() => void pasteFromMenu()}
      {deleteSelection}
      {saveImage}
      exportPsd={doExportPsd}
      savePsd={doSavePsd}
      openPsd={doOpenPsd}
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

  <div class="workspace-layout flex flex-1 overflow-hidden" bind:this={workspaceEl}>
    <div
      class="relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden bg-canvas-bg"
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
      {#if layersReady}
        <SelectionActions
          {selection}
          {viewport}
          containerEl={canvasClipEl}
          isActionable={() => {
            const layer = layers?.active;
            return !!layer && !layer.locked && layer.visible;
          }}
          onTransform={enterFreeTransform}
          onDistort={() => enterWarp(2, 2)}
          onMesh={() => enterWarp(3, 3)}
          onFlip={flipSelection}
          keepProportions={app.keepProportions}
          onToggleKeepProportions={toggleKeepProportions}
          onCommit={() => selection.commit()}
          onCancel={() => selection.cancel()}
        />
      {/if}
    </div>

    {#if layersReady}
      <LayerPanel {layers} />
    {/if}
  </div>

  {#if layersReady}
    <StatusBar {selection} />
  {/if}

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
