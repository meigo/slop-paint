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
import type { Mat } from "./selection";
import {
  JITTER_MAX,
  NO_JITTER,
  charMatrix,
  charTransform,
  hasJitter,
  type JitterAmounts,
} from "./text-jitter";

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
  /** Extra room between letters, as a fraction of `size` (negative tightens). */
  spacing: number;
  align: TextAlign;
  /** `#rrggbb`. */
  color: string;
  /** Draw lettering guide lines under each line. */
  guides: boolean;
  /** Randomise: each character's jitter comes from this seed and its index (`text-jitter.ts`). */
  seed: number;
  jitter: JitterAmounts;
}

export const DEFAULT_TEXT_SPEC: TextSpec = {
  text: "",
  font: "comic-neue-bold",
  weight: 400,
  italic: false,
  size: 48,
  lineHeight: 1.3,
  spacing: 0,
  align: "center",
  color: "#1a1a1a",
  guides: true,
  seed: 0,
  jitter: NO_JITTER,
};

export const TEXT_SIZE_MIN = 4;
export const TEXT_SIZE_MAX = 1000;
export const LINE_HEIGHT_MIN = 0.6;
export const LINE_HEIGHT_MAX = 3;
export const SPACING_MIN = -0.5;
export const SPACING_MAX = 1;

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
    spacing: clamp(num(r.spacing, d.spacing), SPACING_MIN, SPACING_MAX),
    align: r.align === "left" || r.align === "right" || r.align === "center" ? r.align : d.align,
    color: typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : d.color,
    guides: typeof r.guides === "boolean" ? r.guides : d.guides,
    seed:
      typeof r.seed === "number" && Number.isInteger(r.seed) && r.seed >= 0 && r.seed < 2 ** 32
        ? r.seed
        : d.seed,
    jitter: normalizeJitter(r.jitter),
  };
}

