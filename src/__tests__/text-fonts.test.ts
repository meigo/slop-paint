import { describe, it, expect, vi, beforeAll } from "vitest";
import type { LibraryFont } from "../text-fonts";
import { DEFAULT_TEXT_SPEC, type TextSpec } from "../text-layout";

// A library font is found by its exact face. With only another weight of the family there, the
// face is missing: the browser would fake it (a faux bold), so removing Bold while Regular stayed
// kept Bold text drawing live instead of keeping its look (2026-10-17 review, V14-8).

const saved: LibraryFont[] = [
  {
    family: "Komika Axis",
    subfamily: "Regular",
    weight: 400,
    italic: false,
    fileName: "komika.ttf",
    bytes: new ArrayBuffer(0),
  },
];

vi.mock("../persist/db", () => ({
  KV_STORE: "kv",
  idbDo: async (_store: string, mode: string) => (mode === "readonly" ? saved : undefined),
}));

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.FontFace = class {
    load() {
      return Promise.resolve(this);
    }
  };
  g.document = {
    fonts: { add() {}, delete() {}, load: () => Promise.resolve([]) },
    createElement: () => ({ getContext: () => null }),
  };
});

const spec = (weight: number, italic = false): TextSpec => ({
  ...DEFAULT_TEXT_SPEC,
  font: "Komika Axis",
  weight,
  italic,
});

describe("fontSource", () => {
  it("finds the exact face in the library", async () => {
    const { fontSource } = await import("../text-fonts");
    expect(await fontSource(spec(400))).toBe("library");
  });

  it("calls another weight or style of a library family missing", async () => {
    const { fontSource } = await import("../text-fonts");
    expect(await fontSource(spec(700))).toBe("missing");
    expect(await fontSource(spec(400, true))).toBe("missing");
  });
});
