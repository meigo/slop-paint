import "./style.css";
import { setupInput, type InputPoint } from "./input";
import { drawStroke, type BrushSettings } from "./brush";
import { drawStampStrokeIncremental, resetStampState } from "./stamp-brush";
import type { BrushType } from "./brush-textures";
import { LayerManager } from "./layers";
import { floodFill, hexToRgba } from "./fill";
import { PressureCurve, createCurveEditor } from "./pressure-curve";
import { Selection, type SelectionRect, type Transform } from "./selection";
import { Viewport } from "./viewport";
import { exportPsd } from "./export-psd";

// --- Display canvas setup ---
const canvasContainer = document.getElementById("canvas-container") as HTMLElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
const selectionOverlay = document.getElementById("selection-overlay") as HTMLCanvasElement;

// --- Viewport (zoom/pan) ---
const viewport = new Viewport(canvasContainer);

// Offscreen canvas for compositing live brush strokes
const liveCanvas = document.createElement("canvas");
const liveCtx = liveCanvas.getContext("2d")!;

// --- Layer manager ---
const layers = new LayerManager(canvas, ctx, () => renderLayerList());

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width;
  const h = rect.height;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  selectionOverlay.width = w;
  selectionOverlay.height = h;
  liveCanvas.width = canvas.width;
  liveCanvas.height = canvas.height;
  liveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  layers.resize(w, h, dpr);
  layers.composite();
}

window.addEventListener("resize", resizeCanvas);

// --- Brush settings ---
const settings: BrushSettings = {
  size: 4,
  color: "#1a1a1a",
  opacity: 100,
  smoothing: 50,
  taper: true,
  isEraser: false,
};

// --- UI Bindings ---
const brushTypeSelect = document.getElementById("brush-type") as HTMLSelectElement;
const btnBrush = document.getElementById("btn-brush") as HTMLButtonElement;
const btnEraser = document.getElementById("btn-eraser") as HTMLButtonElement;
const btnSelect = document.getElementById("btn-select") as HTMLButtonElement;
const btnLasso = document.getElementById("btn-lasso") as HTMLButtonElement;
const btnFill = document.getElementById("btn-fill") as HTMLButtonElement;
const brushSizeInput = document.getElementById("brush-size") as HTMLInputElement;
const sizeValue = document.getElementById("size-value")!;
const brushOpacityInput = document.getElementById("brush-opacity") as HTMLInputElement;
const opacityValue = document.getElementById("opacity-value")!;
const colorPicker = document.getElementById("color-picker") as HTMLInputElement;
const smoothingInput = document.getElementById("smoothing") as HTMLInputElement;
const taperInput = document.getElementById("taper") as HTMLInputElement;
const sizeRangeInput = document.getElementById("size-range") as HTMLInputElement;
const sizeRangeValue = document.getElementById("size-range-value")!;
const btnCurve = document.getElementById("btn-curve") as HTMLButtonElement;
const curvePopup = document.getElementById("curve-popup")!;
const btnUndo = document.getElementById("btn-undo") as HTMLButtonElement;
const btnRedo = document.getElementById("btn-redo") as HTMLButtonElement;
const btnClear = document.getElementById("btn-clear") as HTMLButtonElement;
const btnSave = document.getElementById("btn-save") as HTMLButtonElement;

// Layer panel buttons
const btnAddLayer = document.getElementById("btn-add-layer") as HTMLButtonElement;
const btnRemoveLayer = document.getElementById("btn-remove-layer") as HTMLButtonElement;
const btnMoveUp = document.getElementById("btn-move-up") as HTMLButtonElement;
const btnMoveDown = document.getElementById("btn-move-down") as HTMLButtonElement;
const layerListEl = document.getElementById("layer-list")!;

let currentTool: "brush" | "eraser" | "fill" | "select" | "lasso" = "brush";

function setTool(tool: "brush" | "eraser" | "fill" | "select" | "lasso") {
  currentTool = tool;
  settings.isEraser = tool === "eraser";
  btnBrush.classList.toggle("active", tool === "brush");
  btnEraser.classList.toggle("active", tool === "eraser");
  btnFill.classList.toggle("active", tool === "fill");
  btnSelect.classList.toggle("active", tool === "select");
  btnLasso.classList.toggle("active", tool === "lasso");
  if (tool === "select") selection.mode = "rect";
  if (tool === "lasso") selection.mode = "lasso";
  canvas.style.cursor = (tool === "select" || tool === "lasso") ? "crosshair" : tool === "fill" ? "crosshair" : tool === "eraser" ? "cell" : "crosshair";
  debouncedSave();
}

