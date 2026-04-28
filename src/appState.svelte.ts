import type { BrushSettings } from "./brush";
import type { BrushType } from "./brush-textures";
import type { FillOptions } from "./fill";
import { PressureCurve } from "./pressure-curve";

export type Tool = "brush" | "eraser" | "fill" | "select" | "lasso";

interface AppStateShape {
  currentTool: Tool;
  brushType: BrushType;
  sizeRange: number;
  streamline: number;
  brushSettings: BrushSettings;
  fillSettings: FillOptions;
  theme: "light" | "dark";
  zoomText: string;
  layerVersion: number;
  selectionVersion: number;
  docWidth: number;
  docHeight: number;
}

export const app: AppStateShape = $state({
  currentTool: "brush",
  brushType: "smooth",
  sizeRange: 1.0,
  streamline: 50,
  brushSettings: {
    size: 4,
    color: "#1a1a1a",
    opacity: 100,
    smoothing: 50,
    isEraser: false,
    drawBehind: false,
    alphaLock: false,
  },
  fillSettings: {
    tolerance: 32,
    alphaThreshold: 0,
    expand: 0,
  },
  theme: "light",
  zoomText: "100%",
  layerVersion: 0,
  selectionVersion: 0,
  docWidth: 1920,
  docHeight: 1080,
});

// PressureCurve is not reactive — it's an imperative canvas widget
export const pressureCurve = new PressureCurve();

export function bumpLayerVersion() {
  app.layerVersion++;
}

export function bumpSelectionVersion() {
  app.selectionVersion++;
}

export function initTheme() {
  const saved = localStorage.getItem("theme");
  if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    app.theme = "dark";
    document.documentElement.classList.add("dark");
  }
}

export function toggleTheme() {
  app.theme = app.theme === "light" ? "dark" : "light";
  document.documentElement.classList.toggle("dark", app.theme === "dark");
  localStorage.setItem("theme", app.theme);
}
