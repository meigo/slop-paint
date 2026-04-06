# Drawing App

A web-based drawing application with pressure-sensitive brushes, layers, and PSD export. Built with TypeScript and Canvas2D.

## Features

### Brushes
- **Smooth** — vector strokes via perfect-freehand with pressure-sensitive width
- **Pencil** — grainy, graphite-like texture
- **Charcoal** — rough, chunky texture
- **Airbrush** — soft, diffused spray
- **Eraser** — removes pixels from the active layer
- **Paint Bucket** — flood fill with tolerance

### Brush Controls
- Size, opacity, smoothing sliders
- Adjustable size range — controls how much pressure expands beyond base size
- Taper toggle — tapered stroke ends on completion
- Pressure curve editor — cubic bezier curve to remap pressure response
- Color picker with quick-access swatches

### Layers
- Tree-based layer system with groups and nesting
- Drag-and-drop reordering via SortableJS — drag layers into/out of groups
- Per-layer undo/redo history (50 levels)
- Per-layer and per-group opacity and visibility (group opacity stacks)
- Double-click to rename layers or groups
- Collapsible groups
- New layers/groups are inserted relative to the current selection

### Selection & Transform
- **Rectangle select** — drag to select area
- **Lasso select** — freehand selection shape
- **Move** — drag inside selection
- **Scale** — drag corner handles
- **Rotate** — drag rotation handle above selection
- Enter to commit, Escape to cancel

### Zoom & Pan
- Mouse wheel to zoom toward cursor
- Ctrl+/- and Ctrl+0 for zoom shortcuts
- Space+drag or middle mouse button to pan
- Zoom level indicator in toolbar

### Save / Load
- **Save Project** (Ctrl+S) — saves as PSD with full layer tree, no trimming for round-tripping
- **Open Project** (Ctrl+O) — opens any PSD file (from this app, Photoshop, GIMP, etc.) and rebuilds layer tree

### Export
- **PNG** — flattened composite with transparency
- **PSD** — Photoshop format with all layers preserved, supports layer groups (trimmed for smaller files)

### Spine 2D Integration
PSD export is compatible with [Spine's PSD import](https://esotericsoftware.com/spine-import-psd):
- Layer groups are exported as PSD group folders
- Layer/group names support Spine tags: `[slot]`, `[skin]`, `[bone]`, `[mesh]`, `[merge]`, `[ignore]`
- Layer order matches Spine draw order (bottom layer drawn first)

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| Ctrl+S | Save project (PSD) |
| Ctrl+O | Open project (PSD) |
| B | Brush tool |
| E | Eraser tool |
| G | Paint bucket |
| S | Rectangle select |
| L | Lasso select |
| X (hold) | Temporary eraser |
| Space+drag | Pan canvas |
| [ / ] | Decrease/increase brush size |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Ctrl+/- | Zoom in/out |
| Ctrl+0 | Reset zoom |
| Enter | Commit selection |
| Escape | Cancel selection |

### Persistence
All UI settings are saved to localStorage and restored between sessions:
- Tool, brush type, size, opacity, smoothing, taper
- Color, size range, pressure curve

## Tech Stack
- TypeScript + Vite
- [perfect-freehand](https://github.com/steveruizok/perfect-freehand) — pressure-sensitive vector strokes
- [ag-psd](https://github.com/Agamnentzar/ag-psd) — PSD file generation
- Vitest + ESLint for testing and linting

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Scripts

```bash
npm run dev        # Start dev server
npm run build      # Production build
npm run test       # Run tests
npm run test:watch # Run tests in watch mode
npm run lint       # Run ESLint
```