let brushType: BrushType = "smooth";

btnBrush.addEventListener("click", () => setTool("brush"));
btnEraser.addEventListener("click", () => setTool("eraser"));
btnSelect.addEventListener("click", () => setTool("select"));
btnLasso.addEventListener("click", () => setTool("lasso"));
btnFill.addEventListener("click", () => setTool("fill"));

brushTypeSelect.addEventListener("change", () => {
  brushType = brushTypeSelect.value as BrushType;
});

brushSizeInput.addEventListener("input", () => {
  settings.size = Number(brushSizeInput.value);
  sizeValue.textContent = brushSizeInput.value;
});

brushOpacityInput.addEventListener("input", () => {
  settings.opacity = Number(brushOpacityInput.value);
  opacityValue.textContent = brushOpacityInput.value + "%";
});

colorPicker.addEventListener("input", () => {
  settings.color = colorPicker.value;
});

smoothingInput.addEventListener("input", () => {
  settings.smoothing = Number(smoothingInput.value);
});

taperInput.addEventListener("change", () => {
  settings.taper = taperInput.checked;
});

// Size range multiplier
let sizeRange = 1.0;
sizeRangeInput.addEventListener("input", () => {
  sizeRange = Number(sizeRangeInput.value) / 100;
  sizeRangeValue.textContent = sizeRange.toFixed(1) + "x";
});

// Pressure curve
const pressureCurve = new PressureCurve();
const curveEditorEl = createCurveEditor(pressureCurve, () => debouncedSave());
curvePopup.appendChild(curveEditorEl);

btnCurve.addEventListener("click", () => {
  curvePopup.classList.toggle("open");
});

// Close popup when clicking outside
document.addEventListener("pointerdown", (e) => {
  if (
    curvePopup.classList.contains("open") &&
    !curvePopup.contains(e.target as Node) &&
    e.target !== btnCurve
  ) {
    curvePopup.classList.remove("open");
  }
});

// Swatches
document.querySelectorAll(".swatch").forEach((el) => {
  el.addEventListener("click", () => {
    const color = (el as HTMLElement).dataset.color!;
    settings.color = color;
    colorPicker.value = color;
  });
});

// --- Selection ---
const selection = new Selection(selectionOverlay);

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
  renderLayerList();
};

selection.onCancel = () => {
  // Restore pre-selection state
  if (preSelectionSnapshot) {
    layers.restoreSnapshot(preSelectionSnapshot);
    preSelectionSnapshot = null;
    layers.composite();
    renderLayerList();
  }
};

selection.onChange = () => {
  layers.composite();
};

let preSelectionSnapshot: ImageData | null = null;
let selectionMode: "create" | "drag" | null = null;

// --- Drawing (operates on active layer) ---
let preStrokeSnapshot: ImageData | null = null;

