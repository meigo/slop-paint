import { describe, it, expect } from "vitest";
import { PressureCurve } from "../pressure-curve";

describe("PressureCurve", () => {
  it("linear default: evaluate(0) = 0", () => {
    const c = new PressureCurve();
    expect(c.evaluate(0)).toBeCloseTo(0, 2);
  });

  it("linear default: evaluate(1) = 1", () => {
    const c = new PressureCurve();
    expect(c.evaluate(1)).toBeCloseTo(1, 2);
  });

  it("linear default: evaluate(0.5) ≈ 0.5", () => {
    const c = new PressureCurve();
    expect(c.evaluate(0.5)).toBeCloseTo(0.5, 1);
  });

  it("clamps below 0", () => {
    const c = new PressureCurve();
    expect(c.evaluate(-0.5)).toBe(0);
  });

  it("clamps above 1", () => {
    const c = new PressureCurve();
    expect(c.evaluate(1.5)).toBe(1);
  });

  it("custom curve: heavy feel (both CPs low-right)", () => {
    const c = new PressureCurve();
    c.cp1 = { x: 0.7, y: 0.2 };
    c.cp2 = { x: 0.9, y: 0.4 };
    c.buildLUT();
    // At midpoint pressure, output should be less than 0.5 (need more pressure)
    expect(c.evaluate(0.5)).toBeLessThan(0.4);
  });

  it("custom curve: light feel (both CPs upper-left)", () => {
    const c = new PressureCurve();
    c.cp1 = { x: 0.1, y: 0.6 };
    c.cp2 = { x: 0.3, y: 0.9 };
    c.buildLUT();
    // At midpoint pressure, output should be more than 0.5 (lighter touch)
    expect(c.evaluate(0.5)).toBeGreaterThan(0.6);
  });

  it("reset returns to linear", () => {
    const c = new PressureCurve();
    c.cp1 = { x: 0.9, y: 0.1 };
    c.cp2 = { x: 0.1, y: 0.9 };
    c.buildLUT();
    c.reset();
    expect(c.evaluate(0.5)).toBeCloseTo(0.5, 1);
    expect(c.cp1.x).toBeCloseTo(0.25);
    expect(c.cp2.x).toBeCloseTo(0.75);
  });

  it("monotonically increasing for linear", () => {
    const c = new PressureCurve();
    let prev = 0;
    for (let i = 0; i <= 100; i++) {
      const v = c.evaluate(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 0.001); // small tolerance
      prev = v;
    }
  });
});
