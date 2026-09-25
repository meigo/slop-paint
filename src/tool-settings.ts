import type { BrushKind } from "./appState.svelte";
import { clampPress } from "./brush";

/** Stroke settings that brush and eraser each keep their own copy of. */
export interface StrokeSlot {
  brushType: BrushKind;
  size: number;
  opacity: number;
  smoothing: number;
  streamline: number;
  sizeRange: number;
}

export type SlotName = "brush" | "eraser";

/** The live settings the toolbar binds to (a subset of AppStateShape). */
export interface LiveStroke {
  brushType: BrushKind;
  sizeRange: number;
  streamline: number;
  brushSettings: { size: number; opacity: number; smoothing: number };
}

/** The eraser has its own slot; every other tool draws with (or shows) the brush slot. */
export function slotFor(tool: string): SlotName {
  return tool === "eraser" ? "eraser" : "brush";
}

export function readSlot(live: LiveStroke): StrokeSlot {
  return {
    brushType: live.brushType,
    size: live.brushSettings.size,
    opacity: live.brushSettings.opacity,
    smoothing: live.brushSettings.smoothing,
    streamline: live.streamline,
    sizeRange: live.sizeRange,
  };
}

export function writeSlot(live: LiveStroke, slot: StrokeSlot) {
  live.brushType = slot.brushType;
  live.brushSettings.size = slot.size;
  live.brushSettings.opacity = slot.opacity;
  live.brushSettings.smoothing = slot.smoothing;
  live.streamline = slot.streamline;
  live.sizeRange = slot.sizeRange;
}

/**
 * On a tool change that crosses brush ↔ eraser, park the live values in the outgoing tool's slot
 * and load the incoming tool's. `slots` holds the INACTIVE tool's values; the active tool's
 * values live in `live` (so existing toolbar bindings keep working unchanged).
 */
export function swapSlots(
  live: LiveStroke,
  slots: Record<SlotName, StrokeSlot>,
  fromTool: string,
  toTool: string,
) {
  const from = slotFor(fromTool);
  const to = slotFor(toTool);
  if (from === to) return;
  slots[from] = readSlot(live);
  writeSlot(live, slots[to]);
}

/** Both slots with the live values folded in — for saving. */
export function allSlots(
  live: LiveStroke,
  slots: Record<SlotName, StrokeSlot>,
  activeTool: string,
): Record<SlotName, StrokeSlot> {
  return { ...slots, [slotFor(activeTool)]: readSlot(live) };
}

/** Accept a saved slot only if every field has the right type; otherwise keep the fallback. */
export function parseSlot(raw: unknown, fallback: StrokeSlot): StrokeSlot {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const out = { ...fallback };
  const types: BrushKind[] = ["smooth", "ink", "calligraphy", "pencil", "charcoal", "airbrush"];
  if (types.includes(r.brushType as BrushKind)) out.brushType = r.brushType as BrushKind;
  for (const k of ["size", "opacity", "smoothing", "streamline", "sizeRange"] as const) {
    if (typeof r[k] === "number" && Number.isFinite(r[k])) out[k] = r[k];
  }
  out.sizeRange = clampPress(out.sizeRange);
  return out;
}
