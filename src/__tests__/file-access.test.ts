import { describe, it, expect } from "vitest";
import { isAbort } from "../file-access";

describe("isAbort", () => {
  it("is a dismissed picker, not an error to report", () => {
    expect(isAbort(new DOMException("The user aborted a request.", "AbortError"))).toBe(true);
  });

  it("is false for real failures", () => {
    expect(isAbort(new DOMException("denied", "NotAllowedError"))).toBe(false);
    expect(isAbort(new Error("AbortError"))).toBe(false);
    expect(isAbort(null)).toBe(false);
  });
});
