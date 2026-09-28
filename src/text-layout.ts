/**
 * Text references (pure apart from `drawTextLayout`, which only needs a 2D context).
 *
 * A text layer is a reference whose original is its settings, not a file: the text is laid out in
 * LAYOUT UNITS (1 unit = 1 document px at scale 1) and re-drawn from them at whatever scale its
 * corners give, so it stays sharp. It is there to trace over — ghost type for layout, and optional
 * lettering guide lines (cap height, x-height, baseline) for each line, as a hand letterer rules
 * them.
 */
import { buildName } from "./spine-tags";
import { matrixFromCorners, type Corners, type Pt } from "./ref-placement";
import { clampWeight } from "./font-file";

/** The bundled fonts (SIL OFL, from Fontsource). `family` is the CSS family the package declares. */
export const TEXT_FONTS = [
  { id: "comic-neue-bold", label: "Comic Neue Bold", family: "Comic Neue", weight: 700 },
  { id: "comic-neue", label: "Comic Neue", family: "Comic Neue", weight: 400 },
  { id: "bangers", label: "Bangers", family: "Bangers", weight: 400 },
  { id: "patrick-hand", label: "Patrick Hand", family: "Patrick Hand", weight: 400 },
] as const;
export type TextAlign = "left" | "center" | "right";

export interface TextSpec {
  text: string;
  /** A bundled font's id, or the FAMILY NAME of any other font — one from the user's library, or
   *  one installed on the system. Saved by name, as desktop apps do: the file never travels. */
  font: string;
  /** CSS weight (100–900) and italic, for a family-name font. A bundled id carries its own. */
  weight: number;
  italic: boolean;
  /** Font size in layout units. */
  size: number;
  /** Line pitch as a multiple of `size`. */
  lineHeight: number;
  align: TextAlign;
  /** `#rrggbb`. */
  color: string;
  /** Draw lettering guide lines under each line. */
  guides: boolean;
}

export const DEFAULT_TEXT_SPEC: TextSpec = {
  text: "",
  font: "comic-neue-bold",
  weight: 400,
  italic: false,
  size: 48,
  lineHeight: 1.3,
  align: "center",
  color: "#1a1a1a",
  guides: true,
};

export const TEXT_SIZE_MIN = 4;
export const TEXT_SIZE_MAX = 1000;
export const LINE_HEIGHT_MIN = 0.6;
export const LINE_HEIGHT_MAX = 3;

/** Guide lines are drawn in non-photo blue, the letterer's colour for rules. */
export const GUIDE_COLOR = "#4aa3df";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A spec from untrusted data (a PSD's embedded settings): unknown fields fall back to defaults. */
export function normalizeTextSpec(raw: unknown): TextSpec {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_TEXT_SPEC;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    text: typeof r.text === "string" ? r.text.replace(/\r\n?/g, "\n") : d.text,
    // An unknown name is kept: it is a font this device may not have (yet), not an error.
    font:
      typeof r.font === "string" && r.font.trim() && r.font.length <= 200 ? r.font.trim() : d.font,
    weight: clampWeight(num(r.weight, d.weight)),
    italic: typeof r.italic === "boolean" ? r.italic : d.italic,
    size: clamp(num(r.size, d.size), TEXT_SIZE_MIN, TEXT_SIZE_MAX),
    lineHeight: clamp(num(r.lineHeight, d.lineHeight), LINE_HEIGHT_MIN, LINE_HEIGHT_MAX),
    align: r.align === "left" || r.align === "right" || r.align === "center" ? r.align : d.align,
    color: typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : d.color,
    guides: typeof r.guides === "boolean" ? r.guides : d.guides,
  };
}

/** The bundled font `id` names, if it is one. */
export function bundledFont(id: string) {
  return TEXT_FONTS.find((f) => f.id === id) ?? null;
}

/** A family name as a CSS string, quotes and backslashes escaped. */
export function cssFamily(name: string): string {
  return `"${name.replace(/["\\]/g, "\\$&")}"`;
}

/** The CSS font shorthand for a spec, as `ctx.font` and `document.fonts.load` take it. */
export function fontCss(spec: Pick<TextSpec, "font" | "size" | "weight" | "italic">): string {
  const b = bundledFont(spec.font);
  if (b) return `${b.weight} ${spec.size}px ${cssFamily(b.family)}`;
  return `${spec.italic ? "italic " : ""}${spec.weight} ${spec.size}px ${cssFamily(spec.font)}`;
}

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

/** How a spec's font is listed: a bundled font's label, else family plus weight and italic. */
export function fontLabel(spec: Pick<TextSpec, "font" | "weight" | "italic">): string {
  const b = bundledFont(spec.font);
  if (b) return b.label;
  const style = [WEIGHT_NAMES[clampWeight(spec.weight)], spec.italic ? "Italic" : ""]
    .filter(Boolean)
    .join(" ");
  return style ? `${spec.font} ${style}` : spec.font;
}

/** One key per face: a bundled id, or family + weight + italic. */
export function fontKey(spec: Pick<TextSpec, "font" | "weight" | "italic">): string {
  return bundledFont(spec.font)
    ? spec.font
    : `${spec.font}|${clampWeight(spec.weight)}|${spec.italic ? 1 : 0}`;
}

