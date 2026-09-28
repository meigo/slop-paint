/**
 * What a font file says about itself (pure): its family and style names from the `name` table and
 * its weight and italic from `OS/2`, so an imported font is listed — and saved in a text layer — by
 * its real name, the name a desktop app would look for.
 *
 * TTF/OTF (sfnt) are read directly. WOFF compresses each table with zlib, so `woffTables` only
 * lists them and the caller inflates `name` and `OS/2` (text-fonts.ts). WOFF2 is Brotli-packed as a
 * whole, which browsers can't decompress for us: it is named after its file instead.
 */

export interface FontInfo {
  family: string;
  /** "Regular", "Bold Italic"… as the file names it (display only). */
  subfamily: string;
  /** CSS weight, 100–900. */
  weight: number;
  italic: boolean;
}

export type FontFormat = "sfnt" | "woff" | "woff2";

export function fontFormat(b: Uint8Array): FontFormat | null {
  if (b.length < 4) return null;
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (tag === "wOFF") return "woff";
  if (tag === "wOF2") return "woff2";
  if (tag === "OTTO" || tag === "true" || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) {
    return "sfnt";
  }
  return null;
}

export interface TableEntry {
  tag: string;
  offset: number;
  /** Bytes stored in the file. */
  length: number;
  /** Bytes once inflated (WOFF; equal to `length` when stored uncompressed, and for sfnt). */
  origLength: number;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const tagAt = (b: Uint8Array, at: number) =>
  String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** The table directory of a TTF/OTF, or null if it doesn't fit the file. */
export function sfntTables(b: Uint8Array): TableEntry[] | null {
  if (b.length < 12) return null;
  const v = view(b);
  const n = v.getUint16(4);
  if (12 + n * 16 > b.length) return null;
  const out: TableEntry[] = [];
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    const length = v.getUint32(at + 12);
    out.push({ tag: tagAt(b, at), offset: v.getUint32(at + 8), length, origLength: length });
  }
  return out;
}

/** The table directory of a WOFF, or null if it doesn't fit the file. */
export function woffTables(b: Uint8Array): TableEntry[] | null {
  if (b.length < 44) return null;
  const v = view(b);
  const n = v.getUint16(12);
  if (44 + n * 20 > b.length) return null;
  const out: TableEntry[] = [];
  for (let i = 0; i < n; i++) {
    const at = 44 + i * 20;
    out.push({
      tag: tagAt(b, at),
      offset: v.getUint32(at + 4),
      length: v.getUint32(at + 8),
      origLength: v.getUint32(at + 12),
    });
  }
  return out;
}

/** A table's bytes as stored (not inflated), or null if it runs past the file. */
export function tableBytes(b: Uint8Array, t: TableEntry | undefined): Uint8Array | null {
  if (!t || t.offset + t.length > b.length) return null;
  return b.subarray(t.offset, t.offset + t.length);
}

/**
 * Family and subfamily from a `name` table: the typographic names (16/17) when present, else the
 * legacy ones (1/2). Windows-platform (UTF-16) records are preferred, US English first; Mac Roman
 * ones are read as Latin-1, near enough for font names.
 */
export function parseNameTable(t: Uint8Array): { family: string; subfamily: string } | null {
  if (t.length < 6) return null;
  const v = view(t);
  const count = v.getUint16(2);
  const strings = v.getUint16(4);
  interface Rec {
    platform: number;
    lang: number;
    id: number;
    text: string;
  }
  const recs: Rec[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    if (at + 12 > t.length) break;
    const platform = v.getUint16(at);
    const lang = v.getUint16(at + 4);
    const id = v.getUint16(at + 6);
    const len = v.getUint16(at + 8);
    const off = strings + v.getUint16(at + 10);
    if (![1, 2, 4, 16, 17].includes(id) || off + len > t.length) continue;
    const raw = t.subarray(off, off + len);
    let text = "";
    if (platform === 3 || platform === 0) {
      for (let j = 0; j + 1 < raw.length; j += 2)
        text += String.fromCharCode((raw[j] << 8) | raw[j + 1]);
    } else if (platform === 1) {
      for (const c of raw) text += String.fromCharCode(c);
    } else continue;
    text = text.replace(/\0/g, "").trim();
    if (text) recs.push({ platform, lang, id, text });
  }
  const rank = (r: Rec) =>
    r.platform === 3 ? (r.lang === 0x0409 ? 0 : 1) : r.platform === 0 ? 2 : 3;
  const pick = (ids: number[]) => {
    for (const id of ids) {
      const found = recs.filter((r) => r.id === id).sort((a, b) => rank(a) - rank(b))[0];
      if (found) return found.text;
    }
    return "";
  };
  const family = pick([16, 1]);
  if (!family) return null;
  return { family, subfamily: pick([17, 2]) || "Regular" };
}

/** Weight (`usWeightClass`) and italic (`fsSelection` bit 0) from an `OS/2` table. */
export function parseOs2(t: Uint8Array): { weight: number; italic: boolean } | null {
  if (t.length < 64) return null;
  const v = view(t);
  const raw = v.getUint16(4);
  // Some old fonts store 1–9 (the Windows 3.1 scale); CSS wants 100–900.
  const weight = raw >= 1 && raw <= 9 ? raw * 100 : raw;
  return { weight: clampWeight(weight), italic: (v.getUint16(62) & 1) === 1 };
}

/** A CSS weight from a style name, for fonts without an `OS/2` table. */
export function weightFromStyle(style: string): number {
  const s = style.toLowerCase().replace(/[\s_-]/g, "");
  const table: [RegExp, number][] = [
    [/thin|hairline/, 100],
    [/extralight|ultralight/, 200],
    [/light/, 300],
    [/medium/, 500],
    [/semibold|demibold/, 600],
    [/extrabold|ultrabold/, 800],
    [/black|heavy/, 900],
    [/bold/, 700],
  ];
  for (const [re, w] of table) if (re.test(s)) return w;
  return 400;
}

export function clampWeight(w: number): number {
  if (!Number.isFinite(w)) return 400;
  return Math.min(900, Math.max(100, Math.round(w / 100) * 100));
}

/** Everything the file says, from its (already inflated) `name` and `OS/2` tables, with the file's
 *  name as the family when the tables are missing or unreadable. */
export function fontInfoFrom(
  name: Uint8Array | null,
  os2: Uint8Array | null,
  fileName: string,
): FontInfo {
  const names = name ? parseNameTable(name) : null;
  const metrics = os2 ? parseOs2(os2) : null;
  const subfamily = names?.subfamily ?? "Regular";
  return {
    family: names?.family ?? (fileName.replace(/\.[^.]+$/, "").trim() || "Font"),
    subfamily,
    weight: metrics?.weight ?? weightFromStyle(subfamily),
    italic: metrics?.italic ?? /italic|oblique/i.test(subfamily),
  };
}
