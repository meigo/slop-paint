import { describe, it, expect } from "vitest";
import { History } from "../history";

function fakeImageData(id: number): ImageData {
  // Create a minimal ImageData-like object for testing
  const data = new Uint8ClampedArray([id, 0, 0, 255]);
  return { data, width: 1, height: 1, colorSpace: "srgb" } as ImageData;
}

describe("History", () => {
  it("starts empty", () => {
    const h = new History();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it("push enables undo", () => {
    const h = new History();
    h.push(fakeImageData(1));
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it("undo returns previous state", () => {
    const h = new History();
    const s1 = fakeImageData(1);
    h.push(s1);
    const current = fakeImageData(2);
    const result = h.undo(current);
    expect(result).toBe(s1);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
  });

  it("redo returns undone state", () => {
    const h = new History();
    h.push(fakeImageData(1));
    const s2 = fakeImageData(2);
    h.undo(s2);
    const s3 = fakeImageData(3);
    const result = h.redo(s3);
    expect(result).toBe(s2);
  });

  it("push after undo clears redo stack", () => {
    const h = new History();
    h.push(fakeImageData(1));
    h.undo(fakeImageData(2));
    expect(h.canRedo).toBe(true);
    h.push(fakeImageData(3));
    expect(h.canRedo).toBe(false);
  });

  it("undo on empty returns null", () => {
    const h = new History();
    expect(h.undo(fakeImageData(1))).toBeNull();
  });

  it("redo on empty returns null", () => {
    const h = new History();
    expect(h.redo(fakeImageData(1))).toBeNull();
  });

  it("clear resets both stacks", () => {
    const h = new History();
    h.push(fakeImageData(1));
    h.push(fakeImageData(2));
    h.undo(fakeImageData(3));
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it("respects max size (50)", () => {
    const h = new History();
    for (let i = 0; i < 60; i++) {
      h.push(fakeImageData(i));
    }
    // Should have at most 50 items
    let undoCount = 0;
    let current = fakeImageData(99);
    while (h.canUndo) {
      const prev = h.undo(current);
      if (prev) current = prev;
      undoCount++;
    }
    expect(undoCount).toBe(50);
  });
});
