import { describe, it, expect } from "vitest";
import {
  clampPanelWidth,
  panelBesideToolOptions,
  MIN_PANEL_WIDTH,
  DEFAULT_PANEL_WIDTH,
  TOOL_OPTIONS_WIDTH,
} from "../panel-layout";

describe("clampPanelWidth", () => {
  it("returns a value within range unchanged", () => {
    expect(clampPanelWidth(300, 1400)).toBe(300); // 184 <= 300 <= 700
  });

  it("floors at MIN below the minimum", () => {
    expect(clampPanelWidth(50, 1400)).toBe(MIN_PANEL_WIDTH);
  });

  it("caps at 50% of the viewport above the maximum", () => {
    expect(clampPanelWidth(1200, 1400)).toBe(700); // 0.5 * 1400
  });

  it("keeps MIN even when 50% of a tiny viewport is below MIN", () => {
    // The panel would rather overflow a very narrow window than collapse to nothing.
    expect(clampPanelWidth(500, 200)).toBe(MIN_PANEL_WIDTH); // 0.5*200=100 < 184 → MIN wins
  });

  it("rounds the max to a whole pixel", () => {
    expect(clampPanelWidth(9999, 777)).toBe(Math.round(777 * 0.5)); // 389
  });

  it("DEFAULT is within the sane range and matches the old fixed w-70", () => {
    expect(DEFAULT_PANEL_WIDTH).toBeGreaterThanOrEqual(MIN_PANEL_WIDTH);
    expect(DEFAULT_PANEL_WIDTH).toBe(280); // Tailwind w-70 — first run must look unchanged
    // The floor is 180 of usable content plus the grip's reserved 4px strip.
    expect(MIN_PANEL_WIDTH).toBe(184);
    expect(clampPanelWidth(DEFAULT_PANEL_WIDTH, 1400)).toBe(DEFAULT_PANEL_WIDTH);
  });
});

describe("panelBesideToolOptions", () => {
  it("goes beside the tool-options row when the widest row still fits next to it", () => {
    expect(panelBesideToolOptions(1728, DEFAULT_PANEL_WIDTH)).toBe(true); // desktop
    expect(panelBesideToolOptions(TOOL_OPTIONS_WIDTH + 300, 300)).toBe(true); // exactly fits
  });

  it("starts below the row when it would wrap next to the panel", () => {
    expect(panelBesideToolOptions(1180, DEFAULT_PANEL_WIDTH)).toBe(false); // iPad landscape
    expect(panelBesideToolOptions(820, DEFAULT_PANEL_WIDTH)).toBe(false); // iPad portrait
    expect(panelBesideToolOptions(TOOL_OPTIONS_WIDTH + 299, 300)).toBe(false);
  });

  it("follows the panel width: widening it can move it back below", () => {
    expect(panelBesideToolOptions(1400, 300)).toBe(true);
    expect(panelBesideToolOptions(1400, 500)).toBe(false);
  });
});
