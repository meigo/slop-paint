import { describe, it, expect } from "vitest";
import {
  clampWeight,
  fontFormat,
  fontInfoFrom,
  parseNameTable,
  parseOs2,
  sfntTables,
  tableBytes,
  weightFromStyle,
  woffTables,
} from "../font-file";

const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const utf16 = (s: string) => [...s].flatMap((c) => u16(c.charCodeAt(0)));
const latin1 = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** A `name` table from [platform, lang, nameID, text] records. */
function nameTable(recs: [number, number, number, string][]): number[] {
  const strings: number[] = [];
  const records: number[] = [];
  for (const [platform, lang, id, text] of recs) {
    const bytes = platform === 1 ? latin1(text) : utf16(text);
    records.push(...u16(platform), ...u16(platform === 3 ? 1 : 0), ...u16(lang), ...u16(id));
    records.push(...u16(bytes.length), ...u16(strings.length));
    strings.push(...bytes);
  }
  return [...u16(0), ...u16(recs.length), ...u16(6 + recs.length * 12), ...records, ...strings];
}

function os2Table(weight: number, italic: boolean): number[] {
  const t = new Array(78).fill(0);
  t.splice(4, 2, ...u16(weight));
  t.splice(62, 2, ...u16(italic ? 1 : 0));
  return t;
}

/** A TTF holding just the given tables. */
function sfnt(tables: [string, number[]][]): Uint8Array {
  const header = [...u32(0x00010000), ...u16(tables.length), 0, 0, 0, 0, 0, 0];
  let offset = 12 + tables.length * 16;
  const dir: number[] = [];
  const body: number[] = [];
  for (const [tag, data] of tables) {
    dir.push(...latin1(tag), ...u32(0), ...u32(offset), ...u32(data.length));
    body.push(...data);
    offset += data.length;
  }
  return Uint8Array.from([...header, ...dir, ...body]);
}

/** A WOFF holding the given tables stored uncompressed. */
function woff(tables: [string, number[]][]): Uint8Array {
  const header = [...latin1("wOFF"), ...u32(0x00010000), ...u32(0), ...u16(tables.length)];
  while (header.length < 44) header.push(0);
  let offset = 44 + tables.length * 20;
  const dir: number[] = [];
  const body: number[] = [];
  for (const [tag, data] of tables) {
    dir.push(...latin1(tag), ...u32(offset), ...u32(data.length), ...u32(data.length), ...u32(0));
    body.push(...data);
    offset += data.length;
  }
  return Uint8Array.from([...header, ...dir, ...body]);
}

describe("fontFormat", () => {
  it("tells the formats apart by their signature", () => {
    expect(fontFormat(sfnt([]))).toBe("sfnt");
    expect(fontFormat(Uint8Array.from(latin1("OTTO....")))).toBe("sfnt");
    expect(fontFormat(Uint8Array.from(latin1("wOFF....")))).toBe("woff");
    expect(fontFormat(Uint8Array.from(latin1("wOF2....")))).toBe("woff2");
    expect(fontFormat(Uint8Array.from(latin1("GIF89a")))).toBeNull();
  });
});

describe("reading a TTF", () => {
  const file = sfnt([
    [
      "name",
      nameTable([
        [1, 0, 1, "Mac Family"],
        [3, 0x0409, 1, "Komika Axis"],
        [3, 0x0409, 2, "Bold Italic"],
      ]),
    ],
    ["OS/2", os2Table(700, true)],
  ]);
  const tables = sfntTables(file)!;
  const get = (tag: string) =>
    tableBytes(
      file,
      tables.find((t) => t.tag === tag),
    );

  it("finds its tables", () => {
    expect(tables.map((t) => t.tag)).toEqual(["name", "OS/2"]);
  });

  it("names it by its Windows family, weight and italic from OS/2", () => {
    expect(fontInfoFrom(get("name"), get("OS/2"), "komika.ttf")).toEqual({
      family: "Komika Axis",
      subfamily: "Bold Italic",
      weight: 700,
      italic: true,
    });
  });

  it("prefers the typographic family (16/17) over the legacy one", () => {
    const t = Uint8Array.from(
      nameTable([
        [3, 0x0409, 1, "Komika Axis Bold"],
        [3, 0x0409, 16, "Komika Axis"],
        [3, 0x0409, 17, "Bold"],
      ]),
    );
    expect(parseNameTable(t)).toEqual({ family: "Komika Axis", subfamily: "Bold" });
  });

  it("reads a Mac-only name table", () => {
    const t = Uint8Array.from(nameTable([[1, 0, 1, "Old Mac Font"]]));
    expect(parseNameTable(t)).toEqual({ family: "Old Mac Font", subfamily: "Regular" });
  });
});

describe("reading a WOFF", () => {
  it("lists its tables, and stored ones read as they are", () => {
    const file = woff([
      ["name", nameTable([[3, 0x0409, 1, "Wobbly"]])],
      ["OS/2", os2Table(300, false)],
    ]);
    const tables = woffTables(file)!;
    const get = (tag: string) =>
      tableBytes(
        file,
        tables.find((t) => t.tag === tag),
      );
    expect(tables.every((t) => t.length === t.origLength)).toBe(true);
    expect(fontInfoFrom(get("name"), get("OS/2"), "x.woff")).toMatchObject({
      family: "Wobbly",
      weight: 300,
      italic: false,
    });
  });
});

describe("fallbacks", () => {
  it("names a font after its file when it has no readable tables", () => {
    expect(fontInfoFrom(null, null, "Hand Letters-Bold.woff2")).toEqual({
      family: "Hand Letters-Bold",
      subfamily: "Regular",
      weight: 400,
      italic: false,
    });
  });

  it("takes weight and italic from the style name without OS/2", () => {
    const name = Uint8Array.from(
      nameTable([
        [3, 0x0409, 1, "X"],
        [3, 0x0409, 2, "SemiBold Oblique"],
      ]),
    );
    expect(fontInfoFrom(name, null, "x.ttf")).toMatchObject({ weight: 600, italic: true });
    expect(weightFromStyle("ExtraBold")).toBe(800);
    expect(weightFromStyle("Regular")).toBe(400);
  });

  it("reads the old 1–9 weight scale, and clamps to CSS's", () => {
    expect(parseOs2(Uint8Array.from(os2Table(7, false)))?.weight).toBe(700);
    expect(clampWeight(1234)).toBe(900);
    expect(clampWeight(0)).toBe(100);
    expect(clampWeight(NaN)).toBe(400);
  });

  it("rejects directories that run past the file", () => {
    const file = sfnt([["name", nameTable([[3, 0x0409, 1, "X"]])]]);
    expect(sfntTables(file.subarray(0, 20))).toBeNull();
    expect(parseOs2(new Uint8Array(10))).toBeNull();
  });
});
