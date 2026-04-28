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
  import { floodFill, hexToRgba } from "./fill";
  import { Selection } from "./selection";
  import { Viewport } from "./viewport";
  import { setupTouchGestures } from "./touch-gestures";
  import { exportPsd, savePsd, loadPsd } from "./export-psd";
  import { untrack } from "svelte";
  import { app, pressureCurve, bumpLayerVersion, bumpSelectionVersion, initTheme, type Tool } from "./appState.svelte.js";
  import type { BrushType } from "./brush-textures";

  // --- Canvas refs ---
  let canvasContainerEl: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;
  let selectionOverlayEl: HTMLCanvasElement;
  let canvasClipEl: HTMLDivElement;
  let workspaceEl: HTMLDivElement;
  let fileInputEl: HTMLInputElement;

  // --- Core objects (imperative, not $state) ---
  let viewport: Viewport;
  let layers: LayerManager;
  let selection: Selection;

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
  // Batched smooth brush rendering — only redraw once per frame
  let smoothDrawScheduled = false;

  function saveLayerToCanvas(layer: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): HTMLCanvasElement {
    if (!preStrokeCanvas || preStrokeCanvas.width !== layer.canvas.width || preStrokeCanvas.height !== layer.canvas.height) {
      preStrokeCanvas = document.createElement("canvas");
      preStrokeCanvas.width = layer.canvas.width;
      preStrokeCanvas.height = layer.canvas.height;
    }
    const ctx = preStrokeCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, preStrokeCanvas.width, preStrokeCanvas.height);
    ctx.drawImage(layer.canvas, 0, 0);
    return preStrokeCanvas;
  }

  function restoreLayerFromCanvas(layer: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }) {
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
    const overCanvas = canvasPos.x >= 0 && canvasPos.x <= app.docWidth && canvasPos.y >= 0 && canvasPos.y <= app.docHeight;
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

  // --- Panning state ---
  let spaceHeld = false;

  // --- Temporary eraser ---
  let toolBeforeEraser: Tool | null = null;
  let toolBeforePencilToggle: Tool | null = null;

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
  }

  function saveSettings() {
    const data: SavedSettings = {
      tool: app.currentTool,
      brushType: app.brushType,
      size: app.brushSettings.size,
      opacity: app.brushSettings.opacity,
      smoothing: app.brushSettings.smoothing,
      color: app.brushSettings.color,
      sizeRange: app.sizeRange,
      streamline: app.streamline,
      curveCp1: { ...pressureCurve.cp1 },
      curveCp2: { ...pressureCurve.cp2 },
      drawBehind: app.brushSettings.drawBehind,
      fillAlphaThreshold: app.fillSettings.alphaThreshold,
      fillExpand: app.fillSettings.expand,
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
      if (data.fillAlphaThreshold != null) app.fillSettings.alphaThreshold = data.fillAlphaThreshold;
      if (data.fillExpand != null) app.fillSettings.expand = data.fillExpand;
      if (data.curveCp1 && data.curveCp2) {
        pressureCurve.cp1 = data.curveCp1;
        pressureCurve.cp2 = data.curveCp2;
        pressureCurve.buildLUT();
      }
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
        } else if ((selection.state === "transforming" || selection.state === "warping") && handle) {
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
        const snapshot = layers.getSnapshot();
        layer.history.push(snapshot);
        const color = hexToRgba(app.brushSettings.color, app.brushSettings.opacity);
        if (selection?.state === "selected") {
          // Run flood fill on a temp canvas (1:1 with layer's physical pixels),
          // then composite back through the selection clip.
          const tmp = document.createElement("canvas");
          tmp.width = layer.canvas.width;
          tmp.height = layer.canvas.height;
          const tmpCtx = tmp.getContext("2d", { willReadFrequently: true })!;
          tmpCtx.drawImage(layer.canvas, 0, 0);
          floodFill(tmpCtx, points[0].x * dpr, points[0].y * dpr, color, app.fillSettings);
          layer.ctx.save();
          selection.applyClip(layer.ctx);
          // tmp has physical pixel dimensions; layer.ctx has dpr scaling, so draw
          // tmp at its CSS-pixel size to land 1:1 in physical pixels.
          layer.ctx.drawImage(tmp, 0, 0, tmp.width / dpr, tmp.height / dpr);
          layer.ctx.restore();
        } else {
          floodFill(layer.ctx, points[0].x * dpr, points[0].y * dpr, color, app.fillSettings);
        }
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
        smoothDrawScheduled = false;
        restoreLayerFromCanvas(layer);
        layer.ctx.save();
        selection?.applyClip(layer.ctx);
        drawStroke(layer.ctx, points, { ...app.brushSettings, alphaLock: layer.alphaLock }, true, app.sizeRange);
        layer.ctx.restore();
        layers.composite();
        if (preStrokeSnapshot) {
          layer.history.push(preStrokeSnapshot);
          preStrokeSnapshot = null;
        }
        bumpLayerVersion();
      } else if (!smoothDrawScheduled) {
        smoothDrawScheduled = true;
        requestAnimationFrame(() => {
          smoothDrawScheduled = false;
          if (!layers) return;
          const active = layers.active;
          restoreLayerFromCanvas(active);
          active.ctx.save();
          selection?.applyClip(active.ctx);
          drawStroke(active.ctx, points, { ...app.brushSettings, alphaLock: active.alphaLock }, false, app.sizeRange);
          active.ctx.restore();
          layers.composite();
        });
      }
    } else {
      // Stamp engine: incremental, only draws new points
      layer.ctx.save();
      selection?.applyClip(layer.ctx);
      drawStampStrokeIncremental(layer.ctx, points, { ...app.brushSettings, brushType: app.brushType, alphaLock: layer.alphaLock }, app.sizeRange);
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
    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;

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

    if (e.key === "r" || e.key === "R") {
      const step = (15 * Math.PI) / 180;
      viewport.rotateAroundCenter(e.shiftKey ? -step : step);
      updateZoomDisplay();
    }

    if (e.key === "[") {
      app.brushSettings.size = Math.max(1, app.brushSettings.size - 2);
    }
    if (e.key === "]") {
      app.brushSettings.size = Math.min(80, app.brushSettings.size + 2);
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
    if ((e.ctrlKey || e.metaKey) && e.key === "0") {
      e.preventDefault();
      viewport.resetView();
      updateZoomDisplay();
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
    if (!canvasEl || !selectionOverlayEl || !canvasContainerEl || !canvasClipEl || !workspaceEl) return;

    // Use untrack to prevent reactive writes during init from creating circular dependencies.
    // The onChange callback calls bumpLayerVersion() which writes to app.layerVersion —
    // without untrack, this would trigger other effects and exceed max update depth.
    return untrack(() => init());
  });

  function init(): () => void {
    initTheme();

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
    const cleanupInput = setupInput(canvasEl, handleStroke, (sx, sy) => viewport.screenToCanvas(sx, sy), {
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
    });

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
        canvasEl.style.cursor = spaceHeld ? "grab" : (isBrushTool ? "none" : "crosshair");
        if (!spaceHeld) updateBrushCursor(e.clientX, e.clientY);
      }
    }
    canvasEl.addEventListener("pointerdown", handlePanDown, { capture: true });
    canvasEl.addEventListener("pointermove", handlePanMove, { capture: true });
    canvasEl.addEventListener("pointerup", handlePanUp, { capture: true });

    // Brush cursor tracking
    function handleCursorMove(e: PointerEvent) {
      if (e.pointerType === "touch") return;
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

<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} onresize={resizeCanvas} />

