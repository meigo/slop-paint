/**
 * Layer blend modes (pure). A layer stores its mode by its PHOTOSHOP name (`Layer.blend`, absent =
 * normal), so a PSD round-trips it as written; the canvas draws it through `canvasOp`.
 *
 * The menu offers five: Normal, Multiply, Screen, Overlay and Add (Photoshop's Linear Dodge) —
 * Normal, Multiply, Screen and Add are also Spine's slot blend modes. A PSD from elsewhere may bring
 * another mode: it's kept and shown by name, drawn when the canvas has it, else drawn as normal.
 */

export interface BlendChoice {
  /** Photoshop's name, as ag-psd reads and writes it. */
  psd: string;
  label: string;
}

export const BLEND_MODES: readonly BlendChoice[] = [
  { psd: "normal", label: "Normal" },
  { psd: "multiply", label: "Multiply" },
  { psd: "screen", label: "Screen" },
  { psd: "overlay", label: "Overlay" },
  { psd: "linear dodge", label: "Add" },
];

/** Photoshop modes the canvas can draw, by Photoshop name. */
const CANVAS_OPS: Record<string, GlobalCompositeOperation> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  "linear dodge": "lighter",
  darken: "darken",
  lighten: "lighten",
  "color dodge": "color-dodge",
  "color burn": "color-burn",
  "hard light": "hard-light",
  "soft light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};

/** How the canvas draws a layer in `mode` (absent = normal). A mode the canvas lacks (dissolve,
 *  linear burn, vivid light…) draws as normal — the layer keeps its mode for the PSD. */
export function canvasOp(mode: string | undefined): GlobalCompositeOperation {
  return (mode && CANVAS_OPS[mode]) || "source-over";
}

/** Whether the canvas can draw `mode` as itself. */
export function canDraw(mode: string | undefined): boolean {
  return !mode || mode in CANVAS_OPS;
}

/** The menu's label: one of the five, or a PSD's own mode by its name ("Soft light"). */
export function blendLabel(mode: string | undefined): string {
  const m = mode || "normal";
  const known = BLEND_MODES.find((b) => b.psd === m);
  if (known) return known.label;
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/** A mode read from a PSD, as a layer stores it: `undefined` for normal (and the group-only "pass
 *  through", which a layer can't use), else the name. */
export function layerBlendFromPsd(mode: string | undefined): string | undefined {
  return !mode || mode === "normal" || mode === "pass through" ? undefined : mode;
}
