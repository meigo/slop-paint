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
  angle and flatness), **Dry brush** (bristle stripes broken where the paint runs out, with hairy
  edges; Dryness sets how dry), and textured **Pencil** (with a grade, 4H to 8B: hard and light to soft and dark),
  **Charcoal** (with a texture, Rough to Dense) and **Airbrush** tips
- Pressure curves — the brush and the eraser each have their own, edited as a bezier curve
- **Press** on the brush bar: size is the medium width, light pressure thins the stroke and full
  pressure widens it, by up to that many times (as in slop-animator)
- **Stream** steadies the line like a lazy brush: it trails the pen on a string, so small wobbles
  never reach it, and the same on any device and at any zoom. Pause at a corner and the line turns
  there; lift and it finishes in a smooth curve to the pen
- **Smooth** (Smooth brush) rounds out wobble in the stroke's path with no lag; **Sharp corners
  where you pause** is an option, off by default for the rounded look
- Brush and eraser keep their own size, opacity, smoothing, stream, Press and brush type
- **Draw behind** — paint goes under what is already on the layer (flats under line art), a toggle
  on the brush toolbar
- Size presets, opacity, colour swatch with a palette and picker; set-once options (stream, and
  smoothing, sharp corners, taper, pool or nib for the brush that uses them, pressure curve) sit
  behind the gear

**Fill**

- The bucket has its own colour and opacity, so line colour and flat colour stay separate
- Paint bucket with **Bridge** (small breaks in the lines count as closed, so the fill doesn't leak
  out) and expand (grows the fill under the outline so no seam shows)
- **Fill enclosed** — fills every area the layer's outlines enclose, behind the lines, in one step;
  it uses the same Bridge

**Outline**

- Turns a layer's solid shapes into outlines — draw solid text, get outlined text at the same size
- **Thickness**, **Wobble** (the line wanders across the edge) and **Variation** (it swells and
  thins), plus a dice to re-roll the randomness; live preview, one undo step to apply

**Selection & transform**

- Rectangle and lasso selection; brush, eraser, fill and Outline stay inside it
- **Free transform** (move, scale, rotate, side stretch; Shift skews), **Distort** (4 corners) and
  **Mesh warp** (3×3 up to 8×8; finer keeps your bends), flip, keep proportions — with nothing
  selected they take the whole layer
- A selection you're moving or transforming shows as it will land: in its layer's place, with the
  layer's opacity and blend mode
- A transform belongs to the layer it came from: picking another layer applies it there first, and
  says so
- Copy, cut, paste and delete — including copying a transformed or warped selection as shown.
  Copies also go to the system clipboard as PNG; an image pasted from another app becomes a reference
- Every selection action is on the Select/Lasso toolbar row; with another tool active, an amber
  **Deselect** chip shows while a selection limits it

**Reference images**

- **File ▸ Import image…** (a file), **File ▸ Import image from clipboard**, or paste
  an image copied in another app (Photos on an iPad):
  it lands on its own faint layer just below the one you draw on, ready to move and scale, tagged
  `[ignore]` so Spine skips it
- A reference keeps its **original image**: select its layer and its handles are there (the Select
  tool comes on, and your tool comes back when you pick a drawing layer) — drag to move, corners
  scale, the top handle rotates — without losing detail. **Bake** turns it into a plain layer to paint on or
  warp it
- Saved in the PSD as a **Smart Object** (the original embedded), so it stays a reference when
  reopened here or in Photoshop

**Text**

- **Ghost text to letter over:** the T in the layer panel adds a text layer — faint, tagged
  `[ignore]` for Spine, moved, scaled and rotated like a reference and redrawn sharp at any size.
  Pick a font, size, line spacing, alignment and colour; **guide lines** rule the cap height,
  x-height and baseline under each line (blank lines too), for lettering by hand
- Four comic fonts built in (Comic Neue, Comic Neue Bold, Bangers, Patrick Hand), plus **your own
  font files** (TTF, OTF, WOFF, WOFF2) — added with + in the text dialog, kept on the device, and
  removed in **Edit ▸ Settings…**
- A text layer saves its font by name, as desktop apps do (the font file never goes in the PSD).
  Opening it where the font isn't installed keeps the saved picture and marks the layer until the
  font is added; **Bake** turns it into plain pixels

