import { describe, it, expect } from "vitest";
import { isConfirmEnter } from "../lib/dialog-keys";

const input = { tagName: "INPUT" } as unknown as EventTarget;
const button = { tagName: "BUTTON" } as unknown as EventTarget;

describe("isConfirmEnter", () => {
  it("takes Enter in a field or on the dialog itself", () => {
    expect(isConfirmEnter({ key: "Enter", target: input })).toBe(true);
    expect(isConfirmEnter({ key: "Enter", target: null })).toBe(true);
  });

  it("leaves Enter on a focused button to press that button", () => {
    expect(isConfirmEnter({ key: "Enter", target: button })).toBe(false);
  });

  it("leaves the Enter that commits an input method's text", () => {
    expect(isConfirmEnter({ key: "Enter", isComposing: true, target: input })).toBe(false);
    expect(isConfirmEnter({ key: "Enter", keyCode: 229, target: input })).toBe(false);
  });

  it("is only Enter", () => {
    expect(isConfirmEnter({ key: "Escape", target: input })).toBe(false);
  });
});