function handleStroke(rawPoints: InputPoint[], done: boolean) {
  if (rawPoints.length === 0) return;

  // Apply pressure curve
  const points = rawPoints.map((p) => ({
    ...p,
    pressure: pressureCurve.evaluate(p.pressure),
  }));

  const layer = layers.active;
  const dpr = window.devicePixelRatio || 1;

  // Selection tool (rect or lasso)
  if (currentTool === "select" || currentTool === "lasso") {
    const p = points[points.length - 1];

    if (points.length === 1 && !done) {
      // Pointer down: check if hitting a handle or starting new selection
      const handle = selection.hitTest(p.x, p.y);
      if (handle) {
        selectionMode = "drag";
        selection.startDrag(handle, p.x, p.y);
      } else {
        // Commit any existing selection, then start new one
        if (selection.hasFloating) {
          selection.commit();
        }
        selectionMode = "create";
        preSelectionSnapshot = layers.getSnapshot();
        selection.startCreate(p.x, p.y);
      }
    } else if (!done) {
      if (selectionMode === "create") {
        selection.updateCreate(p.x, p.y);
      } else if (selectionMode === "drag") {
        selection.updateDrag(p.x, p.y);
      }
    } else {
      // Pointer up
      if (selectionMode === "create" && selection.rect && selection.rect.w > 3 && selection.rect.h > 3) {
        selection.endCreate();
        // Lift pixels from the active layer
        layer.history.push(layers.getSnapshot());
        selection.liftPixels(layer.ctx, dpr);
        layers.composite();
        selection.drawOverlay();
      } else if (selectionMode === "create") {
        // Too small, cancel
        selection.endCreate();
      }
      selection.endDrag();
      selectionMode = null;
    }

    canvas.style.cursor = selection.getCursor(selection.hitTest(p.x, p.y));
    return;
  }

  // Paint bucket: fill on click (pointer down)
  if (currentTool === "fill") {
    if (points.length === 1 && !done) {
      const snapshot = layers.getSnapshot();
      layer.history.push(snapshot);
      const color = hexToRgba(settings.color, settings.opacity);
      floodFill(layer.ctx, points[0].x * dpr, points[0].y * dpr, color);
      layers.composite();
      renderLayerList();
    }
    return;
  }

  // Save state before first point of stroke
  if (points.length <= 1 && !done) {
    preStrokeSnapshot = layers.getSnapshot();
    if (brushType !== "smooth") {
      resetStampState();
    }
  }

  const rect = canvas.getBoundingClientRect();

  const useStamp = brushType !== "smooth" && !settings.isEraser;

  if (settings.isEraser) {
    if (preStrokeSnapshot) {
      layers.restoreSnapshot(preStrokeSnapshot);
    }
    drawStroke(layer.ctx, points, settings, done, sizeRange);
  } else if (useStamp) {
    // Textured brush: stamp incrementally directly on layer
    drawStampStrokeIncremental(layer.ctx, points, { ...settings, brushType }, sizeRange);
  } else {
    // Smooth brush: vector path via perfect-freehand
    liveCtx.clearRect(0, 0, rect.width, rect.height);
    drawStroke(liveCtx, points, settings, done, sizeRange);

    if (preStrokeSnapshot) {
      layers.restoreSnapshot(preStrokeSnapshot);
    }
    layer.ctx.resetTransform();
    layer.ctx.drawImage(liveCanvas, 0, 0);
    layer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Recomposite all layers onto display
  layers.composite();

  if (done) {
    if (preStrokeSnapshot) {
      layer.history.push(preStrokeSnapshot);
      preStrokeSnapshot = null;
    }
    liveCtx.clearRect(0, 0, rect.width, rect.height);
    renderLayerList(); // update thumbnails
  }
}

setupInput(canvas, handleStroke, (sx, sy) => viewport.screenToCanvas(sx, sy));

// --- Undo / Redo (per-layer) ---
function undo() {
  const layer = layers.active;
  const current = layers.getSnapshot();
  const prev = layer.history.undo(current);
  if (prev) {
    layers.restoreSnapshot(prev);
    layers.composite();
    renderLayerList();
  }
}

function redo() {
  const layer = layers.active;
  const current = layers.getSnapshot();
  const next = layer.history.redo(current);
  if (next) {
    layers.restoreSnapshot(next);
    layers.composite();
    renderLayerList();
  }
}

btnUndo.addEventListener("click", undo);
btnRedo.addEventListener("click", redo);

// --- Clear active layer ---
btnClear.addEventListener("click", () => {
  const layer = layers.active;
  layer.history.push(layers.getSnapshot());
  layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  layers.composite();
  renderLayerList();
});

// --- Save (composites all visible layers) ---
btnSave.addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "drawing.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});

// --- Save as PSD ---
const btnSavePsd = document.getElementById("btn-save-psd") as HTMLButtonElement;
btnSavePsd.addEventListener("click", () => {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  exportPsd(layers.layers, rect.width, rect.height, dpr);
});

// --- Layer panel ---
btnAddLayer.addEventListener("click", () => {
  layers.addLayer();
  renderLayerList();
});

btnRemoveLayer.addEventListener("click", () => {
  layers.removeLayer(layers.activeIndex);
  layers.composite();
  renderLayerList();
});

btnMoveUp.addEventListener("click", () => {
  layers.moveLayer(layers.activeIndex, layers.activeIndex + 1);
  layers.composite();
  renderLayerList();
});

btnMoveDown.addEventListener("click", () => {
  layers.moveLayer(layers.activeIndex, layers.activeIndex - 1);
  layers.composite();
  renderLayerList();
});

function renderLayerList() {
  layerListEl.innerHTML = "";

  // Render top-to-bottom (highest layer first)
  for (let i = layers.layers.length - 1; i >= 0; i--) {
    const layer = layers.layers[i];
    const item = document.createElement("div");
    item.className = "layer-item" + (i === layers.activeIndex ? " active" : "");

    // Thumbnail
    const thumb = document.createElement("canvas");
    thumb.className = "layer-thumb";
    thumb.width = 28;
    thumb.height = 28;
    const tCtx = thumb.getContext("2d")!;
    tCtx.drawImage(layer.canvas, 0, 0, 28, 28);

    // Visibility toggle
    const visBtn = document.createElement("button");
    visBtn.className = "layer-visibility";
    visBtn.textContent = layer.visible ? "\u{1F441}" : "\u2013";
    visBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      layers.toggleVisibility(i);
    });

    // Name (double-click to rename)
    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = layer.name;
    name.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const input = document.createElement("input");
      input.type = "text";
      input.className = "layer-rename-input";
      input.value = layer.name;
      name.replaceWith(input);
      input.focus();
      input.select();

      const commit = () => {
        const newName = input.value.trim() || layer.name;
        layer.name = newName;
        input.replaceWith(name);
        name.textContent = newName;
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (ke) => {
        if (ke.key === "Enter") { ke.preventDefault(); input.blur(); }
        if (ke.key === "Escape") { input.value = layer.name; input.blur(); }
        ke.stopPropagation();
      });
      input.addEventListener("click", (ce) => ce.stopPropagation());
    });

    // Group tag (click to edit)
    const groupTag = document.createElement("span");
    groupTag.className = "layer-group-tag";
    groupTag.textContent = layer.group || "+grp";
    groupTag.title = "Group name (for PSD export / Spine)";
    if (!layer.group) groupTag.classList.add("empty");
    groupTag.addEventListener("click", (e) => {
      e.stopPropagation();
      const input = document.createElement("input");
      input.type = "text";
      input.className = "layer-rename-input";
      input.value = layer.group;
      input.placeholder = "group name";
      input.style.width = "60px";
      groupTag.replaceWith(input);
      input.focus();
      input.select();

      const commit = () => {
        layer.group = input.value.trim();
        groupTag.textContent = layer.group || "+grp";
        groupTag.classList.toggle("empty", !layer.group);
        input.replaceWith(groupTag);
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (ke) => {
        if (ke.key === "Enter") { ke.preventDefault(); input.blur(); }
        if (ke.key === "Escape") { input.value = layer.group; input.blur(); }
        ke.stopPropagation();
      });
      input.addEventListener("click", (ce) => ce.stopPropagation());
    });

    // Opacity slider
    const opSlider = document.createElement("input");
    opSlider.type = "range";
    opSlider.className = "layer-opacity-slider";
    opSlider.min = "0";
    opSlider.max = "100";
    opSlider.value = String(layer.opacity);
    opSlider.addEventListener("input", (e) => {
      e.stopPropagation();
      layers.setLayerOpacity(i, Number(opSlider.value));
    });
    opSlider.addEventListener("click", (e) => e.stopPropagation());

    // Click to select
    item.addEventListener("click", () => {
      layers.setActive(i);
    });

    item.appendChild(visBtn);
    item.appendChild(thumb);
    item.appendChild(name);
    item.appendChild(groupTag);
    item.appendChild(opSlider);
    layerListEl.appendChild(item);
  }
}

