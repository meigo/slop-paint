import { describe, it, expect } from "vitest";
import {
  DEFAULT_TEXT_SPEC,
  TEXT_SIZE_MAX,
  decodeTextPayload,
  encodeTextPayload,
  fontCss,
  fontKey,
  fontLabel,
  layoutText,
  normalizeTextSpec,
  refitCorners,
  textLayerName,
  textPadding,
  NO_MARGIN,
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

describe("layoutText with letter spacing", () => {
  it("adds the spacing between letters, not after the last, and widens the line by it", () => {
    // 10% of size 40 = 4 units after each of the first 7 of 8 letters.
    const l = layoutText(spec({ text: "abcdefgh", spacing: 0.1, align: "left" }), measure, M);
    const x = l.lines[0].x;
    expect(l.glyphs!.map((g) => g.x - x)).toEqual([0, 14, 28, 42, 56, 70, 84, 98]);
    expect(l.width).toBe(108 + 2 * textPadding(40) + l.margin.left + l.margin.right);
  });

  it("aligns by the spaced width", () => {
    const l = layoutText(spec({ text: "abcdefghij\nab", spacing: 0.1 }), measure, M);
    // Line 1 is 100 + 9 × 4 = 136 wide, line 2 is 20 + 4 = 24: centred 56 in.
    expect(l.lines[1].x - l.lines[0].x).toBe(56);
  });

  it("tightens with a negative spacing, and leaves the letters upright", () => {
    const l = layoutText(spec({ text: "ab", spacing: -0.25 }), measure, M);
    expect(l.glyphs![1].x - l.glyphs![0].x).toBe(0);
    expect(l.glyphs![0].m).toEqual({ a: 1, b: 0, c: 0, d: 1, e: l.margin.left, f: l.margin.top });
  });

  it("draws by line at 0", () => {
    expect(layoutText(spec({ text: "ab" }), measure, M).glyphs).toBeNull();
  });
});

describe("layoutText with jitter", () => {
  const J = { rotate: 20, scale: 0.2, offset: 0.2, skew: 10 };
  /** Every letter inks its whole advance box, cap height tall. */
  const ink = (ch: string) => ({ left: 0, right: measure(ch), ascent: 30, descent: 0 });

  it("draws by line, with no margin, when every amount is zero", () => {
    const l = layoutText(spec({ text: "abc", seed: 9 }), measure, M, ink);
    expect(l.glyphs).toBeNull();
    expect(l.margin).toEqual(NO_MARGIN);
  });

  it("places each letter where the text before it ends, skipping spaces", () => {
    const l = layoutText(spec({ text: "ab c", jitter: J, seed: 3 }), measure, M, ink);
    const x = l.lines[0].x;
    expect(l.glyphs!.map((g) => [g.text, g.x - x])).toEqual([
      ["a", 0],
      ["b", 10],
      ["c", 30],
    ]);
  });

  it("keeps an accented letter or an emoji in one piece", () => {
    const l = layoutText(spec({ text: "e\u0301👍🏽", jitter: J }), measure, M, ink);
    expect(l.glyphs!.map((g) => g.text)).toEqual(["e\u0301", "👍🏽"]);
  });

  it("doesn't re-roll a line when another line is edited", () => {
    const a = layoutText(spec({ text: "abc\nxyz", jitter: J, seed: 5 }), measure, M, ink);
    const b = layoutText(spec({ text: "abc\nxyzzy", jitter: J, seed: 5 }), measure, M, ink);
    const rel = (l: typeof a) =>
      l.glyphs!.slice(0, 3).map((g) => [g.m.a, g.m.b, g.m.c, g.m.d, g.m.e - l.margin.left]);
    expect(rel(b)).toEqual(rel(a));
  });

  it("grows the box so no letter reaches past half the padding", () => {
    const s = spec({ text: "abcdefghij", jitter: { ...J, rotate: 45, scale: 0.5 }, seed: 11 });
    // Letters as tall as the font's box, so a turned one must poke out of it.
    const tall = (ch: string) => ({ left: 0, right: measure(ch), ascent: 40, descent: 10 });
    const l = layoutText(s, measure, M, tall);
    const plain = layoutText(
      { ...s, jitter: { rotate: 0, scale: 0, offset: 0, skew: 0 } },
      measure,
      M,
    );
    const g = l.margin;
    expect(g.left + g.top + g.right + g.bottom).toBeGreaterThan(0);
    expect(l.width).toBeCloseTo(plain.width + g.left + g.right);
    expect(l.height).toBeCloseTo(plain.height + g.top + g.bottom);
    const keep = textPadding(40) / 2 - 1e-9;
    for (const gl of l.glyphs!) {
      const w = measure(gl.text);
      for (const [px, py] of [
        [gl.x, gl.y - 40],
        [gl.x + w, gl.y - 40],
        [gl.x + w, gl.y + 10],
        [gl.x, gl.y + 10],
      ]) {
        const qx = gl.m.a * px + gl.m.c * py + gl.m.e;
        const qy = gl.m.b * px + gl.m.d * py + gl.m.f;
        expect(qx).toBeGreaterThanOrEqual(keep);
        expect(qy).toBeGreaterThanOrEqual(keep);
        expect(qx).toBeLessThanOrEqual(l.width - keep);
        expect(qy).toBeLessThanOrEqual(l.height - keep);
      }
    }
    // Lines and guides move with the margin, so the rules stay under the text.
    expect(l.lines[0].baseline).toBeCloseTo(plain.lines[0].baseline + g.top);
    expect(l.guides[2].y).toBeCloseTo(plain.guides[2].y + g.top);
  });

  it("changes with the seed", () => {
    const at = (seed: number) =>
      layoutText(spec({ text: "abc", jitter: J, seed }), measure, M, ink).glyphs![1].m;
    expect(at(1)).not.toEqual(at(2));
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

  it("keeps the text in place when only the jitter margin changes", () => {
    const g = { left: 10, top: 6, right: 4, bottom: 8 };
    for (const align of ["left", "center", "right"] as const) {
      expect(refitCorners(box, 200, 80, 214, 94, align, NO_MARGIN, g)).toEqual(
        cornersFromRect({ x: 90, y: 44, w: 214, h: 94 }),
      );
    }
  });

  it("anchors centred text on the box without its margin", () => {
    // Was 200 wide with no margin; now 100 of text plus a 20 margin on the left only.
    expect(
      refitCorners(box, 200, 80, 120, 80, "center", NO_MARGIN, { ...NO_MARGIN, left: 20 }),
    ).toEqual(cornersFromRect({ x: 130, y: 50, w: 120, h: 80 }));
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
      font: 42,
      size: 99999,
      lineHeight: "x",
      align: "justify",
      color: "red",
      guides: 1,
      weight: 1234,
      italic: "yes",
    });
    expect(s).toEqual({
      ...DEFAULT_TEXT_SPEC,
      text: "a\nb",
      size: TEXT_SIZE_MAX,
      weight: 900,
    });
    expect(normalizeTextSpec(null)).toEqual(DEFAULT_TEXT_SPEC);
  });

  it("keeps a font name it doesn't know — this device may just not have it", () => {
    const s = normalizeTextSpec({ font: " Komika Axis ", weight: 700, italic: true });
    expect(s.font).toBe("Komika Axis");
    expect(s.weight).toBe(700);
    expect(s.italic).toBe(true);
    expect(normalizeTextSpec({ font: "" }).font).toBe(DEFAULT_TEXT_SPEC.font);
    expect(normalizeTextSpec({ font: "x".repeat(201) }).font).toBe(DEFAULT_TEXT_SPEC.font);
  });

  it("keeps a valid seed and jitter, and clamps or drops a bad one", () => {
    const s = normalizeTextSpec({
      seed: 123,
      jitter: { rotate: 10, scale: 0.1, offset: 0, skew: 5 },
    });
    expect(s.seed).toBe(123);
    expect(s.jitter).toEqual({ rotate: 10, scale: 0.1, offset: 0, skew: 5 });
    const bad = normalizeTextSpec({ seed: -1, jitter: { rotate: 999, scale: "x", skew: -3 } });
    expect(bad.seed).toBe(0);
    expect(bad.jitter).toEqual({ rotate: 45, scale: 0, offset: 0, skew: 0 });
    expect(normalizeTextSpec({ seed: 1.5 }).seed).toBe(0);
    expect(normalizeTextSpec({ seed: 2 ** 32 }).seed).toBe(0);
  });

  it("clamps letter spacing, and reads files saved before it as 0", () => {
    expect(normalizeTextSpec({ spacing: 0.2 }).spacing).toBe(0.2);
    expect(normalizeTextSpec({ spacing: 9 }).spacing).toBe(1);
    expect(normalizeTextSpec({ spacing: -9 }).spacing).toBe(-0.5);
    expect(normalizeTextSpec({ text: "old" }).spacing).toBe(0);
  });

  it("reads files saved before the randomiser as unjittered", () => {
    const s = normalizeTextSpec({ font: "bangers", text: "hi" });
    expect(s.seed).toBe(0);
    expect(s.jitter).toEqual(DEFAULT_TEXT_SPEC.jitter);
  });

  it("reads files saved before fonts had a weight", () => {
    const s = normalizeTextSpec({ font: "bangers", text: "hi" });
    expect(s.weight).toBe(400);
    expect(s.italic).toBe(false);
  });
});

describe("fontCss", () => {
  const face = { weight: 400, italic: false };
  it("names weight, size and family", () => {
    expect(fontCss({ ...face, font: "comic-neue-bold", size: 32 })).toBe('700 32px "Comic Neue"');
    expect(fontCss({ ...face, font: "bangers", size: 10 })).toBe('400 10px "Bangers"');
  });

  it("takes a named font's weight and italic, and escapes its name", () => {
    expect(fontCss({ font: "Komika Axis", weight: 700, italic: true, size: 20 })).toBe(
      'italic 700 20px "Komika Axis"',
    );
    expect(fontCss({ font: 'A "B" \\ C', weight: 400, italic: false, size: 9 })).toBe(
      '400 9px "A \\"B\\" \\\\ C"',
    );
  });
});

describe("fontLabel / fontKey", () => {
  it("lists a bundled font by its label, a named one by family and style", () => {
    expect(fontLabel({ font: "bangers", weight: 700, italic: true })).toBe("Bangers");
    expect(fontLabel({ font: "Komika Axis", weight: 400, italic: false })).toBe("Komika Axis");
    expect(fontLabel({ font: "Komika Axis", weight: 700, italic: true })).toBe(
      "Komika Axis Bold Italic",
    );
    expect(fontLabel({ font: "X", weight: 300, italic: false })).toBe("X Light");
  });

  it("tells faces of one family apart, and a bundled id by itself", () => {
    const a = fontKey({ font: "Komika Axis", weight: 400, italic: false });
    const b = fontKey({ font: "Komika Axis", weight: 700, italic: false });
    expect(a).not.toBe(b);
    expect(fontKey({ font: "bangers", weight: 700, italic: true })).toBe("bangers");
  });
});

describe("text payload", () => {
  it("round-trips the settings and the box", () => {
    const spec = { ...DEFAULT_TEXT_SPEC, font: "Komika Axis", weight: 700, text: "Hi" };
    const out = decodeTextPayload(encodeTextPayload(spec, { width: 120, height: 40 }));
    expect(out).toEqual({ spec, box: [120, 40], margin: NO_MARGIN });
  });

  it("round-trips the jitter and its margin", () => {
    const spec = {
      ...DEFAULT_TEXT_SPEC,
      seed: 77,
      jitter: { rotate: 12, scale: 0.1, offset: 0.05, skew: 4 },
    };
    const margin = { left: 3, top: 1, right: 2, bottom: 5 };
    const out = decodeTextPayload(encodeTextPayload(spec, { width: 120, height: 40, margin }));
    expect(out).toEqual({ spec, box: [120, 40], margin });
  });

  it("reads a payload saved before the box was", () => {
    const out = decodeTextPayload(JSON.stringify({ ...DEFAULT_TEXT_SPEC, text: "old" }));
    expect(out?.box).toBeNull();
    expect(out?.margin).toEqual(NO_MARGIN);
    expect(out?.spec.text).toBe("old");
    expect(decodeTextPayload("{nope")).toBeNull();
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
