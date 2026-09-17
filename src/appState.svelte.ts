import type { BrushSettings } from "./brush";
import type { BrushType } from "./brush-textures";
import type { FillOptions } from "./fill";
import { PressureCurve } from "./pressure-curve";

export type Tool = "brush" | "eraser" | "fill" | "select" | "lasso" | "eyedropper";

interface AppStateShape {
  currentTool: Tool;
  brushType: BrushType;
  sizeRange: number;
  streamline: number;
  brushSettings: BrushSettings;
  fillSettings: FillOptions;
  zoomText: string;
  layerVersion: number;
  selectionVersion: number;
  docWidth: number;
  docHeight: number;
  /** Selection transform: corner handles keep the aspect ratio. */
  keepProportions: boolean;
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
  zoomText: "100%",
  layerVersion: 0,
  selectionVersion: 0,
  docWidth: 1920,
  docHeight: 1080,
  keepProportions: true,
});

// PressureCurve is not reactive — it's an imperative canvas widget
export const pressureCurve = new PressureCurve();

export function bumpLayerVersion() {
  app.layerVersion++;
}

export function bumpSelectionVersion() {
  app.selectionVersion++;
}
