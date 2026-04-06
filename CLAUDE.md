# Drawing App

Web-based drawing app with pressure-sensitive brushes, layers, and PSD export (Spine 2D compatible).

## Tech Stack
- TypeScript + Vite
- Canvas2D for rendering
- `perfect-freehand` for smooth brush strokes
- `ag-psd` for PSD export
- `sortablejs` for drag-and-drop layer tree
- Vitest for tests, ESLint for linting

## Commands
- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run test` — run tests once
- `npm run test:watch` — run tests in watch mode
- `npm run lint` — run ESLint

## Testing Guidelines
- **After adding new features**, write tests for any pure logic (no DOM/canvas dependencies)
- Tests go in `src/__tests__/` named `*.test.ts`
- Testable modules: `history.ts`, `pressure-curve.ts`, `viewport.ts`, `fill.ts` (hexToRgba)
- **Don't test**: Canvas rendering, pointer events, DOM manipulation — these need visual verification
- Run `npm run test && npm run lint` before considering a feature complete
- Run `npx tsc --noEmit` to type-check

## Architecture
- `main.ts` — wires everything together, UI bindings, event handling
- `input.ts` — pointer event handling with coord transform for zoom
- `brush.ts` — smooth brush via perfect-freehand
- `stamp-brush.ts` — textured stamp-based brushes (pencil, charcoal, airbrush)
- `brush-textures.ts` — procedural brush tip generation (cached at fixed sizes)
- `layers.ts` — tree-based layer/group management with per-layer undo history
- `history.ts` — undo/redo stack via ImageData snapshots
- `selection.ts` — rect/lasso selection with move/scale/rotate transform
- `viewport.ts` — zoom/pan via CSS transform with coordinate mapping
- `pressure-curve.ts` — cubic bezier pressure curve with LUT
- `fill.ts` — scanline flood fill
- `export-psd.ts` — PSD save/load/export with layer groups (Spine 2D compatible)

## PSD Export / Spine 2D
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
- Includes: tool, brush type, size, opacity, smoothing, taper, color, size range, pressure curve
