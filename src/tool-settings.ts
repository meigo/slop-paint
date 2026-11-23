import type { BrushKind } from "./appState.svelte";
import { clampPress } from "./brush";
import type { CurvePoint } from "./pressure-curve";

/** Stroke settings that brush, eraser and Blend each keep their own copy of. */
export interface StrokeSlot {
  brushType: BrushKind;
  size: number;
  opacity: number;
  smoothing: number;
  streamline: number;
  sizeRange: number;
}

export type SlotName = "brush" | "eraser" | "blend";

/** The live settings the toolbar binds to (a subset of AppStateShape). */
export interface LiveStroke {
  brushType: BrushKind;
  sizeRange: number;
  streamline: number;
  brushSettings: { size: number; opacity: number; smoothing: number };
}

/** The eraser and Blend have their own slots; every other tool draws with (or shows) the brush's. */
export function slotFor(tool: string): SlotName {
  return tool === "eraser" || tool === "blend" ? tool : "brush";
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

/** The brush types a brush or eraser slot can hold ("blend" is a tool, not one of them). */
export type PaintType = Exclude<BrushKind, "blend">;
export const PAINT_TYPES: PaintType[] = [
  "smooth",
  "ink",
  "calligraphy",
  "dry",
  "watercolor",
  "pencil",
  "charcoal",
  "airbrush",
];

/** A pressure curve's two control points (a `PressureCurve` is one; rebuild its LUT after). */
export interface CurvePair {
  cp1: CurvePoint;
  cp2: CurvePoint;
}

/** What each BRUSH type keeps of its own (2026-11-23): Ink and Watercolour want different sizes,
 *  Stream and curves, and retuning them on every switch was a chore. Colour, Draw behind and
 *  Alpha lock stay shared; the eraser and Blend keep one set each. */
export type TypeSettings = Omit<StrokeSlot, "brushType"> & { curve: CurvePair };
export type TypeStore = Record<PaintType, TypeSettings>;

export function typeSettingsOf(slot: StrokeSlot, curve: CurvePair): TypeSettings {
  return {
    size: slot.size,
    opacity: slot.opacity,
    smoothing: slot.smoothing,
    streamline: slot.streamline,
    sizeRange: slot.sizeRange,
    curve: { cp1: { ...curve.cp1 }, cp2: { ...curve.cp2 } },
  };
}

/** Every type starting from the same values (the brush's, before types had their own). */
export function seedTypes(slot: StrokeSlot, curve: CurvePair): TypeStore {
  const out = {} as TypeStore;
  for (const t of PAINT_TYPES) out[t] = typeSettingsOf(slot, curve);
  return out;
}

/**
 * The brush's type changes: park the live values (and curve) under the outgoing type and load the
 * incoming type's. Only for the brush's slot; the eraser's type change keeps its values. The
 * caller rebuilds the curve's LUT.
 */
export function switchType(live: LiveStroke, curve: CurvePair, store: TypeStore, to: PaintType) {
  const from = live.brushType;
  if (from === to) return;
  if (from !== "blend") store[from] = typeSettingsOf(readSlot(live), curve);
  const next = store[to];
  writeSlot(live, {
    brushType: to,
    size: next.size,
    opacity: next.opacity,
    smoothing: next.smoothing,
    streamline: next.streamline,
    sizeRange: next.sizeRange,
  });
  curve.cp1 = { ...next.curve.cp1 };
  curve.cp2 = { ...next.curve.cp2 };
}

/** The store for saving, with the brush's own current values folded in under its type. */
export function typesForSave(store: TypeStore, brush: StrokeSlot, curve: CurvePair): TypeStore {
  if (brush.brushType === "blend") return store;
  return { ...store, [brush.brushType]: typeSettingsOf(brush, curve) };
}

function parsePoint(raw: unknown, fallback: CurvePoint): CurvePoint {
  if (!raw || typeof raw !== "object") return fallback;
  const { x, y } = raw as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number") return fallback;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

/** Saved per-type settings, each type and field checked; anything missing keeps the fallback. */
export function parseTypes(raw: unknown, fallback: TypeStore): TypeStore {
  const out = { ...fallback };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const t of PAINT_TYPES) {
    const v = r[t];
    if (!v || typeof v !== "object") continue;
    const base = fallback[t];
    const slot = parseSlot(v, { ...base, brushType: t });
    const c = (v as Record<string, unknown>).curve as Record<string, unknown> | undefined;
    out[t] = typeSettingsOf(slot, {
      cp1: parsePoint(c?.cp1, base.curve.cp1),
      cp2: parsePoint(c?.cp2, base.curve.cp2),
    });
  }
  return out;
}

/** Accept a saved slot only if every field has the right type; otherwise keep the fallback. */
export function parseSlot(raw: unknown, fallback: StrokeSlot): StrokeSlot {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const out = { ...fallback };
  // No "blend": it is a tool, not a type (App draws the Blend tool's strokes as Blend whatever its
  // slot holds), so a saved brush or eraser slot can't turn into it.
  if (PAINT_TYPES.includes(r.brushType as PaintType)) out.brushType = r.brushType as PaintType;
  for (const k of ["size", "opacity", "smoothing", "streamline", "sizeRange"] as const) {
    if (typeof r[k] === "number" && Number.isFinite(r[k])) out[k] = r[k];
  }
  out.sizeRange = clampPress(out.sizeRange);
  return out;
}
