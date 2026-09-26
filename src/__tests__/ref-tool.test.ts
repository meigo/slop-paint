import { describe, it, expect } from "vitest";
import { refFocusChange } from "../ref-tool";

describe("refFocusChange", () => {
  it("selecting a reference switches to Select and remembers the tool", () => {
    expect(refFocusChange(true, "brush", null, "brush")).toEqual({
      tool: "select",
      before: "brush",
    });
    expect(refFocusChange(true, "fill", null, "brush")).toEqual({ tool: "select", before: "fill" });
  });

  it("selecting a reference while on Select or Lasso owes nothing back", () => {
    expect(refFocusChange(true, "select", null, "brush")).toEqual({ tool: "select", before: null });
    expect(refFocusChange(true, "lasso", null, "brush")).toEqual({ tool: "lasso", before: null });
  });

  it("one-shot tools are not handed back to", () => {
    expect(refFocusChange(true, "eyedropper", null, "brush").before).toBe("brush");
    expect(refFocusChange(true, "outline", null, "brush").before).toBe("brush");
  });

  it("selecting away hands the remembered tool back", () => {
    expect(refFocusChange(false, "select", "eraser", "brush")).toEqual({
      tool: "eraser",
      before: null,
    });
  });

  it("a tool picked while on the reference stays when selecting away", () => {
    expect(refFocusChange(false, "lasso", "brush", "brush")).toEqual({
      tool: "lasso",
      before: null,
    });
    expect(refFocusChange(false, "fill", "brush", "brush")).toEqual({ tool: "fill", before: null });
  });

  it("selecting away with nothing remembered changes nothing", () => {
    expect(refFocusChange(false, "select", null, "brush")).toEqual({
      tool: "select",
      before: null,
    });
  });
});
