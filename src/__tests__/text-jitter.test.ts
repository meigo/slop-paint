import { describe, expect, it } from "vitest";
import {
  IDENTITY_CHAR,
  NO_JITTER,
  charMatrix,
  charTransform,
  hasJitter,
  newSeed,
  type JitterAmounts,
} from "../text-jitter";

const SOME: JitterAmounts = { rotate: 12, scale: 0.08, offset: 0.1, skew: 6 };

describe("charTransform", () => {
  it("is deterministic", () => {
    expect(charTransform(418, 3, SOME, 40)).toEqual(charTransform(418, 3, SOME, 40));
  });

  it("gives each index its own jitter, independent of the others", () => {
    const five = charTransform(418, 5, SOME, 40);
    // Asking for the earlier indices first must not change index 5 — a sequential PRNG would.
    for (let i = 0; i < 5; i++) charTransform(418, i, SOME, 40);
    expect(charTransform(418, 5, SOME, 40)).toEqual(five);
    expect(charTransform(418, 6, SOME, 40)).not.toEqual(five);
  });

  it("gives a different seed a different result", () => {
    expect(charTransform(1, 3, SOME, 40)).not.toEqual(charTransform(2, 3, SOME, 40));
  });

  it("is the identity when every amount is zero", () => {
    for (let i = 0; i < 10; i++)
      expect(charTransform(418, i, NO_JITTER, 40)).toEqual(IDENTITY_CHAR);
  });

  it("stays inside the amount, and actually uses it", () => {
    let maxRot = 0;
    for (let i = 0; i < 200; i++) {
      const t = charTransform(7, i, SOME, 40);
      expect(Math.abs(t.rotate)).toBeLessThanOrEqual(12);
      expect(Math.abs(t.scale - 1)).toBeLessThanOrEqual(0.08);
      expect(Math.abs(t.dy)).toBeLessThanOrEqual(4); // 10% of size 40
      maxRot = Math.max(maxRot, Math.abs(t.rotate));
    }
    expect(maxRot).toBeGreaterThan(9); // not merely bounded — the range is used
  });

  it("varies each property independently", () => {
    const rots = [];
    const scales = [];
    for (let i = 0; i < 200; i++) {
      const t = charTransform(7, i, { rotate: 1, scale: 1, offset: 1, skew: 1 }, 1);
      rots.push(t.rotate);
      scales.push(t.scale - 1);
    }
    expect(rots).not.toEqual(scales);
  });

  it("pins the roll — a saved layer must never re-roll (same values as slop-vector-editor)", () => {
    expect(charTransform(418, 3, { rotate: 1, scale: 1, offset: 1, skew: 1 }, 1)).toEqual({
      rotate: -0.05535666598007083,
      scale: 1.5079169375821948,
      dy: 0.9868702283129096,
      skew: -0.6185692027211189,
    });
  });
});

describe("charMatrix", () => {
  const apply = (m: ReturnType<typeof charMatrix>, x: number, y: number) => ({
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  });

  it("is the identity for the identity transform", () => {
    expect(charMatrix(IDENTITY_CHAR, 30, 40)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  });

  it("keeps the pivot in place, moved only by the baseline shift", () => {
    const m = charMatrix({ rotate: 30, scale: 1.4, dy: 5, skew: 10 }, 30, 40);
    const p = apply(m, 30, 40);
    expect(p.x).toBeCloseTo(30);
    expect(p.y).toBeCloseTo(45);
  });

  it("turns clockwise on the page for a positive angle (y down)", () => {
    const m = charMatrix({ rotate: 90, scale: 1, dy: 0, skew: 0 }, 0, 0);
    const p = apply(m, 10, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });

  it("scales about the pivot", () => {
    const m = charMatrix({ rotate: 0, scale: 2, dy: 0, skew: 0 }, 10, 10);
    expect(apply(m, 20, 10)).toEqual({ x: 30, y: 10 });
  });
});

describe("hasJitter", () => {
  it("is off only when every amount is zero", () => {
    expect(hasJitter(NO_JITTER)).toBe(false);
    expect(hasJitter({ ...NO_JITTER, skew: 1 })).toBe(true);
  });
});

describe("newSeed", () => {
  it("is a non-negative 32-bit integer", () => {
    for (let i = 0; i < 50; i++) {
      const s = newSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(0x100000000);
    }
  });
});
