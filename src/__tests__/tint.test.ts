import { describe, expect, it } from "vitest";
import { normalizeTint, tintEffects, tintFromPsd } from "../tint";

describe("normalizeTint", () => {
  it("keeps #rrggbb, lower-cased", () => {
    expect(normalizeTint("#1E88E5")).toBe("#1e88e5");
  });

  it("widens #rgb", () => {
    expect(normalizeTint("#f80")).toBe("#ff8800");
  });

  it("is undefined for none or anything else", () => {
    expect(normalizeTint(undefined)).toBeUndefined();
    expect(normalizeTint("")).toBeUndefined();
    expect(normalizeTint("red")).toBeUndefined();
    expect(normalizeTint("#12345")).toBeUndefined();
  });
});

describe("tint in a PSD", () => {
  it("round-trips through Photoshop's Color Overlay", () => {
    const fx = tintEffects("#1e88e5");
    expect(fx.solidFill?.[0]).toMatchObject({
      enabled: true,
      blendMode: "normal",
      opacity: 1,
      color: { r: 0x1e, g: 0x88, b: 0xe5 },
    });
    expect(tintFromPsd(fx)).toBe("#1e88e5");
  });

  it("reads Photoshop's float RGB too", () => {
    expect(tintFromPsd({ solidFill: [{ enabled: true, color: { fr: 1, fg: 0.5, fb: 0 } }] })).toBe(
      "#ff8000",
    );
  });

  it("skips a switched-off overlay, and all effects switched off", () => {
    const off = { solidFill: [{ enabled: false, color: { r: 255, g: 0, b: 0 } }] };
    expect(tintFromPsd(off)).toBeUndefined();
    expect(tintFromPsd({ ...tintEffects("#ff0000"), disabled: true })).toBeUndefined();
  });

  it("takes the first enabled overlay", () => {
    const fx = {
      solidFill: [
        { enabled: false, color: { r: 255, g: 0, b: 0 } },
        { enabled: true, color: { r: 0, g: 0, b: 255 } },
      ],
    };
    expect(tintFromPsd(fx)).toBe("#0000ff");
  });

  it("is none without an overlay, or in a colour space it doesn't convert", () => {
    expect(tintFromPsd(undefined)).toBeUndefined();
    expect(tintFromPsd({ dropShadow: [{ enabled: true }] })).toBeUndefined();
    expect(tintFromPsd({ solidFill: [{ enabled: true, color: { k: 0.5 } }] })).toBeUndefined();
  });
});
