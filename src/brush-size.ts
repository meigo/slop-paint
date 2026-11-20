// The brush size's range and how the toolbar moves through it (pure, tested). Size is the stroke's
// nominal width in document px (Press widens it up to 8× under full pressure).

export const SIZE_MIN = 1;
/** Raised from 80 (2026-11-20, the user's ask: a big Airbrush at Press 1×). */
export const SIZE_MAX = 500;

/** Slider positions: 0–SIZE_SLIDER_STEPS, even in RATIO (each doubling the same travel), so the
 *  small sizes keep their room — 1–80 is ~70% of the slider. */
export const SIZE_SLIDER_STEPS = 1000;
const LOG_SPAN = Math.log(SIZE_MAX / SIZE_MIN);

/** A size as the stored values snap: halves below 10, whole px from 10. */
export function snapSize(s: number): number {
  const c = Math.min(SIZE_MAX, Math.max(SIZE_MIN, s));
  return c < 10 ? Math.round(c * 2) / 2 : Math.round(c);
}

export const sizeToSlider = (s: number) =>
  Math.round((Math.log(Math.max(SIZE_MIN, s) / SIZE_MIN) / LOG_SPAN) * SIZE_SLIDER_STEPS);

export const sliderToSize = (v: number) =>
  snapSize(SIZE_MIN * Math.exp((v / SIZE_SLIDER_STEPS) * LOG_SPAN));

/** `[` / `]`: about a tenth of the size (at least 1 px), so a step means the same at any size. */
export function stepSize(s: number, dir: 1 | -1): number {
  const step = Math.max(1, Math.round(s / 10));
  return snapSize(s + dir * step);
}

/** A typed size: the number (comma decimals too), snapped, or a reason it was refused. */
export function parseSize(text: string): number | string {
  const v = parseFloat(text.replace(",", "."));
  if (isNaN(v)) return "Type a number";
  if (v < SIZE_MIN || v > SIZE_MAX) return `Size is ${SIZE_MIN}–${SIZE_MAX} px`;
  return snapSize(v);
}