// --- Persist UI settings ---
const STORAGE_KEY = "drawingAppSettings";

interface SavedSettings {
  tool: string;
  brushType: string;
  size: number;
  opacity: number;
  smoothing: number;
  taper: boolean;
  color: string;
  sizeRange: number;
  curveCp1: { x: number; y: number };
  curveCp2: { x: number; y: number };
}

function saveSettings() {
  const data: SavedSettings = {
    tool: currentTool,
    brushType,
    size: settings.size,
    opacity: settings.opacity,
    smoothing: settings.smoothing,
    taper: settings.taper,
    color: settings.color,
    sizeRange,
    curveCp1: { ...pressureCurve.cp1 },
    curveCp2: { ...pressureCurve.cp2 },
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* quota exceeded, ignore */ }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data: SavedSettings = JSON.parse(raw);

    // Tool
    if (data.tool) setTool(data.tool as typeof currentTool);

    // Brush type
    if (data.brushType) {
      brushType = data.brushType as BrushType;
      brushTypeSelect.value = data.brushType;
    }

    // Size
    if (data.size != null) {
      settings.size = data.size;
      brushSizeInput.value = String(data.size);
      sizeValue.textContent = String(data.size);
    }

    // Opacity
    if (data.opacity != null) {
      settings.opacity = data.opacity;
      brushOpacityInput.value = String(data.opacity);
      opacityValue.textContent = data.opacity + "%";
    }

    // Smoothing
    if (data.smoothing != null) {
      settings.smoothing = data.smoothing;
      smoothingInput.value = String(data.smoothing);
    }

    // Taper
    if (data.taper != null) {
      settings.taper = data.taper;
      taperInput.checked = data.taper;
    }

    // Color
    if (data.color) {
      settings.color = data.color;
      colorPicker.value = data.color;
    }

    // Size range
    if (data.sizeRange != null) {
      sizeRange = data.sizeRange;
      sizeRangeInput.value = String(Math.round(data.sizeRange * 100));
      sizeRangeValue.textContent = data.sizeRange.toFixed(1) + "x";
    }

    // Pressure curve
    if (data.curveCp1 && data.curveCp2) {
      pressureCurve.cp1 = data.curveCp1;
      pressureCurve.cp2 = data.curveCp2;
      pressureCurve.buildLUT();
      curveEditorEl.redraw();
    }
  } catch { /* corrupted data, ignore */ }
}