**Layers**

- Layers and nested groups: **New group** (or Ctrl+G) puts the selected layer or group into one;
  drag a row by its grip to reorder it (onto the lower half of a group's row to put it in the group,
  past the last row to take it out at the bottom; a locked group takes nothing in or out; a hidden one takes layers and hides them with it),
  double-tap (or double-click) a name to rename
- **Blend modes** per layer — Normal, Multiply, Screen, Overlay and Add — kept in the PSD (a PSD's
  other modes are kept too)
- Visibility, lock, **alpha lock** (paint only over existing pixels), opacity per layer and per group;
  locking a group locks everything in it
- Duplicate a layer or a whole group, merge down; a resizable panel with thumbnails and a properties strip for the selected
  row
- Spine tags on layer and group names: `[slot]`, `[skin]`, `[bone]`, `[mesh]`, `[merge]`, `[ignore]`;
  not using Spine? **Edit ▸ Settings…** hides the tag controls

**Undo**

- One undo stack for the whole document — strokes, fills, transforms, layer edits, renames,
  visibility, opacity and locks — 50 steps or 256 MB of snapshots

**View**

- **iPad:** the Pencil draws, fingers navigate — one finger pans; two fingers pan, zoom and rotate
  (snapping to 90° on lift); two-finger tap undoes, three-finger tap redoes; double-tap with one
  finger to toggle the eraser
- **Trackpad:** two-finger swipe pans, pinch zooms. **Mouse:** wheel pans, Ctrl/Cmd+wheel zooms
- The status bar explains whatever control you touch — on iPad that is the only tooltip

**Files**

- A **project name** (set in New, or in the Document menu) names the saved and exported files
- **PSD is the project format** — save and open round-trip the layer tree, names, opacity, visibility,
  groups, reference Smart Objects and text layers, and open PSDs from Photoshop, GIMP and others
- **Chrome and Edge on desktop:** Save writes back to the project's file (asking where only the
  first time), **Save as…** picks a new one, and a file you open saves back to itself. Elsewhere
  Save downloads the PSD — in Safari, Settings ▸ General ▸ File download location ▸ "Ask for each
  download" gives a name and folder dialog
- Export a flattened **PNG** or a **PSD** for Spine (groups become PSD folders, layer order is draw
  order); exports use document pixels, not the screen's
- **Autosave** to the browser (IndexedDB) a few seconds after each change — waiting while you draw —
  and when the tab is hidden, restored on the next visit. It also keeps copies from up to 15
  minutes back: **File ▸ Restore autosave…**
- If the layers ever come back **blank** (an iPad can reclaim the memory of an app left in the
  background), autosave stops before it overwrites the saved copy and offers to restore it. The
  Document menu shows how much memory the layers take, and warns on iPad when it's a lot
- **Edit ▸ Settings ▸ Sharp layers** keeps layers at the screen's pixel density: crisper when
  zoomed in, 4× the memory. Off by default on iPad; files are saved at document pixels either way
- On iPad/iPhone, **File ▸ Save to Files…** and both exports go through the share sheet (pick
  Save to Files there); in the Home Screen app, Save does too
- On iPad, Share → Add to Home Screen runs it full-screen as an app
- **Known issue — Chrome on iPad:** after the on-screen keyboard closes (typing text, renaming a
  layer), Chrome can leave the app shifted up with a blank band below, until you open a new tab. It's
  a Chrome bug the page can't reach. Use **Safari**, or the **Home Screen app** (it runs on Safari's
  engine even when added from Chrome) — neither has it

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
| Ctrl+Shift+S               | Save as… (Chrome and Edge on desktop)               |
| Ctrl+G                     | Put the selected layer or group into a new group    |
| ↑ / ↓                      | Select the layer above / below                      |

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
npm run test:ipad    # the app in WebKit at iPad size with touch (first: npx playwright install webkit)
npm run lint         # ESLint
npm run check        # svelte-check
npm run format       # Prettier (format:check to only check)
npm run deploy       # build, then deploy to Cloudflare Workers (static assets only)
node tools/make-icons.mjs  # regenerate the PNG icons from public/favicon.svg
```

A pre-commit hook runs ESLint and Prettier on staged files.
