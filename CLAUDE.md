# Drawing App

Web-based drawing app with pressure-sensitive brushes, layers, and PSD export (Spine 2D compatible).

## Tech Stack

- Svelte 5 + TypeScript + Vite
- Tailwind CSS v4 for styling (dark only, shared slop palette — see `../SLOP-TIMELINE-UI.md`)
- `@lucide/svelte` for icons
- Canvas2D for rendering
- perfect-freehand for the Smooth brush; stamp-based engine for pencil, charcoal, airbrush
- `ag-psd` for PSD export
- `sortablejs` for drag-and-drop layer tree
- Vitest for tests, ESLint for linting, Prettier for formatting, `svelte-check` for Svelte type checking
- husky + lint-staged pre-commit hook: `eslint --fix` + `prettier --write` on staged files

## Commands

- `npm run dev` — start dev server
- `npm run dev:lan` — start dev server exposed on local network (for iPad testing)
- `npm run build` — production build (runs svelte-check + tsc + vite build)
- `npm run test` — run tests once
- `npm run test:watch` — run tests in watch mode
- `npm run lint` — run ESLint
- `npm run check` — run svelte-check
- `npm run format` / `npm run format:check` — Prettier

## Testing Guidelines

- **After adding new features**, write tests for any pure logic (no DOM/canvas dependencies)
- Tests go in `src/__tests__/` named `*.test.ts`
- Testable modules: `paste.ts`, `history.ts`, `pressure-curve.ts`, `viewport.ts`, `fill.ts` (hexToRgba, rgbToHex, sameImageData), `tool-settings.ts`, `brush.ts` (widthRange, decimationSmoothing, strokeOutline), `stamp-brush.ts` (stampFootprint), `selection.ts` (floorScale), `touch-gestures.ts` (snappedRotation)
- **Don't test**: Canvas rendering, pointer events, DOM manipulation, Svelte components — these need visual verification
- Run `npm run test && npm run lint` before considering a feature complete
- Run `npm run check` to verify Svelte components
- Run `npx tsc --noEmit` to type-check non-Svelte TypeScript

## Architecture

### Svelte UI Layer

- `main.ts` — bootstraps Svelte app (mounts `App.svelte`)
- `App.svelte` — root component: canvas setup, input/gesture wiring, keyboard shortcuts, settings persistence
- `appState.svelte.ts` — shared reactive state using Svelte 5 runes (`$state`): tool, brush/fill settings, layer version counter
- `lib/Toolbar.svelte` — two rows. Row 1 (fixed 48px): tool buttons, undo/redo, zoom readout, and File / Edit / Export / View menus. Row 2 (min 48px, wraps): options for the active tool (brush/fill options, size presets, click-to-edit size, color, pressure curve popup; eyedropper color readout; select hints). Row 2 keeps its height across tools so the canvas doesn't jump — keep its controls ≤ 36px tall. Row 1 must not get `overflow` (it would clip the menus)
- `lib/ToolbarMenu.svelte` — `Label ▾` dropdown (closes on outside pointerdown or Escape); items get a `close()` via the children snippet
- `lib/click-outside.ts` — Svelte action: call back on a pointerdown outside the node (capture phase); put it on a wrapper holding both trigger and popup
- `lib/LayerPanel.svelte` — layer tree with recursive snippets, SortableJS integration, thumbnails, inline rename
- `lib/actions/sortable.ts` — Svelte action wrapping SortableJS

### Canvas Engine (pure TypeScript, no Svelte)

- `input.ts` — pointer event handling with coord transform for zoom; filters pen/mouse from touch; pencil double-tap detection; point interpolation for sparse input; `pointercancel` (iPad palm rejection) ends the stroke like `pointerup`; the lift point reuses the last move's pressure (pen `pointerup` reports 0)
- `brush.ts` — BrushSettings, `widthRange` (size = thinnest width, × sizeRange at full pressure), and the Smooth brush (perfect-freehand). pf's `size` is a RADIUS basis, so it gets `maxSize / 2`; `decimationSmoothing` caps pf's point spacing so thin sections don't leave holes
- `stamp-brush.ts` — stamp engine for pencil/charcoal/airbrush, supports eraser/draw-behind/alpha-lock compositing; `stampFootprint` draws sub-2px stamps at 2px with reduced alpha (smaller tips downsample to nothing)
- `brush-textures.ts` — procedural brush tip generation (hard round, soft round, pencil, charcoal, airbrush)
- `layers.ts` — tree-based layer/group management with per-layer undo history, lock, alpha lock, duplicate, merge down
- `history.ts` — undo/redo stack via ImageData snapshots
- `selection.ts` — rect/lasso selection with move/scale/rotate transform; `copyPixels` / `clearRegion` / `liftPixels` (copy + clear) and `pasteFloat` (start a float from external pixels); the overlay sits inside the zoomed container, so handles/lines are sized with `px` (1 screen px in doc units) to stay constant on screen; corner scale is floored at `MIN_SCALE` (scale 0 froze the float)
- `viewport.ts` — zoom/pan/rotation via CSS transform with coordinate mapping
- `touch-gestures.ts` — iPad/touch gesture handling: one-finger pan, two-finger pinch-zoom-rotate, two-finger tap undo, three-finger tap redo
- `pressure-curve.ts` — cubic bezier pressure curve with LUT
- `tool-settings.ts` — brush/eraser stroke-setting slots (size, opacity, smoothing, streamline, size range, brush type); the active tool's values live in `app`, the other tool's in a slot, swapped in `setTool`
- `fill.ts` — scanline flood fill with alpha threshold (gap closing) and expand (dilation behind existing content)
- `export-psd.ts` — PSD save/load/export with layer groups (Spine 2D compatible)
- `paste.ts` — where pasted pixels land (`placeInternalPaste`: copied spot + 8px, kept on the page; `placeExternalImage`: centred, 1 image px = 1 doc px, scaled down to fit)

