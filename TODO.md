# TODO

Backlog of ideas raised but not yet implemented. Add new items as they come up;
strike them through or move to a "Done" log when shipped.

## UX / Discoverability

- **Toolbar buttons for Distort and Mesh Warp** — context-aware enable, lights up
  when a selection or transform is active. The status bar covers muscle-memory
  hints; buttons would help first-time discovery.
- **Cursor feedback when painting outside the selection** — strokes silently
  no-op outside the clip path; dim or hide the brush cursor over no-paint regions
  so the user knows why nothing happens.

## Selection

- **Delete / Backspace inside selection** — clear pixels within the selected
  region while keeping the marquee.
- **Copy / Paste of selection contents** — Ctrl+C copies the lasso/rect content;
  Ctrl+V pastes as a new floating transform. Could use the system clipboard
  (image/png) for cross-app paste.
- **Selection ops** — Invert, expand/contract by N pixels, feather. All operate
  on the lassoPath / rect representation.

## Warp / Distort

- **Densify mesh past 3×3** — `+` / `-` keys (or buttons) while in mesh mode to
  step through 3×3 → 5×5 (or arbitrary N). The bilinear `resampleGrid` helper
  is already in place; just need bindings.
- **Cubic-bezier mesh warp** — Photoshop-style smooth curves between control
  points instead of the current piecewise-linear interpolation. Significantly
  more code: cubic patches per cell, evaluator for tessellated render.
- **True perspective / projective distort** — 4-corner free-corner distort with
  proper perspective. Canvas2D has no projective transform, so this requires
  WebGL for proper texture mapping (or much finer triangle tessellation as a
  hack).

## Export

- **`exportPsd` / `savePsd` consolidation done** — leaving a marker in case we
  want to extend with options like "include thumbnail", "flatten on export", etc.
