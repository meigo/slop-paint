import { describe, it, expect } from "vitest";
import {
  DEFAULT_TEXT_SPEC,
  TEXT_SIZE_MAX,
  fontCss,
  layoutText,
  normalizeTextSpec,
  refitCorners,
  textLayerName,
  textPadding,
  type TextSpec,
} from "../text-layout";
import { cornersFromRect, type Corners } from "../ref-placement";
import { parseTags } from "../spine-tags";

const M = { ascent: 40, descent: 10, capHeight: 30, xHeight: 20 };
/** 10 units per character. */
const measure = (s: string) => s.length * 10;
const spec = (p: Partial<TextSpec>): TextSpec => ({ ...DEFAULT_TEXT_SPEC, size: 40, ...p });

describe("layoutText", () => {
  it("sizes the box from the widest line, padded", () => {
    const l = layoutText(spec({ text: "abcdefghij\nab", lineHeight: 1.5 }), measure, M);
    const pad = textPadding(40);
    expect(l.width).toBe(100 + 2 * pad);
    expect(l.height).toBe(2 * pad + 40 + 10 + 60);
    expect(l.lines.map((x) => x.baseline)).toEqual([pad + 40, pad + 100]);
  });

  it("aligns each line within the widest", () => {
    const text = "abcdefghij\nab";
    const pad = textPadding(40);
    const x = (align: TextSpec["align"]) =>
      layoutText(spec({ text, align }), measure, M).lines.map((l) => l.x);
    expect(x("left")).toEqual([pad, pad]);
    expect(x("center")).toEqual([pad, pad + 40]);
    expect(x("right")).toEqual([pad, pad + 80]);
  });

  it("gives empty text a box and a line", () => {
    const l = layoutText(spec({ text: "" }), measure, M);
    expect(l.width).toBe(80 + 2 * textPadding(40));
    expect(l.lines).toHaveLength(1);
  });

  it("rules cap, x-height and baseline for every line, blank ones included", () => {
    const l = layoutText(spec({ text: "ab\n\ncd", guides: true }), measure, M);
    expect(l.guides).toHaveLength(9);
    const b = l.lines[1].baseline;
    expect(l.guides.slice(3, 6)).toEqual([
      { y: b - 30, kind: "cap" },
      { y: b - 20, kind: "x" },
      { y: b, kind: "base" },
    ]);
  });

  it("draws no guides when they are off", () => {
    expect(layoutText(spec({ text: "ab", guides: false }), measure, M).guides).toEqual([]);
  });
});

describe("refitCorners", () => {
  const box = cornersFromRect({ x: 100, y: 50, w: 200, h: 80 });

  it("keeps the left edge for left-aligned text", () => {
    expect(refitCorners(box, 200, 80, 300, 120, "left")).toEqual(
      cornersFromRect({ x: 100, y: 50, w: 300, h: 120 }),
    );
  });

  it("keeps the centre for centred text, and the right edge for right-aligned", () => {
    expect(refitCorners(box, 200, 80, 100, 80, "center")).toEqual(
      cornersFromRect({ x: 150, y: 50, w: 100, h: 80 }),
    );
    expect(refitCorners(box, 200, 80, 100, 80, "right")).toEqual(
      cornersFromRect({ x: 200, y: 50, w: 100, h: 80 }),
    );
  });

  it("keeps the placement's scale and rotation", () => {
    // Twice the size, turned 90° clockwise: the box's top edge runs down the page.
    const turned: Corners = [
      { x: 500, y: 0 },
      { x: 500, y: 400 },
      { x: 340, y: 400 },
      { x: 340, y: 0 },
    ];
    const out = refitCorners(turned, 200, 80, 100, 80, "left");
    expect(out[0]).toEqual({ x: 500, y: 0 });
    expect(out[1]).toEqual({ x: 500, y: 200 });
    expect(out[3]).toEqual({ x: 340, y: 0 });
  });
});

describe("normalizeTextSpec", () => {
  it("keeps a valid spec", () => {
    const s = spec({ text: "hi", align: "left", color: "#ff0000", guides: false });
    expect(normalizeTextSpec(s)).toEqual(s);
  });

  it("falls back or clamps what it can't use", () => {
    const s = normalizeTextSpec({
      text: "a\r\nb",
      font: "wingdings",
      size: 99999,
      lineHeight: "x",
      align: "justify",
      color: "red",
      guides: 1,
    });
    expect(s).toEqual({
      ...DEFAULT_TEXT_SPEC,
      text: "a\nb",
      size: TEXT_SIZE_MAX,
    });
    expect(normalizeTextSpec(null)).toEqual(DEFAULT_TEXT_SPEC);
  });
});

describe("fontCss", () => {
  it("names weight, size and family", () => {
    expect(fontCss({ font: "comic-neue-bold", size: 32 })).toBe('700 32px "Comic Neue"');
    expect(fontCss({ font: "bangers", size: 10 })).toBe('400 10px "Bangers"');
  });
});

describe("textLayerName", () => {
  it("is ignored by Spine and names the first words", () => {
    const n = textLayerName("\n  Hello there  \nsecond");
    expect(parseTags(n).tags).toEqual(["ignore"]);
    expect(parseTags(n).baseName).toBe("text Hello there");
  });

  it("shortens long text and handles empty", () => {
    expect(parseTags(textLayerName("x".repeat(40))).baseName).toBe(`text ${"x".repeat(24)}…`);
    expect(parseTags(textLayerName("")).baseName).toBe("text");
  });
});