<div class="w-screen h-screen flex flex-col bg-canvas-bg">
  {#if layersReady}
    <Toolbar
      {setTool}
      {undo}
      {redo}
      {clearLayer}
      {saveImage}
      exportPsd={doExportPsd}
      savePsd={doSavePsd}
      openPsd={doOpenPsd}
      newDoc={() => { showNewDocDialog = true; }}
      resizeDoc={() => { showResizeDialog = true; }}
      {resetView}
      onSettingsChange={debouncedSave}
    />
  {/if}

  <div class="workspace-layout flex flex-1 overflow-hidden" bind:this={workspaceEl}>
    <div class="flex-1 min-w-0 min-h-0 overflow-hidden relative touch-none bg-neutral-500/30" bind:this={canvasClipEl}>
      <div class="absolute will-change-transform touch-none" bind:this={canvasContainerEl}>
        <canvas
          bind:this={canvasEl}
          class="block touch-none canvas-checkerboard"
        ></canvas>
        <canvas
          bind:this={selectionOverlayEl}
          class="absolute inset-0 pointer-events-none touch-none"
        ></canvas>
      </div>
      <div
        bind:this={brushCursorEl}
        class="absolute rounded-full border pointer-events-none"
        style="display: none; border-color: rgba(0,0,0,0.5); box-shadow: 0 0 0 1px rgba(255,255,255,0.5); mix-blend-mode: difference;"
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
    onCancel={() => { showNewDocDialog = false; }}
  />

  <ResizeDocDialog
    open={showResizeDialog}
    onConfirm={resizeDocument}
    onCancel={() => { showResizeDialog = false; }}
  />
</div>
