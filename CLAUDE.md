# Drawing App

Web-based drawing app with pressure-sensitive brushes, layers, and PSD export (Spine 2D compatible).

## Tech Stack
- Svelte 5 + TypeScript + Vite
- Tailwind CSS v4 for styling (light/dark mode via `.dark` class on `<html>`)
- `@lucide/svelte` for icons
- Canvas2D for rendering
- Stamp-based brush engine for all brush types (smooth, pencil, charcoal, airbrush)
- `ag-psd` for PSD export
- `sortablejs` for drag-and-drop layer tree
- Vitest for tests, ESLint for linting, `svelte-check` for Svelte type checking

## Commands
- `npm run dev` — start dev server
- `npm run dev:lan` — start dev server exposed on local network (for iPad testing)
- `npm run build` — production build (runs svelte-check + tsc + vite build)
- `npm run test` — run tests once
- `npm run test:watch` — run tests in watch mode
- `npm run lint` — run ESLint
- `npm run check` — run svelte-check

## Testing Guidelines
- **After adding new features**, write tests for any pure logic (no DOM/canvas dependencies)
- Tests go in `src/__tests__/` named `*.test.ts`
- Testable modules: `history.ts`, `pressure-curve.ts`, `viewport.ts`, `fill.ts` (hexToRgba)
- **Don't test**: Canvas rendering, pointer events, DOM manipulation, Svelte components — these need visual verification
- Run `npm run test && npm run lint` before considering a feature complete
- Run `npm run check` to verify Svelte components
- Run `npx tsc --noEmit` to type-check non-Svelte TypeScript

## Architecture

### Svelte UI Layer
- `main.ts` — bootstraps Svelte app (mounts `App.svelte`)
- `App.svelte` — root component: canvas setup, input/gesture wiring, keyboard shortcuts, settings persistence
- `appState.svelte.ts` — shared reactive state using Svelte 5 runes (`$state`): tool, brush/fill settings, theme, layer version counter
- `lib/Toolbar.svelte` — tool buttons, brush/fill options (size presets, click-to-edit size), color picker, zoom display, action buttons
- `lib/LayerPanel.svelte` — layer tree with recursive snippets, SortableJS integration, thumbnails, inline rename
- `lib/ThemeToggle.svelte` — light/dark mode toggle (persists to localStorage)
- `lib/actions/sortable.ts` — Svelte action wrapping SortableJS

### Canvas Engine (pure TypeScript, no Svelte)
- `input.ts` — pointer event handling with coord transform for zoom; filters pen/mouse from touch; pencil double-tap detection; point interpolation for sparse input
- `brush.ts` — BrushSettings interface (legacy perfect-freehand code, no longer used for rendering)
- `stamp-brush.ts` — stamp-based brush engine for all brush types, supports eraser/draw-behind/alpha-lock compositing
- `brush-textures.ts` — procedural brush tip generation (hard round, soft round, pencil, charcoal, airbrush)
- `layers.ts` — tree-based layer/group management with per-layer undo history, lock, alpha lock, duplicate, merge down
- `history.ts` — undo/redo stack via ImageData snapshots
- `selection.ts` — rect/lasso selection with move/scale/rotate transform
- `viewport.ts` — zoom/pan/rotation via CSS transform with coordinate mapping
- `touch-gestures.ts` — iPad/touch gesture handling: one-finger pan, two-finger pinch-zoom-rotate, two-finger tap undo, three-finger tap redo
- `pressure-curve.ts` — cubic bezier pressure curve with LUT
- `fill.ts` — scanline flood fill with alpha threshold (gap closing) and expand (dilation behind existing content)
- `export-psd.ts` — PSD save/load/export with layer groups (Spine 2D compatible)

### State Management
- UI state uses Svelte 5 runes (`$state`, `$derived`) in `appState.svelte.ts`
- Canvas engine objects (LayerManager, Viewport, Selection) are imperative instances, NOT wrapped in `$state`
- `layerVersion` counter bridges imperative mutations to Svelte reactivity — bump it to trigger re-renders
- Settings persist to localStorage via debounced `$effect` in App.svelte

### Styling
- Tailwind CSS v4 with `@theme` for custom color tokens
- Monochrome color scheme: `surface`, `border`, `text`, `accent` tokens
- Dark mode via `.dark` class on `<html>`, overrides CSS custom properties
- `app.css` contains Tailwind import + theme tokens + non-utility CSS (checkerboard, sortable, curve popup)

## iPad / Touch Support
- Apple Pencil draws; finger touch navigates (pan/zoom/rotate)
- One finger: pan canvas
- Two-finger pinch: zoom + pan + rotate (snaps to 90° increments)
- Two-finger tap: undo; three-finger tap: redo
- Pencil double-tap: toggle between current tool and eraser
- Point interpolation ensures smooth strokes even with sparse pointer events

## Desktop Shortcuts
- B/E/S/L/G — brush/eraser/select/lasso/fill
- X (hold) — temporary eraser
- R / Shift+R — rotate canvas 15° CW/CCW
- Ctrl+0 — reset view (zoom, pan, rotation)
- Ctrl+=/- — zoom in/out
- [ / ] — decrease/increase brush size
- Ctrl+Z / Ctrl+Shift+Z — undo/redo
- Ctrl+S / Ctrl+O — save/open project (PSD)
- Space+drag or middle mouse — pan

## Layer Features
- Lock: prevent editing
- Alpha lock: paint only on existing pixels
- Duplicate layer
- Merge down (onto layer below)
- Per-layer opacity, visibility, undo history
- Drag-and-drop reordering with groups

## Fill Tool
- Alpha threshold ("gap close"): treats semi-transparent pixels as walls to prevent leaking through antialiased stroke edges
- Expand: dilates fill by N pixels, drawn behind existing content to eliminate seams between fill and outlines

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
- Includes: tool, brush type, size, opacity, smoothing, color, size range, pressure curve, draw-behind, fill settings
- Theme preference saved separately to localStorage
