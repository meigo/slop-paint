/**
 * Fonts for text layers beyond the bundled four: the user's LIBRARY (font files imported once per
 * device, kept in IndexedDB beside the autosave) and fonts INSTALLED on the system.
 *
 * A text layer saves only its font's name (as desktop apps do — the file never travels, which also
 * keeps font licences out of it). Opening one looks the name up: bundled → library → installed →
 * missing. Installed fonts are only what the browser lets a page see: Chrome/Edge on desktop show
 * the user's own; Safari (Mac and iPad) only Apple's built-in ones, so on the iPad the library is
 * the way in.
 */
import { idbDo, KV_STORE } from "./persist/db";
import {
  fontFormat,
  fontInfoFrom,
  sfntTables,
  tableBytes,
  woffTables,
  type TableEntry,
} from "./font-file";
import { bundledFont, cssFamily, fontCss, fontKey, type TextSpec } from "./text-layout";

export interface LibraryFont {
  family: string;
  subfamily: string;
  weight: number;
  italic: boolean;
  fileName: string;
  bytes: ArrayBuffer;
}

export type FontSource = "bundled" | "library" | "installed" | "missing";

const KEY = "fonts";
let library: LibraryFont[] = [];
let ready: Promise<void> | null = null;

const faceKey = (f: Pick<LibraryFont, "family" | "weight" | "italic">) =>
  fontKey({ font: f.family, weight: f.weight, italic: f.italic });

async function register(f: LibraryFont) {
  const face = new FontFace(f.family, f.bytes, {
    weight: String(f.weight),
    style: f.italic ? "italic" : "normal",
  });
  await face.load(); // rejects on a file the browser can't use
  document.fonts.add(face);
}

/** The library, loaded from storage and registered with the page — once; every font lookup waits
 *  for it, so an opened document never calls a library font missing because it wasn't loaded yet. */
export function fontLibraryReady(): Promise<void> {
  ready ??= (async () => {
    try {
      const saved = await idbDo<LibraryFont[] | undefined>(KV_STORE, "readonly", (s) => s.get(KEY));
      for (const f of saved ?? []) {
        try {
          await register(f);
          library.push(f);
        } catch (e) {
          console.error(`font "${f.family}" in the library could not be loaded`, e);
        }
      }
    } catch (e) {
      console.error("the font library could not be read", e);
    }
  })();
  return ready;
}

export function libraryFonts(): readonly LibraryFont[] {
  return library;
}

/** Inflate a WOFF table (zlib); stored tables come back as they are. */
async function inflate(b: Uint8Array, t: TableEntry | undefined): Promise<Uint8Array | null> {
  const raw = tableBytes(b, t);
  if (!raw || !t) return null;
  if (t.length === t.origLength) return raw;
  const stream = new Blob([raw as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Add a font file to the library (replacing the same face if it's there) and register it. Throws
 * with a readable message when the file isn't a font the browser can use.
 */
export async function addFontFile(file: File): Promise<LibraryFont> {
  await fontLibraryReady();
  const buffer = await file.arrayBuffer();
  const b = new Uint8Array(buffer);
  const format = fontFormat(b);
  if (!format) throw new Error("That isn't a font file (TTF, OTF, WOFF or WOFF2)");
  let name: Uint8Array | null = null;
  let os2: Uint8Array | null = null;
  if (format === "sfnt" || format === "woff") {
    const tables = format === "sfnt" ? sfntTables(b) : woffTables(b);
    const find = (tag: string) => tables?.find((t) => t.tag === tag);
    try {
      name = format === "sfnt" ? tableBytes(b, find("name")) : await inflate(b, find("name"));
      os2 = format === "sfnt" ? tableBytes(b, find("OS/2")) : await inflate(b, find("OS/2"));
    } catch {
      // Unreadable tables: fall back to the file's name, below.
    }
  }
  const info = fontInfoFrom(name, os2, file.name);
  const entry: LibraryFont = { ...info, fileName: file.name, bytes: buffer };
  try {
    await register(entry);
  } catch {
    throw new Error("The browser couldn't use that font file");
  }
  const key = faceKey(entry);
  library = [...library.filter((f) => faceKey(f) !== key), entry];
  await idbDo(KV_STORE, "readwrite", (s) => s.put(library, KEY));
  return entry;
}

/** Whether `family` (at a weight/style) is installed and visible to the page: text in it measures
 *  differently from both generic fallbacks. (A name the browser doesn't know falls back to them.) */
function isInstalled(family: string, weight: number, italic: boolean): boolean {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return false;
  const sample = "mmmmmmmmmmlli1WW@#Q";
  const style = `${italic ? "italic " : ""}${weight} 72px`;
  return ["monospace", "serif"].some((generic) => {
    ctx.font = `${style} ${generic}`;
    const base = ctx.measureText(sample).width;
    ctx.font = `${style} ${cssFamily(family)}, ${generic}`;
    return ctx.measureText(sample).width !== base;
  });
}

/** Where a spec's font comes from on this device, loading it if it's a web font. */
export async function fontSource(spec: TextSpec): Promise<FontSource> {
  if (bundledFont(spec.font)) return "bundled";
  await fontLibraryReady();
  // The exact face, or the family at another weight/style — which the browser then synthesizes
  // (a library family would pass the installed test below for the same reason).
  if (library.some((f) => f.family === spec.font)) {
    await document.fonts.load(fontCss({ ...spec, size: 16 })).catch(() => {});
    return "library";
  }
  return isInstalled(spec.font, spec.weight, spec.italic) ? "installed" : "missing";
}
