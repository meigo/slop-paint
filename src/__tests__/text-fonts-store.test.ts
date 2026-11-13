import { describe, it, expect, vi, beforeAll } from "vitest";
import type { LibraryFont } from "../text-fonts";

// The stored font list must survive a session that couldn't use all of it: a startup read that
// failed left the library empty and the next add stored that over every saved font; a stored font
// the browser wouldn't register was dropped from the list at the next write (full review, batch 2).

const font = (family: string): LibraryFont => ({
  family,
  subfamily: "Regular",
  weight: 400,
  italic: false,
  fileName: `${family}.woff2`,
  bytes: new ArrayBuffer(0),
});

const db = {
  stored: [font("Good"), font("Broken")],
  readFails: true,
  puts: [] as LibraryFont[][],
};

vi.mock("../persist/db", () => ({
  KV_STORE: "kv",
  idbDo: async (
    _store: string,
    mode: string,
    fn: (s: { get: () => void; put: (v: LibraryFont[]) => void }) => void,
  ) => {
    if (mode === "readonly") {
      if (db.readFails) throw new Error("blocked");
      return db.stored;
    }
    fn({ get() {}, put: (v) => db.puts.push(v) });
    return undefined;
  },
}));

const fontFile = (name: string) =>
  ({
    name,
    arrayBuffer: async () => new TextEncoder().encode("wOF2....").buffer,
  }) as unknown as File;

beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const g = globalThis as unknown as Record<string, unknown>;
  g.FontFace = class {
    family: string;
    constructor(family: string) {
      this.family = family;
    }
    load() {
      return this.family === "Broken"
        ? Promise.reject(new Error("bad font"))
        : Promise.resolve(this);
    }
  };
  g.document = { fonts: { add() {}, delete() {}, load: () => Promise.resolve([]) } };
});

describe("the stored font list", () => {
  it("isn't written while it can't be read", async () => {
    const { addFontFile, libraryFonts } = await import("../text-fonts");
    await expect(addFontFile(fontFile("New.woff2"))).rejects.toThrow(/couldn't be read/);
    expect(db.puts).toEqual([]);
    expect(libraryFonts()).toEqual([]);
  });

  it("is read again before a write, and keeps a font the browser wouldn't register", async () => {
    const { addFontFile, removeLibraryFont, libraryFonts, faceKey } = await import("../text-fonts");
    db.readFails = false;
    await addFontFile(fontFile("New.woff2"));
    expect(libraryFonts().map((f) => f.family)).toEqual(["Good", "New"]);
    expect(db.puts.at(-1)!.map((f) => f.family)).toEqual(["Broken", "Good", "New"]);

    await removeLibraryFont(faceKey(font("Good")));
    expect(db.puts.at(-1)!.map((f) => f.family)).toEqual(["Broken", "New"]);
  });
});
