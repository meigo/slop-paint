import { describe, it, expect } from "vitest";
import {
  imageUrlFromClipboard,
  PASTE_OFFSET,
  placeExternalImage,
  placeInternalPaste,
  referenceLayerName,
} from "../paste";
import { parseTags } from "../spine-tags";

describe("placeExternalImage", () => {
  it("centres a small image at its own size", () => {
    expect(placeExternalImage(100, 50, 1000, 500)).toEqual({ x: 450, y: 225, w: 100, h: 50 });
  });

  it("scales a too-large image down to fit, keeping aspect", () => {
    const r = placeExternalImage(4000, 1000, 2000, 1000);
    expect(r).toEqual({ x: 0, y: 250, w: 2000, h: 500 });
  });

  it("never scales up", () => {
    expect(placeExternalImage(10, 10, 1000, 1000).w).toBe(10);
  });
});

describe("placeInternalPaste", () => {
  it("offsets the paste from the copied spot", () => {
    expect(placeInternalPaste({ x: 10, y: 20, w: 50, h: 50 }, 1000, 1000)).toEqual({
      x: 10 + PASTE_OFFSET,
      y: 20 + PASTE_OFFSET,
      w: 50,
      h: 50,
    });
  });

  it("keeps a paste at the bottom-right edge on the page", () => {
    expect(placeInternalPaste({ x: 950, y: 950, w: 50, h: 50 }, 1000, 1000)).toEqual({
      x: 950,
      y: 950,
      w: 50,
      h: 50,
    });
  });

  it("pins a copy wider than the page to the left edge", () => {
    expect(placeInternalPaste({ x: 0, y: 0, w: 2000, h: 10 }, 1000, 1000).x).toBe(0);
  });
});

describe("referenceLayerName", () => {
  it("tags the file's name with [ignore] so Spine skips it", () => {
    expect(referenceLayerName("photo.png")).toBe("[ignore]ref photo");
    expect(parseTags(referenceLayerName("photo.png")).tags).toEqual(["ignore"]);
  });

  it("keeps dots inside the name and drops only the extension", () => {
    expect(referenceLayerName("pose v2.final.jpeg")).toBe("[ignore]ref pose v2.final");
  });

  it("falls back to plain 'ref' for a paste or an empty name", () => {
    expect(referenceLayerName()).toBe("[ignore]ref");
    expect(referenceLayerName("  ")).toBe("[ignore]ref");
  });
});

describe("imageUrlFromClipboard", () => {
  it("takes an <img> src from the HTML", () => {
    const html =
      '<meta charset="utf-8"><img src="https://cdn.example.com/a/0_7.jpeg?x=1&amp;y=2" alt="">';
    expect(imageUrlFromClipboard(html, "", "")).toBe("https://cdn.example.com/a/0_7.jpeg?x=1&y=2");
  });

  it("takes an image URL from the uri-list or plain text", () => {
    const url = "https://cdn.midjourney.com/21e2255e/0_7.jpeg";
    expect(imageUrlFromClipboard("", `# comment\r\n${url}`, "")).toBe(url);
    expect(imageUrlFromClipboard("", "", ` ${url} `)).toBe(url);
  });

  it("ignores links that aren't images, and non-http addresses", () => {
    expect(imageUrlFromClipboard("", "https://example.com/page", "")).toBeNull();
    expect(imageUrlFromClipboard("", "", "hello https://x.com/a.png")).toBeNull();
    expect(imageUrlFromClipboard('<img src="data:image/png;base64,AAA">', "", "")).toBeNull();
    expect(imageUrlFromClipboard("", "", "file:///tmp/a.png")).toBeNull();
    expect(imageUrlFromClipboard("", "", "")).toBeNull();
  });
});