function normalizeJitter(raw: unknown): JitterAmounts {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const amount = (k: keyof JitterAmounts) => {
    const v = r[k];
    return typeof v === "number" && Number.isFinite(v) ? clamp(v, 0, JITTER_MAX[k]) : 0;
  };
  return {
    rotate: amount("rotate"),
    scale: amount("scale"),
    offset: amount("offset"),
    skew: amount("skew"),
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

/** What a text layer's PNG carries: its settings, and its box and jitter margin in layout units —
 *  so a layer whose font is missing can show its saved picture and still be refitted when it's
 *  edited. */
export function encodeTextPayload(
  spec: TextSpec,
  layout: { width: number; height: number; margin?: TextMargin },
) {
  const m = layout.margin ?? NO_MARGIN;
  return JSON.stringify({
    ...spec,
    box: [layout.width, layout.height],
    margin: [m.left, m.top, m.right, m.bottom],
  });
}

export function decodeTextPayload(
  json: string,
): { spec: TextSpec; box: [number, number] | null; margin: TextMargin } | null {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const b = raw?.box;
    const box =
      Array.isArray(b) && b.length === 2 && b.every((n) => typeof n === "number" && n > 0)
        ? ([b[0], b[1]] as [number, number])
        : null;
    const g = raw?.margin;
    const margin =
      Array.isArray(g) && g.length === 4 && g.every((n) => typeof n === "number" && n >= 0)
        ? { left: g[0], top: g[1], right: g[2], bottom: g[3] }
        : NO_MARGIN;
    return { spec: normalizeTextSpec(raw), box, margin };
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

/** A character's ink box about its pen position at the baseline, as `measureText`'s
 *  `actualBoundingBox*` (left and ascent measured leftwards and upwards). */
export interface InkBox {
  left: number;
  right: number;
  ascent: number;
  descent: number;
}

export type GuideKind = "cap" | "x" | "base";

/** Room added round the text so jittered letters aren't cut off, in layout units. */
export interface TextMargin {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const NO_MARGIN: TextMargin = { left: 0, top: 0, right: 0, bottom: 0 };

export interface TextLayout {
  /** The box, padding included, in layout units. */
  width: number;
  height: number;
  /** Each line's left edge and baseline (text is drawn left-aligned at `x`). */
  lines: { text: string; x: number; baseline: number }[];
  /** With jitter or letter spacing, the text is drawn character by character instead of by
   *  line: each one at its pen position (`x`, `y`) under its own matrix `m`. Null without. */
  glyphs: { text: string; x: number; y: number; m: Mat }[] | null;
  /** How much the box grew to hold the jittered letters (already in `width` / `height`). */
  margin: TextMargin;
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
 * place, so blank ruled lines can be left for lettering. Letter spacing goes between characters
 * (not after the last). With jitter, `ink` gives a character's ink box (each one turns about its
 * centre; without it, the advance box stands in).
 */
export function layoutText(
  spec: TextSpec,
  measure: (line: string) => number,
  m: FontMetrics,
  ink?: (char: string) => InkBox,
): TextLayout {
  const pad = textPadding(spec.size);
  const texts = spec.text.split("\n");
  const gap = spec.spacing * spec.size;
  const widths = texts.map((t) => (t ? measure(t) + (graphemes(t).length - 1) * gap : 0));
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
  const layout: TextLayout = {
    width: contentW + pad * 2,
    height: pad * 2 + m.ascent + m.descent + (texts.length - 1) * pitch,
    lines,
    glyphs: null,
    margin: NO_MARGIN,
    guides,
    guideWidth: Math.max(0.5, spec.size / 36),
  };
  return hasJitter(spec.jitter) || gap !== 0 ? withGlyphs(layout, spec, measure, m, ink) : layout;
}

/** Characters as the reader sees them (an accented letter or an emoji is one). */
const graphemes = (s: string): string[] =>
  Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s),
    (x) => x.segment,
  );

/**
 * `layout` drawn character by character, each jittered by `charTransform`. A character sits where
 * the line's text before it ends (`measure` of the prefix, so kerning keeps its place) plus the
 * letter spacing once per character before it, and turns
 * about the centre of its ink box. The index counts characters across the whole text, newlines
 * included, so editing one line doesn't re-roll the others. The box grows wherever a letter now
 * comes within half the padding of an edge.
 */
function withGlyphs(
  layout: TextLayout,
  spec: TextSpec,
  measure: (line: string) => number,
  m: FontMetrics,
  ink: ((char: string) => InkBox) | undefined,
): TextLayout {
  const glyphs: NonNullable<TextLayout["glyphs"]> = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let index = 0;
  for (const line of layout.lines) {
    let prefix = "";
    let k = 0;
    for (const ch of graphemes(line.text)) {
      const i = index++;
      const x = line.x + (prefix ? measure(prefix) : 0) + k++ * spec.spacing * spec.size;
      prefix += ch;
      if (!ch.trim()) continue;
      const box = ink?.(ch) ?? {
        left: 0,
        right: measure(ch),
        ascent: m.ascent,
        descent: m.descent,
      };
      const x0 = x - box.left;
      const x1 = x + box.right;
      const y0 = line.baseline - box.ascent;
      const y1 = line.baseline + box.descent;
      const t = charTransform(spec.seed, i, spec.jitter, spec.size);
      const mat = charMatrix(t, (x0 + x1) / 2, (y0 + y1) / 2);
      for (const [px, py] of [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ]) {
        const qx = mat.a * px + mat.c * py + mat.e;
        const qy = mat.b * px + mat.d * py + mat.f;
        minX = Math.min(minX, qx);
        maxX = Math.max(maxX, qx);
        minY = Math.min(minY, qy);
        maxY = Math.max(maxY, qy);
      }
      glyphs.push({ text: ch, x, y: line.baseline, m: mat });
    }
    index++; // the newline
  }
  if (!glyphs.length) return layout;
  const keep = textPadding(spec.size) / 2;
  const margin: TextMargin = {
    left: Math.max(0, keep - minX),
    top: Math.max(0, keep - minY),
    right: Math.max(0, maxX - (layout.width - keep)),
    bottom: Math.max(0, maxY - (layout.height - keep)),
  };
  const dx = margin.left;
  const dy = margin.top;
  return {
    ...layout,
    width: layout.width + margin.left + margin.right,
    height: layout.height + margin.top + margin.bottom,
    lines: layout.lines.map((l) => ({ ...l, x: l.x + dx, baseline: l.baseline + dy })),
    guides: layout.guides.map((g) => ({ ...g, y: g.y + dy })),
    // The glyphs keep their pen positions; the shift goes into each matrix.
    glyphs: glyphs.map((g) => ({ ...g, m: { ...g.m, e: g.m.e + dx, f: g.m.f + dy } })),
    margin,
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
  if (layout.glyphs) {
    for (const g of layout.glyphs) {
      ctx.save();
      ctx.transform(g.m.a, g.m.b, g.m.c, g.m.d, g.m.e, g.m.f);
      ctx.fillText(g.text, g.x, g.y);
      ctx.restore();
    }
  } else {
    for (const l of layout.lines) if (l.text) ctx.fillText(l.text, l.x, l.baseline);
  }
  ctx.restore();
}

/**
 * Where a text's box goes after an edit changed its size: the same scale, rotation and flip as
 * `corners` (which hold the OLD box, `oldW × oldH` layout units), the top kept, and horizontally
 * anchored by alignment — the left edge for left-aligned text, the centre for centred, the right
 * edge for right-aligned — so a balloon's centred text grows from its middle. The edges are the
 * box's without its jitter margin, so changing the jitter doesn't move the text.
 */
export function refitCorners(
  corners: Corners,
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
  align: TextAlign,
  oldMargin: TextMargin = NO_MARGIN,
  newMargin: TextMargin = NO_MARGIN,
): Corners {
  const m = matrixFromCorners(oldW, oldH, corners);
  // The un-jittered box's anchor, in each box's own units.
  const anchor = (w: number, g: TextMargin) => {
    const inner = w - g.left - g.right;
    return g.left + (align === "left" ? 0 : align === "right" ? inner : inner / 2);
  };
  const dx = anchor(oldW, oldMargin) - anchor(newW, newMargin);
  const dy = oldMargin.top - newMargin.top;
  const at = (x: number, y: number): Pt => ({
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  });
  return [at(dx, dy), at(dx + newW, dy), at(dx + newW, dy + newH), at(dx, dy + newH)];
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
