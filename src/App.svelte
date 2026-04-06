<script lang="ts">
  import Toolbar from "./lib/Toolbar.svelte";
  import LayerPanel from "./lib/LayerPanel.svelte";
  import { setupInput, type InputPoint } from "./input";
  import { drawStampStrokeIncremental, resetStampState } from "./stamp-brush";
  import { LayerManager } from "./layers";
  import { floodFill, hexToRgba } from "./fill";
  import { Selection, type SelectionRect, type Transform } from "./selection";
  import { Viewport } from "./viewport";
  import { setupTouchGestures } from "./touch-gestures";
  import { exportPsd, savePsd, loadPsd } from "./export-psd";
  import { untrack } from "svelte";
  import { app, pressureCurve, bumpLayerVersion, initTheme, type Tool } from "./appState.svelte.js";
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

  // --- Selection state ---
  let preSelectionSnapshot: ImageData | null = null;
  let selectionMode: "create" | "drag" | null = null;

  // --- Drawing state ---
  let preStrokeSnapshot: ImageData | null = null;

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
    const layer = layers.active;
    const current = layers.getSnapshot();
    const next = layer.history.redo(current);
    if (next) {
      layers.restoreSnapshot(next);
      layers.composite();
      bumpLayerVersion();
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
    if (!canvasEl) return;
    const link = document.createElement("a");
    link.download = "drawing.png";
    link.href = canvasEl.toDataURL("image/png");
    link.click();
  }

  function doExportPsd() {
    if (!layers) return;
    exportPsd(layers, window.devicePixelRatio || 1);
  }

  function doSavePsd() {
    if (!layers) return;
    savePsd(layers, window.devicePixelRatio || 1);
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
      loadPsd(buffer, layers, dpr);
      layers.composite();
      bumpLayerVersion();
    };
    reader.readAsArrayBuffer(file);
    fileInputEl.value = "";
  }

  function resetView() {
    if (!viewport) return;
    viewport.resetView();
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
    const rect = canvasEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;
    canvasEl.width = w * dpr;
    canvasEl.height = h * dpr;
    selectionOverlayEl.width = w;
    selectionOverlayEl.height = h;
    layers.resize(w, h, dpr);
    layers.composite();
  }

  // --- Stroke handler ---
  function handleStroke(rawPoints: InputPoint[], done: boolean) {
    if (rawPoints.length === 0 || !layers) return;

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
        if (handle) {
          selectionMode = "drag";
          selection.startDrag(handle, p.x, p.y);
        } else {
          if (selection.hasFloating) selection.commit();
          selectionMode = "create";
          preSelectionSnapshot = layers.getSnapshot();
          selection.startCreate(p.x, p.y);
        }
      } else if (!done) {
        if (selectionMode === "create") selection.updateCreate(p.x, p.y);
        else if (selectionMode === "drag") selection.updateDrag(p.x, p.y);
      } else {
        if (selectionMode === "create" && selection.rect && selection.rect.w > 3 && selection.rect.h > 3) {
          selection.endCreate();
          layer.history.push(layers.getSnapshot());
          selection.liftPixels(layer.ctx, dpr);
          layers.composite();
          selection.drawOverlay();
        } else if (selectionMode === "create") {
          selection.endCreate();
        }
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
        floodFill(layer.ctx, points[0].x * dpr, points[0].y * dpr, color, app.fillSettings);
        layers.composite();
        bumpLayerVersion();
      }
      return;
    }

    // Brush stroke
    if (points.length <= 1 && !done) {
      preStrokeSnapshot = layers.getSnapshot();
      resetStampState();
    }

    drawStampStrokeIncremental(layer.ctx, points, { ...app.brushSettings, brushType: app.brushType, alphaLock: layer.alphaLock }, app.sizeRange);
    layers.composite();

    if (done) {
      if (preStrokeSnapshot) {
        layer.history.push(preStrokeSnapshot);
        preStrokeSnapshot = null;
      }
      bumpLayerVersion();
    }
  }

  // --- Set tool ---
  function setTool(tool: Tool) {
    app.currentTool = tool;
    app.brushSettings.isEraser = tool === "eraser";
    if (tool === "select") selection.mode = "rect";
    if (tool === "lasso") selection.mode = "lasso";
    updateCursor();
    debouncedSave();
  }

  function updateCursor() {
    if (!canvasEl) return;
    if (app.currentTool === "select" || app.currentTool === "lasso" || app.currentTool === "fill") {
      canvasEl.style.cursor = "crosshair";
    } else if (app.currentTool === "eraser") {
      canvasEl.style.cursor = "cell";
    } else {
      canvasEl.style.cursor = "crosshair";
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
    selection.onCommit = (pixels: HTMLCanvasElement, rect: SelectionRect, transform: Transform) => {
      const layer = layers.active;
      const cx = rect.x + rect.w / 2 + transform.tx;
      const cy = rect.y + rect.h / 2 + transform.ty;
      const hw = (rect.w / 2) * transform.sx;
      const hh = (rect.h / 2) * transform.sy;
      layer.ctx.save();
      layer.ctx.translate(cx, cy);
      layer.ctx.rotate(transform.rotation);
      layer.ctx.drawImage(pixels, -hw, -hh, hw * 2, hh * 2);
      layer.ctx.restore();
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
      layers.composite();
    };

    // First resize: set canvas dimensions so layer canvases get valid sizes
    resizeCanvas();
    layers.addLayer("Layer 1");
    loadSettings();
    updateCursor();
    layersReady = true;
    // Second resize after next frame: Toolbar/LayerPanel are now rendered,
    // flex layout has settled, so re-measure to get correct canvas dimensions
    requestAnimationFrame(() => resizeCanvas());

    // Input handling
    const cleanupInput = setupInput(canvasEl, handleStroke, (sx, sy) => viewport.screenToCanvas(sx, sy), {
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
        canvasEl.style.cursor = spaceHeld ? "grab" : "crosshair";
      }
    }
    canvasEl.addEventListener("pointerdown", handlePanDown, { capture: true });
    canvasEl.addEventListener("pointermove", handlePanMove, { capture: true });
    canvasEl.addEventListener("pointerup", handlePanUp, { capture: true });

    return () => {
      cleanupInput();
      cleanupTouch();
      workspaceEl.removeEventListener("wheel", handleWheel);
      canvasEl.removeEventListener("pointerdown", handlePanDown, { capture: true });
      canvasEl.removeEventListener("pointermove", handlePanMove, { capture: true });
      canvasEl.removeEventListener("pointerup", handlePanUp, { capture: true });
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
      {resetView}
      onSettingsChange={debouncedSave}
    />
  {/if}

  <div class="workspace-layout flex flex-1 overflow-hidden" bind:this={workspaceEl}>
    <div class="flex-1 min-w-0 min-h-0 overflow-hidden relative touch-none" bind:this={canvasClipEl}>
      <div class="w-full h-full absolute will-change-transform touch-none" bind:this={canvasContainerEl}>
        <canvas
          bind:this={canvasEl}
          class="w-full h-full cursor-crosshair touch-none canvas-checkerboard"
        ></canvas>
        <canvas
          bind:this={selectionOverlayEl}
          class="absolute inset-0 w-full h-full pointer-events-none touch-none"
        ></canvas>
      </div>
    </div>

    {#if layersReady}
      <LayerPanel {layers} />
    {/if}
  </div>

  <input
    type="file"
    accept=".psd"
    class="hidden"
    bind:this={fileInputEl}
    onchange={handleFileLoad}
  />
</div>
