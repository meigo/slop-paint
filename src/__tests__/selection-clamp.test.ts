import { describe, it, expect } from "vitest";
import { clampToPage } from "../selection";

describe("clampToPage", () => {
  it("leaves a point on the page alone", () => {
    expect(clampToPage({ x: 10, y: 20 }, 100, 50)).toEqual({ x: 10, y: 20 });
  });

  it("pulls a point off the page onto its nearest edge", () => {
    expect(clampToPage({ x: -30, y: 70 }, 100, 50)).toEqual({ x: 0, y: 50 });
    expect(clampToPage({ x: 130, y: -5 }, 100, 50)).toEqual({ x: 100, y: 0 });
  });
});
