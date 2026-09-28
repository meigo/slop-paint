/**
 * A PNG `tEXt` chunk in and out (pure). A text reference is saved in the PSD as a Smart Object
 * whose embedded file is a PNG of the rendered text — a valid image for Photoshop or anything else
 * — carrying the text's settings in such a chunk, so this app can edit it again after reopening.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function isPng(png: Uint8Array): boolean {
  return png.length >= 8 && SIGNATURE.every((b, i) => png[i] === b);
}

/** `tEXt` is Latin-1; anything past ASCII is written as a JSON-style `\uXXXX` escape, so a JSON
 *  payload survives whole (and so does any other text, as long as the reader expects it). */
function asciiBytes(s: string): Uint8Array {
  const esc = s.replace(
    /[^\x20-\x7e]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return Uint8Array.from(esc, (ch) => ch.charCodeAt(0));
}

/** `png` with a `tEXt` chunk `keyword` → `text` inserted before IEND. Non-PNG input is returned
 *  unchanged. Non-ASCII in `text` is escaped (see `asciiBytes`), so use it for JSON. */
export function withPngText(png: Uint8Array, keyword: string, text: string): Uint8Array {
  if (!isPng(png)) return png;
  const end = findChunk(png, "IEND");
  if (end < 0) return png;
  const body = new Uint8Array([...asciiBytes(keyword), 0, ...asciiBytes(text)]);
  const chunk = new Uint8Array(12 + body.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length);
  chunk.set(asciiBytes("tEXt"), 4);
  chunk.set(body, 8);
  view.setUint32(8 + body.length, crc32(chunk.subarray(4, 8 + body.length)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, end));
  out.set(chunk, end);
  out.set(png.subarray(end), end + chunk.length);
  return out;
}

/** The text of the first `tEXt` chunk named `keyword`, or null (not a PNG, or no such chunk). */
export function readPngText(png: Uint8Array, keyword: string): string | null {
  if (!isPng(png)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let at = 8; at + 12 <= png.length;) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const bodyAt = at + 8;
    if (bodyAt + len > png.length) return null;
    if (type === "tEXt") {
      const body = png.subarray(bodyAt, bodyAt + len);
      const nul = body.indexOf(0);
      if (nul >= 0 && String.fromCharCode(...body.subarray(0, nul)) === keyword) {
        let s = "";
        for (const b of body.subarray(nul + 1)) s += String.fromCharCode(b);
        return s;
      }
    }
    if (type === "IEND") return null;
    at = bodyAt + len + 4;
  }
  return null;
}

/** Byte offset of the first chunk of `type`, or -1. */
function findChunk(png: Uint8Array, type: string): number {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let at = 8; at + 12 <= png.length;) {
    const len = view.getUint32(at);
    if (String.fromCharCode(...png.subarray(at + 4, at + 8)) === type) return at;
    at += 12 + len;
  }
  return -1;
}