// Save on every change (debounced)
let saveTimer: ReturnType<typeof setTimeout>;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 300);
}

// Hook save into tool changes via event listeners
brushTypeSelect.addEventListener("change", debouncedSave);
brushSizeInput.addEventListener("input", debouncedSave);
brushOpacityInput.addEventListener("input", debouncedSave);
colorPicker.addEventListener("input", debouncedSave);
smoothingInput.addEventListener("input", debouncedSave);
taperInput.addEventListener("change", debouncedSave);
sizeRangeInput.addEventListener("input", debouncedSave);

// --- Init: resize first so layers get proper dimensions ---
resizeCanvas();
layers.addLayer("Layer 1");
loadSettings();

// --- Keyboard shortcuts ---
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT") return;

  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();
    if (e.shiftKey) {
      redo();
    } else {
      undo();
    }
    return;
  }

  // Selection: Enter to commit, Escape to cancel
  if (e.key === "Enter" && selection.active) {
    e.preventDefault();
    selection.commit();
    return;
  }
  if (e.key === "Escape" && selection.active) {
    e.preventDefault();
    selection.cancel();
    return;
  }

  if (e.key === "b") setTool("brush");
  if (e.key === "e") setTool("eraser");
  if (e.key === "s") setTool("select");
  if (e.key === "l") setTool("lasso");
  if (e.key === "g") setTool("fill");

  if (e.key === "[") {
    settings.size = Math.max(1, settings.size - 2);
    brushSizeInput.value = String(settings.size);
    sizeValue.textContent = String(settings.size);
  }
  if (e.key === "]") {
    settings.size = Math.min(80, settings.size + 2);
    brushSizeInput.value = String(settings.size);
    sizeValue.textContent = String(settings.size);
  }

  // Zoom shortcuts
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
});

// --- Hold X for temporary eraser ---
let toolBeforeEraser: "brush" | "eraser" | "fill" | "select" | "lasso" | null = null;

window.addEventListener("keydown", (e) => {
  if (e.key === "x" && !e.repeat && !toolBeforeEraser && currentTool !== "eraser") {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    toolBeforeEraser = currentTool;
    setTool("eraser");
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === "x" && toolBeforeEraser) {
    setTool(toolBeforeEraser);
    toolBeforeEraser = null;
  }
});

// --- Zoom: mouse wheel ---
const workspace = document.getElementById("workspace")!;
workspace.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    // Pinch-zoom (trackpad) or ctrl+wheel
    viewport.zoomAt(e.clientX, e.clientY, e.deltaY);
  } else {
    // Regular wheel = zoom
    viewport.zoomAt(e.clientX, e.clientY, e.deltaY);
  }
  updateZoomDisplay();
}, { passive: false });

// --- Pan: middle mouse or Space+drag ---
let spaceHeld = false;
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !spaceHeld) {
    spaceHeld = true;
    canvas.style.cursor = "grab";
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    spaceHeld = false;
    canvas.style.cursor = "crosshair";
  }
});

canvas.addEventListener("pointerdown", (e) => {
  if (e.button === 1 || (e.button === 0 && spaceHeld)) {
    e.preventDefault();
    e.stopPropagation();
    viewport.startPan(e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
  }
}, { capture: true });

canvas.addEventListener("pointermove", (e) => {
  if (viewport.panning) {
    e.preventDefault();
    e.stopPropagation();
    viewport.updatePan(e.clientX, e.clientY);
  }
}, { capture: true });

canvas.addEventListener("pointerup", (e) => {
  if (viewport.panning) {
    e.preventDefault();
    e.stopPropagation();
    viewport.endPan();
    canvas.style.cursor = spaceHeld ? "grab" : "crosshair";
  }
}, { capture: true });

// --- Zoom display ---
function updateZoomDisplay() {
  const el = document.getElementById("zoom-level");
  if (el) el.textContent = Math.round(viewport.zoom * 100) + "%";
}
