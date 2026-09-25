# slop-paint

A browser-based drawing app with pressure-sensitive brushes, layers and groups, and PSD
save/export that imports cleanly into [Spine 2D](https://esotericsoftware.com/spine-import-psd).
Designed **iPad-first for Apple Pencil**; mouse, trackpad and keyboard work too. A sibling of
slop-animator, sharing its brush engines, selection tools and look.

**▶ Try it: [slop-paint.meigo.workers.dev](https://slop-paint.meigo.workers.dev)** — on an iPad,
use Share → Add to Home Screen for a full-screen app.

Built with **Svelte 5 (runes) + TypeScript + Vite + Tailwind 4** on Canvas2D, tested with Vitest.

## Features

**Brushes**

- **Smooth** ([perfect-freehand](https://github.com/steveruizok/perfect-freehand)), **Ink** (optional
  pooling that swells the mark where the pen lingers), **Calligraphy** (a broad nib with adjustable
  angle and flatness), and textured **Pencil**, **Charcoal** and **Airbrush** tips
- Pressure curves — the brush and the eraser each have their own, edited as a bezier curve
- Brush and eraser keep their own size, opacity, smoothing, streamline, size range and brush type
- **Draw behind** — paint goes under what is already on the layer (flats under line art), a toggle
  on the brush toolbar
- Size presets, opacity, colour swatch with a palette and picker; set-once options (smoothing,
  streamline, size range, taper, nib, pressure curve) sit behind the gear

**Fill**

- Paint bucket with gap closing (semi-transparent edges count as walls) and expand (grows the fill
  under the outline so no seam shows)
- **Fill enclosed** — fills every area the layer's outlines enclose, behind the lines, in one step;
  **Bridge** closes small breaks in the outline

**Outline**

- Turns a layer's solid shapes into outlines — draw solid text, get outlined text at the same size
- **Thickness**, **Wobble** (the line wanders across the edge) and **Variation** (it swells and
  thins), plus a dice to re-roll the randomness; live preview, one undo step to apply

**Selection & transform**

- Rectangle and lasso selection; brush, eraser, fill and Outline stay inside it
- **Free transform** (move, scale, rotate, side stretch; Shift skews), **Distort** (4 corners) and
  **Mesh warp** (3×3), flip, keep proportions
- Copy, cut, paste and delete — including copying a transformed or warped selection as shown.
  Copies also go to the system clipboard as PNG; an image pasted from another app becomes a reference
- Every selection action is on the Select/Lasso toolbar row; with another tool active, an amber
  **Deselect** chip shows while a selection limits it

**Reference images**

- **File ▸ Import reference image…**, or paste an image copied in another app (Photos on an iPad):
  it lands on its own faint layer just below the one you draw on, ready to move and scale, tagged
  `[ignore]` so Spine skips it

**Layers**

- Layers and nested groups, drag-and-drop reordering, double-tap (or double-click) a name to rename
- Visibility, lock, **alpha lock** (paint only over existing pixels), opacity per layer and per group
- Duplicate, merge down; a resizable panel with thumbnails and a properties strip for the selected
  row
- Spine tags on layer and group names: `[slot]`, `[skin]`, `[bone]`, `[mesh]`, `[merge]`, `[ignore]`

**Undo**

- One undo stack for the whole document — strokes, fills, transforms, layer edits, renames,
  visibility, opacity and locks — 50 steps or 256 MB of snapshots

**View**

- **iPad:** the Pencil draws, fingers navigate — one finger pans; two fingers pan, zoom and rotate
  (snapping to 90° on lift); two-finger tap undoes, three-finger tap redoes; double-tap the Pencil
  to toggle the eraser
- **Trackpad:** two-finger swipe pans, pinch zooms. **Mouse:** wheel pans, Ctrl/Cmd+wheel zooms
- The status bar explains whatever control you touch — on iPad that is the only tooltip

**Files**

- **PSD is the project format** — save and open round-trip the layer tree, names, opacity, visibility
  and groups, and open PSDs from Photoshop, GIMP and others
- Export a flattened **PNG** or a **PSD** for Spine (groups become PSD folders, layer order is draw
  order); exports use document pixels, not the screen's
- **Autosave** to the browser (IndexedDB) a few seconds after each change and when the tab is hidden,
  restored on the next visit
- On iPad/iPhone, **File ▸ Save to Files…** shares the PSD through the share sheet
- On iPad, Share → Add to Home Screen runs it full-screen as an app

## Keyboard shortcuts

| Key                        | Action                                              |
| -------------------------- | --------------------------------------------------- |
| B / E / S / L / G / I      | Brush / eraser / select / lasso / fill / eyedropper |
| X (hold)                   | Temporary eraser                                    |
| [ / ]                      | Smaller / larger brush                              |
| Ctrl+Z / Ctrl+Shift+Z      | Undo / redo                                         |
| Ctrl+C / Ctrl+X / Ctrl+V   | Copy / cut / paste                                  |
| Delete or Backspace        | Clear the selection                                 |
| W / M                      | Distort / mesh warp the selection                   |
| Enter / Escape             | Apply / cancel a transform or Outline preview       |
| Space+drag or middle mouse | Pan                                                 |
| Ctrl+= / Ctrl+-            | Zoom in / out                                       |
| 0 / 1                      | Fit the view / 100% zoom                            |
| R / Shift+R                | Rotate the view 15° clockwise / counter-clockwise   |
| Ctrl+S / Ctrl+O / Ctrl+N   | Save / open project (PSD) / new document            |

Cmd works in place of Ctrl on a Mac.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run dev:lan    # also on your local network, to try it on an iPad
```

## Scripts

```bash
npm run build        # svelte-check + tsc + production build
npm run test         # Vitest, once (test:watch to keep watching)
npm run lint         # ESLint
npm run check        # svelte-check
npm run format       # Prettier (format:check to only check)
npm run deploy       # build, then deploy to Cloudflare Workers (static assets only)
node tools/make-icons.mjs  # regenerate the PNG icons from public/favicon.svg
```

A pre-commit hook runs ESLint and Prettier on staged files.
