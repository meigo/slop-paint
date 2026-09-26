import { describe, it, expect } from "vitest";
import { nameFromFile, sanitizeFilename } from "../filename";

describe("sanitizeFilename", () => {
  it("keeps an ordinary name", () => {
    expect(sanitizeFilename("Hero sheet v2")).toBe("Hero sheet v2");
  });

  it("drops characters file systems refuse, and trims", () => {
    expect(sanitizeFilename(' a/b\\c:d*e?"f<g>h|i ')).toBe("abcdefghi");
  });

  it("falls back to untitled when nothing is left", () => {
    expect(sanitizeFilename("  ")).toBe("untitled");
    expect(sanitizeFilename("///")).toBe("untitled");
  });
});

describe("nameFromFile", () => {
  it("drops only the extension", () => {
    expect(nameFromFile("hero.v2.psd")).toBe("hero.v2");
    expect(nameFromFile("sheet")).toBe("sheet");
  });
});