### State Management

- UI state uses Svelte 5 runes (`$state`, `$derived`) in `appState.svelte.ts`
- Canvas engine objects (LayerManager, Viewport, Selection) are imperative instances, NOT wrapped in `$state`
- `layerVersion` counter bridges imperative mutations to Svelte reactivity — bump it to trigger re-renders
- Settings persist to localStorage via debounced `$effect` in App.svelte

### Styling

- Tailwind CSS v4 with `@theme` for custom color tokens
- Dark only, on the shared slop palette (`../SLOP-TIMELINE-UI.md`, same hexes as slop-animator): zinc chrome (`surface`, `border`, `text`, `canvas-bg`), blue `accent` (#5b8cff) with near-black `accent-text`
- On-states: `.ui-on` for an active tool/toggle (accent fill), `.ui-selected` for the current layer/group row (10% accent tint + 2px left edge). Use these instead of `class:bg-accent` directives — layered utilities lose to emit order
- `#app` is `position: fixed` with `100dvh` height so iPad touch drags can't pan the page
- `app.css` contains Tailwind import + theme tokens + non-utility CSS (on-states, checkerboard, sortable, curve popup, sliders)

## iPad / Touch Support

- Apple Pencil draws; finger touch navigates (pan/zoom/rotate)
- One finger: pan canvas
- Two-finger pinch: zoom + pan + rotate (snaps to 90° within 5° on lift, pivoting on the pinch midpoint)
- Two-finger tap: undo; three-finger tap: redo
- Pencil double-tap: toggle between current tool and eraser
- Point interpolation ensures smooth strokes even with sparse pointer events

## Desktop Shortcuts

- B/E/S/L/G/I — brush/eraser/select/lasso/fill/eyedropper
- X (hold) — temporary eraser
- R / Shift+R — rotate canvas 15° CW/CCW
- 0 — reset view (zoom, pan, rotation); 1 — 100% zoom (plain keys: browsers reserve Ctrl/Cmd+digit)
- Ctrl+=/- — zoom in/out
- [ / ] — decrease/increase brush size
- Ctrl+Z / Ctrl+Shift+Z — undo/redo
- Ctrl+C / Ctrl+X / Ctrl+V — copy / cut / paste selection; Delete or Backspace — clear selection
- Ctrl+S / Ctrl+O — save/open project (PSD)
- Space+drag or middle mouse — pan

## Layer Features

- Lock: prevent editing
- Alpha lock: paint only on existing pixels
- Duplicate layer
- Merge down (onto layer below)
- Per-layer opacity, visibility, undo history
- Drag-and-drop reordering with groups

## Brush / Eraser Settings

- Brush and eraser each keep their own size, opacity, smoothing, streamline, size range and brush type (eraser defaults to size 8)
- Color, draw-behind and the pressure curve are shared
- Saved as the top-level fields (brush) plus an `eraser` object in the settings

## Eyedropper

- Samples the composited document (ignores layer lock); transparent pixels pick nothing
- Drag to aim (a swatch follows above-left of the point), release to pick; then returns to the previous tool
- Sets the shared color, which the brush and the fill tool both use

## Clipboard

- Copy keeps the selection's pixels in memory (layer resolution + source rect) and also writes a PNG at document resolution to the system clipboard (best effort; the ClipboardItem must be built synchronously with a Blob promise for Safari)
- Paste goes through the window `paste` event: an image on the system clipboard floats centred (scaled down to fit); if its size equals the internal copy's, the internal copy is used instead so it keeps its position. Pasted pixels float on the active layer with transform handles (Enter applies, Esc cancels); the paste is one undo step
- Edit menu Paste (for iPad without a keyboard) tries `navigator.clipboard.read()` and falls back to the internal copy
- Delete/cut are one undo step and skip the step if nothing changed

## Fill Tool

- Alpha threshold ("gap close"): treats semi-transparent pixels as walls to prevent leaking through antialiased stroke edges
- Expand: dilates fill by N pixels, drawn behind existing content to eliminate seams between fill and outlines
- Inside a selection or on an alpha-locked layer, the fill runs on a temp copy and is composited back (`copy` / `source-atop`); a fill that changes no pixels pushes no undo step

## New Document

- Creates a white-filled "Background" layer at the bottom and an empty "Layer 1" on top

## PSD Export / Spine 2D

- All exports (PNG, PSD) use CSS pixel dimensions (not physical/dpr-scaled pixels)
- Layer groups in the tree are exported as PSD group folders
- Layer/group names can include Spine tags: `[slot]`, `[skin]`, `[bone]`, `[mesh]`, `[merge]`, `[ignore]`
- Layer order = draw order (bottom drawn first)
- See: https://esotericsoftware.com/spine-import-psd

## Project Save/Load

- PSD is the project format — Ctrl+S to save, Ctrl+O to open
- Round-trips layer tree, names, opacity, visibility, groups
- Interoperable with Photoshop, GIMP, Spine, etc.

## Settings Persistence

- UI settings saved to localStorage (debounced)
- Includes: tool, brush type, size, opacity, smoothing, color, size range, pressure curve, draw-behind, fill settings, eraser settings
