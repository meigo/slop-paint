import { describe, it, expect } from "vitest";
import { readPngText, withPngText } from "../png-text";

/** Bit-by-bit CRC-32 (the PNG one), independent of the table the module uses. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** A minimal PNG's chunk skeleton (signature, IHDR, IEND) — enough for chunk handling. */
function chunk(type: string, body: number[]): number[] {
  const t = [...type].map((c) => c.charCodeAt(0));
  const len = body.length;
  const crc = crc32(Uint8Array.from([...t, ...body]));
  return [
    len >>> 24,
    (len >>> 16) & 255,
    (len >>> 8) & 255,
    len & 255,
    ...t,
    ...body,
    crc >>> 24,
    (crc >>> 16) & 255,
    (crc >>> 8) & 255,
    crc & 255,
  ];
}
const PNG = Uint8Array.from([
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10,
  ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
  ...chunk("IEND", []),
]);

describe("withPngText / readPngText", () => {
  it("test CRC matches PNG's (IEND's well-known CRC)", () => {
    expect(crc32(Uint8Array.from([73, 69, 78, 68]))).toBe(0xae426082);
  });

  it("round-trips a JSON payload, non-ASCII included", () => {
    const json = JSON.stringify({ text: "Tere, õun! Šokk 😀\nrida 2" });
    const out = withPngText(PNG, "key", json);
    expect(JSON.parse(readPngText(out, "key")!)).toEqual(JSON.parse(json));
  });

  it("inserts a valid chunk before IEND and keeps the rest", () => {
    const out = withPngText(PNG, "key", "hi");
    expect(out.length).toBe(PNG.length + 12 + 6);
    // IEND is still last, untouched
    expect([...out.subarray(out.length - 12)]).toEqual([...PNG.subarray(PNG.length - 12)]);
    // the new chunk's CRC is right
    const at = PNG.length - 12;
    const body = out.subarray(at + 4, at + 4 + 4 + 6);
    const crc = new DataView(out.buffer).getUint32(at + 8 + 6);
    expect(crc).toBe(crc32(body));
  });

  it("finds only the named keyword", () => {
    const out = withPngText(withPngText(PNG, "other", "x"), "key", "y");
    expect(readPngText(out, "key")).toBe("y");
    expect(readPngText(out, "other")).toBe("x");
    expect(readPngText(out, "missing")).toBeNull();
  });

  it("leaves a non-PNG alone and reads nothing from it", () => {
    const junk = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(withPngText(junk, "key", "x")).toBe(junk);
    expect(readPngText(junk, "key")).toBeNull();
  });

  it("stops at a truncated chunk", () => {
    const out = withPngText(PNG, "key", "hello");
    expect(readPngText(out.subarray(0, PNG.length - 12 + 10), "key")).toBeNull();
  });
});