/** What a text layer's PNG carries: its settings, and its box in layout units — so a layer whose
 *  font is missing can show its saved picture and still be refitted when it's edited. */
export function encodeTextPayload(spec: TextSpec, layout: { width: number; height: number }) {
  return JSON.stringify({ ...spec, box: [layout.width, layout.height] });
}

export function decodeTextPayload(
  json: string,
): { spec: TextSpec; box: [number, number] | null } | null {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const b = raw?.box;
    const box =
      Array.isArray(b) && b.length === 2 && b.every((n) => typeof n === "number" && n > 0)
        ? ([b[0], b[1]] as [number, number])
        : null;
    return { spec: normalizeTextSpec(raw), box };
  } catch {
    return null;
  }
}

/** The font's vertical metrics at the spec's size, in layout units. */
export interface FontMetrics {
  ascent: number;
  descent: number;
  capHeight: number;
  xHeight: number;
}

export type GuideKind = "cap" | "x" | "base";

export interface TextLayout {
  /** The box, padding included, in layout units. */
  width: number;
  height: number;
  /** Each line's left edge and baseline (text is drawn left-aligned at `x`). */
  lines: { text: string; x: number; baseline: number }[];
  /** Horizontal rules across the box, when the spec asks for guides. */
  guides: { y: number; kind: GuideKind }[];
  /** Stroke width for the guides, in layout units. */
  guideWidth: number;
}

/** Room around the text, so guides run past the letters and handles don't sit on them. */
export function textPadding(size: number): number {
  return size * 0.25;
}

/**
 * Lay out `spec` line by line (lines break only where the text has a newline — lettering is broken
 * by hand). `measure` gives a line's advance width at the spec's size. Empty lines keep their
 * place, so blank ruled lines can be left for lettering.
 */
export function layoutText(
  spec: TextSpec,
  measure: (line: string) => number,
  m: FontMetrics,
): TextLayout {
  const pad = textPadding(spec.size);
  const texts = spec.text.split("\n");
  const widths = texts.map((t) => (t ? measure(t) : 0));
  // An empty or tiny text still gets a box to grab (and a ruled line to letter on).
  const contentW = Math.max(spec.size * 2, ...widths);
  const pitch = spec.size * spec.lineHeight;
  const lines = texts.map((text, i) => {
    const w = widths[i];
    const x =
      spec.align === "left"
        ? pad
        : spec.align === "right"
          ? pad + contentW - w
          : pad + (contentW - w) / 2;
    return { text, x, baseline: pad + m.ascent + i * pitch };
  });
  const guides: TextLayout["guides"] = [];
  if (spec.guides) {
    for (const l of lines) {
      guides.push({ y: l.baseline - m.capHeight, kind: "cap" });
      guides.push({ y: l.baseline - m.xHeight, kind: "x" });
      guides.push({ y: l.baseline, kind: "base" });
    }
  }
  return {
    width: contentW + pad * 2,
    height: pad * 2 + m.ascent + m.descent + (texts.length - 1) * pitch,
    lines,
    guides,
    guideWidth: Math.max(0.5, spec.size / 36),
  };
}

/** Draw a laid-out text into `ctx`, whose transform maps layout units to its pixels. Guides go
 *  under the letters; the x-height rule is dashed so the three read apart. */
export function drawTextLayout(ctx: CanvasRenderingContext2D, spec: TextSpec, layout: TextLayout) {
  ctx.save();
  if (layout.guides.length) {
    ctx.strokeStyle = GUIDE_COLOR;
    ctx.lineWidth = layout.guideWidth;
    for (const g of layout.guides) {
      ctx.setLineDash(g.kind === "x" ? [spec.size / 6, spec.size / 10] : []);
      ctx.beginPath();
      ctx.moveTo(0, g.y);
      ctx.lineTo(layout.width, g.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.fillStyle = spec.color;
  ctx.font = fontCss(spec);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (const l of layout.lines) if (l.text) ctx.fillText(l.text, l.x, l.baseline);
  ctx.restore();
}

/**
 * Where a text's box goes after an edit changed its size: the same scale, rotation and flip as
 * `corners` (which hold the OLD box, `oldW × oldH` layout units), the top kept, and horizontally
 * anchored by alignment — the left edge for left-aligned text, the centre for centred, the right
 * edge for right-aligned — so a balloon's centred text grows from its middle.
 */
export function refitCorners(
  corners: Corners,
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
  align: TextAlign,
): Corners {
  const m = matrixFromCorners(oldW, oldH, corners);
  const dx = align === "left" ? 0 : align === "right" ? oldW - newW : (oldW - newW) / 2;
  const at = (x: number, y: number): Pt => ({
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  });
  return [at(dx, 0), at(dx + newW, 0), at(dx + newW, newH), at(dx, newH)];
}

/** Name for a text layer: `[ignore]` so Spine's PSD import skips it, "text" and its first words. */
export function textLayerName(text: string): string {
  const first =
    text
      .split("\n")
      .find((l) => l.trim())
      ?.trim() ?? "";
  const words = first.length > 24 ? `${first.slice(0, 24).trimEnd()}…` : first;
  return buildName(words ? `text ${words}` : "text", ["ignore"]);
}
