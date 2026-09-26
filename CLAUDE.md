# Drawing App

Web-based drawing app with pressure-sensitive brushes, layers, and PSD export (Spine 2D compatible).

## Tech Stack

- Svelte 5 + TypeScript + Vite
- Tailwind CSS v4 for styling (dark only, shared slop palette — see `../SLOP-TIMELINE-UI.md`)
- `@lucide/svelte` for icons
- Canvas2D for rendering
- Brush engines: perfect-freehand (Smooth), ink/marker (Ink), swept-nib ribbon (Calligraphy), stamp tips (Pencil, Charcoal, Airbrush)
- `ag-psd` for PSD export
- `sortablejs` for drag-and-drop layer tree
- Vitest for tests, ESLint for linting, Prettier for formatting, `svelte-check` for Svelte type checking
- husky + lint-staged pre-commit hook: `eslint --fix` + `prettier --write` on staged files

## App Icon

- The shared slop mark, colour-coded per app: slop-paint is turquoise `#66fff0` (the family blue `#667fff` at hue 174°, same saturation and lightness; the rule and every app's colour are in `../SLOP-FAVICON-COLOURS.md`). Source of truth is `public/favicon.svg`; regenerate the PNGs with `node tools/make-icons.mjs` (from slop-animator, dependency-free). Title, manifest and home-screen tags are in `index.html` / `public/manifest.webmanifest`

## Commands

- `npm run dev` — start dev server
- `npm run dev:lan` — start dev server exposed on local network (for iPad testing)
- `npm run build` — production build (runs svelte-check + tsc + vite build)
- `npm run deploy` — build, then `wrangler deploy` to the Cloudflare Worker `slop-paint` (`wrangler.jsonc`: assets-only, no Worker script, as slop-animator; `public/_headers` caches only the content-hashed `/assets/*`). Manual, not on push; the name matches the Worker first made in the Cloudflare dashboard, so a deploy replaces it in place. `preview_urls: false`: no preview/alias URLs (the 2026-09-26 debug aliases were turned off this way — Wrangler can't delete an alias, and versions are immutable history)
- `npm run test` — run tests once
- `npm run test:watch` — run tests in watch mode
- `npm run lint` — run ESLint
- `npm run check` — run svelte-check
- `npm run format` / `npm run format:check` — Prettier

## Testing Guidelines

- **After adding new features**, write tests for any pure logic (no DOM/canvas dependencies)
- Tests go in `src/__tests__/` named `*.test.ts`
- Testable modules: `paste.ts`, `history.ts`, `pressure-curve.ts`, `viewport.ts`, `fill.ts` (hexToRgba, rgbToHex, sameImageData), `fill-holes.ts`, `mask-ops.ts`, `share.ts`, `panel-layout.ts`, `lib/slider-fill.ts`, `lib/double-tap.ts`, `tool-settings.ts`, `brush.ts` (widthRange, decimationSmoothing, strokeOutline), `stamp-brush.ts` (stampFootprint), `ink-brush.ts`, `calligraphy-brush.ts`, `selection.ts` (floorScale, flipMatrix, cornerScaleMatrix, sideStretchMatrix), `outline.ts`, `touch-gestures.ts` (snappedRotation), `ref-placement.ts`, `ref-tool.ts`
- **Don't test**: Canvas rendering, pointer events, DOM manipulation, Svelte components — these need visual verification
- Run `npm run test && npm run lint` before considering a feature complete
- A bug seen only on the deployed site: reproduce it against the production build (`npm run build && npx vite preview`), not `npm run dev` — the minified bundle can behave differently (see Undo)
- Run `npm run check` to verify Svelte components
- Run `npx tsc --noEmit` to type-check non-Svelte TypeScript

## Architecture

### Svelte UI Layer

- `main.ts` — bootstraps Svelte app (mounts `App.svelte`)
- `App.svelte` — root component: canvas setup, input/gesture wiring, keyboard shortcuts, settings persistence
- `appState.svelte.ts` — shared reactive state using Svelte 5 runes (`$state`): tool, brush/fill settings, layer version counter; `statusHint` carries the `title` of whatever the pointer is over (see the status bar below); `flashStatus(msg, ms)` shows a status-bar message (use it when an action does nothing, so a no-op isn't silent); `ms = 0` is sticky, for conditions like autosave failing
- `lib/Toolbar.svelte` — two rows. Row 1 (fixed 48px): tool buttons, undo/redo, zoom readout, and File / Edit / Document / View menus — the same four, in the same order and naming, as planned for slop-animator: File = New, Open, Save, Save to Files │ Import image, Import image from clipboard │ Export PNG, Export PSD for Spine; Edit = Undo/Redo │ Cut/Copy/Paste/Delete │ Select all/Deselect │ Clear layer │ Settings… (as Photoshop's Edit ▸ Preferences); Document = project name, Resize canvas; View = Fit, Actual size. Short verbs, "…" when a dialog follows, shortcuts as key chips. Row 2 (min 40px, wraps — the same as slop-animator's tool options row): options for the active tool. On the bar: what is changed while drawing (brush type, size + presets, opacity, draw-behind toggle for the brush, color swatch). Behind popovers: the gear holds set-once settings (smoothing, streamline, size range, nib angle/flatness for Calligraphy, dwell for Ink, taper for Smooth, pressure curve editor for the active tool), the color swatch holds the palette + native picker. Needs ~750px, so it fits a portrait iPad. Row 2 keeps its height across tools so the canvas doesn't jump — keep its controls ≤ 28px tall, and wrap bare buttons in a flex box (a bare button sits on the text baseline and is 40px). Row 1 must not get `overflow` (it would clip the menus)
- Brush kinds: `BrushKind` = smooth | ink | calligraphy | stamp tips. Smooth/ink/calligraphy redraw the whole stroke each frame from a pre-stroke canvas copy (a per-segment redraw hardens antialiased edges); stamps draw incrementally
- `lib/ToolbarMenu.svelte` — `Label ▾` dropdown (closes on outside pointerdown or Escape); items get a `close()` via the children snippet
- `lib/click-outside.ts` — Svelte action: call back on a pointerdown outside the node (capture phase); put it on a wrapper holding both trigger and popup
- Selection actions have NO floating bar over the canvas (unlike slop-animator): all of them sit in row 2 of the Select/Lasso tools — Copy, Cut, Paste, Delete, Deselect, Select all (icons) │ Free transform, Distort, Mesh │ Flip H/V, keep proportions │ Apply, Cancel. A float can only exist on Select/Lasso (switching tools applies it), so the row is always showing when there is one. Buttons that can't act are dimmed with a reason (nothing selected, layer locked/hidden, apply or cancel first), never removed, so nothing moves. With NO marquee, Free transform / Distort / Mesh / Flip take the whole active layer, as Photoshop's Ctrl+T (`selectLayerContent`: a marquee around the layer's pixels via `alphaBounds`, so the handles hug the art; "the layer is empty" when there are none); their titles say "whole layer". On a reference the status bar's tool label reads "Reference". For every other tool, row 2 ends in an amber Deselect chip while a marquee exists: it silently limits where brush, eraser, fill and Outline paint
- `lib/SettingsDialog.svelte` — Edit ▸ Settings…: app preferences, saved with the other settings (not in the document). So far one: `app.spineTools` (default on). Off HIDES the Spine UI only — the layer strip's tag chips and tag menu, and the Spine wording of the PSD export ("Export PSD (trimmed)"); tags already in names stay and are still exported, and references still get `[ignore]`
- `lib/LayerProps.svelte` — properties strip for the selected layer or group, ONE compact row as slop-animator's: opacity (Blend icon, slider, number), Spine tag chips + tag menu, and a pencil that starts the rename (`onRename`)
  - Layer/group objects are NOT `$state`, so a field needs its own `$derived` that reads `app.layerVersion` (`opacity`, `tags`). A template reading `target.opacity` never re-runs — the node's identity doesn't change on an edit — and the strip showed a stale value while the canvas already had the new one
- `lib/LayerPanel.svelte` — layer tree in Svelte markup: recursive snippets, Lucide icons, thumbnails via a canvas action, inline rename on double-click AND double-tap (`lib/double-tap.ts`; iPad doesn't fire dblclick reliably), Spine tag popover. Every control carries a `title`, which is also what the status bar shows on touch
- Row layout (as slop-animator's): ONE line, `text-sm` names (the selected one `text-text`), 20px thumbnails drawn at 40px; rows run full width and indent their CONTENT 16px per group level (`depth`), so the rail and the selected bar sit on the panel edge; group headers have no band of their own. Identity on the left (grip, thumbnail, name), state on the right in fixed 20px columns (alpha lock, lock, eye — same order, glyphs and colours as slop-animator; a group row leaves the first two empty) so it lines up across rows. Per-layer CONTROLS (opacity, Spine tags) live in `lib/LayerProps.svelte`, a fixed-height strip above the list that follows the selected row (as slop-animator did), so a row never grows when selected and the row under the Pencil never moves. Nested rows carry `.group-rail`, a background-image rail that the selected-row bar paints over (a border on the container drew a second line)
- The panel is resizable by dragging its left edge (`panel-layout.ts`: min 184px, max half the viewport); the width is saved with the other settings
- Placement: App.svelte lays the two toolbar rows (Toolbar's roots carry `grid-area` row1 / row2), the canvas and the panel out in ONE grid with two arrangements (so nothing re-mounts). Toolbar row 1 always spans the full width. The panel starts right under it, beside the tool-options row, when that row still fits next to it (`panelBesideToolOptions`: viewport − panel ≥ `TOOL_OPTIONS_WIDTH`, 960px — the brush row measured 949; re-measure when a row gains a control), else it starts below the options row too (iPad). Wheel/trackpad pan-zoom listens on the canvas area only, so the layer list scrolls
- The list is rebuilt by `{#key version:dragNonce}` — the layer tree is imperative, so a `layerVersion` bump is what re-renders it. After a SortableJS drop: read the order back from the DOM, remove the node SortableJS relocated (a bottom drop lands past the `{#each}` anchor and would survive as a duplicate), then bump `dragNonce` to rebuild from state. A drop can fire `onEnd` twice (cross-list), so a latch runs the rebuild once
- `lib/actions/sortable.ts` — Svelte action wrapping SortableJS

### Canvas Engine (pure TypeScript, no Svelte)

- `input.ts` — pointer event handling with coord transform for zoom; App binds it to the whole canvas AREA (not the page canvas), so any tool's gesture can start off the page — strokes clip at the page edge, and a NEW marquee/lasso is clamped onto the page (`Selection.pageSize`, `clampToPage`) while moving a float is not; filters pen/mouse from touch; pencil double-tap detection; point interpolation for sparse input; `pointercancel` (iPad palm rejection) and `lostpointercapture` end the stroke like `pointerup`; only the pointer that started a stroke can extend or end it (a resting finger can't); the lift point reuses the last move's pressure (pen `pointerup` reports 0)
- `brush.ts` — BrushSettings, `widthRange` (size = nominal width; pressure thins it to size ÷ Press and widens it to size × Press, as slop-animator), and the Smooth brush (perfect-freehand). pf's `size` is a RADIUS basis, so it gets `maxSize / 2`; `decimationSmoothing` caps pf's point spacing so thin sections don't leave holes
- `ink-brush.ts` — Ink/marker: full-stroke redraw, segments batched into runs of similar width; optional dwell swell (from slop-animator)
- `calligraphy-brush.ts` — broad-nib ribbon with nib angle/flatness; smooths and decimates points first (from slop-animator)
- `stamp-brush.ts` — stamp engine for pencil/charcoal/airbrush, supports eraser/draw-behind/alpha-lock compositing; `stampFootprint` draws sub-2px stamps at 2px with reduced alpha (smaller tips downsample to nothing)
- `brush-textures.ts` — procedural brush tip generation (hard round, soft round, pencil, charcoal, airbrush)
- `layers.ts` — tree-based layer/group management with lock, alpha lock, duplicate, merge down; `captureStructure`/`restoreStructure` snapshot the tree's SHAPE (layers by reference, so their canvases survive undo), `snapshotOf`/`restoreTo` do pixels for one layer
- `history.ts` — one undo/redo stack of commands for the whole document, with a 50-step / 256 MB budget (from slop-animator)
- `undo.ts` — the single `history` instance plus `pushPixelEdit` (a pixel change on one layer) and `structuralEdit` (add/delete/duplicate/merge/group/reorder; takes an optional layer whose pixels change too, as merge down does)
- `selection.ts` — rect/lasso selection with move/scale/rotate transform; `copyPixels` / `clearRegion` / `liftPixels` (copy + clear) and `pasteFloat` (start a float from external pixels); `flip`; pure `flipMatrix` / `cornerScaleMatrix` / `sideStretchMatrix` (from slop-animator). Corners keep proportions when `keepProportions` (Shift inverts), side handles stretch one axis (Shift skews); the overlay sits inside the zoomed container, so handles/lines are sized with `px` (1 screen px in doc units) to stay constant on screen; corner scale is floored at `MIN_SCALE` (scale 0 froze the float)
- `viewport.ts` — zoom/pan/rotation via CSS transform with coordinate mapping
- `touch-gestures.ts` — iPad/touch gesture handling: one-finger pan, two-finger pinch-zoom-rotate, two-finger tap undo, three-finger tap redo
- `pressure-curve.ts` — cubic bezier pressure curve with LUT. Brush and eraser have their own (`pressureCurves`, `activePressureCurve()`); settings saved before the split give the eraser the brush's curve
- `tool-settings.ts` — brush/eraser stroke-setting slots (size, opacity, smoothing, streamline, size range, brush type); the active tool's values live in `app`, the other tool's in a slot, swapped in `setTool`
- `fill.ts` — scanline flood fill with alpha threshold (gap closing) and expand (dilation behind existing content); `enclosedFillRegion` / `fillRegionBehind` for Fill enclosed
- `fill-holes.ts` — Fill enclosed engine (from slop-animator): floods the outside from the border, so a leaking outline fills nothing; `gap` (clamped to `MAX_GAP` = 8, device px) bridges breaks via dilate → flood → erode
- `outline.ts` — Outline tool engine (from slop-animator): signed distance field seeded sub-pixel from the alpha, a band of `thickness` inside the edge whose position (Wobble) and width (Variation) come from two seeded noise planes; `bleedColor` keeps the colour under an outward wobble; `alphaBounds` for the working region
- `mask-ops.ts` — circular dilate/erode on binary masks (shared by expand and Fill enclosed)
- `export-psd.ts` — PSD save/load/export with layer groups (Spine 2D compatible); `psdBuffer()` is the buffer used by both the file writer and autosave
- `persist/` — `db.ts` (IndexedDB helper), `autosave.ts` (single-slot project autosave), `generation.ts` (supersede guard)
- `ref-placement.ts` — pure: a reference's placement as 4 page corners (tl, tr, br, bl; always a parallelogram, as only move/scale/rotate/flip are offered), `matrixFromCorners` / `cornersFromMatrix`, PSD `placedLayer` transform conversion, `fitDecodedSize` (decoded copy ≤ 4096 a side and 16M px, for iPad), `smartObjectFor` / `refFromPlaced`
- `ref-image.ts` — `decodeRefSource`: the file's bytes kept whole + a capped drawing copy
- `paste.ts` — where pasted pixels land (`placeInternalPaste`: copied spot + 8px, kept on the page; `placeExternalImage`: centred, 1 image px = 1 doc px, scaled down to fit)

### State Management

- UI state uses Svelte 5 runes (`$state`, `$derived`) in `appState.svelte.ts`
- Canvas engine objects (LayerManager, Viewport, Selection) are imperative instances, NOT wrapped in `$state`
- `layerVersion` counter bridges imperative mutations to Svelte reactivity — bump it to trigger re-renders
- Settings persist to localStorage via debounced `$effect` in App.svelte

### Styling

- Tailwind CSS v4 with `@theme` for custom color tokens
- Focus rings: `:focus-visible` gets a 2px accent outline (offset 1); `:focus:not(:focus-visible)` clears it, so a ring only appears for keyboard use. Never remove one outright
- `--color-warn` (#d5b75d) means "here is why this won't behave as you expect": a locked or hidden layer, a warning in a dialog. Not for emphasis
- Controls in a bar share ONE height (28px, as in slop-animator's tool options row). The size presets are the documented exception at 24px
- Radii: 6px controls, 8px panels/popovers/dialogs. Inputs sit on `surface-raised`, never on the same colour as the bar behind them
- On-states use `.ui-on`; don't hand-roll `bg-accent text-accent-text`. `accent` means selection/active only — not document metadata like Spine tags
- Dark only, on the shared slop palette (`../SLOP-TIMELINE-UI.md`, same hexes as slop-animator): zinc chrome (`surface`, `border`, `text`, `canvas-bg`), blue `accent` (#5b8cff) with near-black `accent-text`
- On-states: `.ui-on` for an active tool/toggle (accent fill), `.ui-selected` for the current layer/group row (10% accent tint + 2px left edge). Use these instead of `class:bg-accent` directives — layered utilities lose to emit order
- `#app` is `position: fixed` with `100dvh` height so iPad touch drags can't pan the page
- `app.css` contains Tailwind import + theme tokens + non-utility CSS (on-states, checkerboard, sortable, curve editor, sliders)
- Sliders follow the family style (SLOP-TIMELINE-UI.md §6): 4px track, 12px round thumb, and the filled portion drawn as a gradient. `appearance: none` (needed to size the thumb) loses the browser's own fill, so every slider passes `style={sliderFill(value, min, max)}` (`lib/slider-fill.ts`) — a new slider without it renders an empty track

## iPad / Touch Support

- Apple Pencil draws; finger touch navigates (pan/zoom/rotate)
- One finger: pan canvas
- Two-finger pinch: zoom + pan + rotate (snaps to 90° within 5° on lift, pivoting on the pinch midpoint)
- Two-finger tap: undo; three-finger tap: redo
- Pencil double-tap: toggle between current tool and eraser
- Point interpolation ensures smooth strokes even with sparse pointer events

## Desktop Shortcuts

- B/E/S/L/G/I — brush/eraser/select/lasso/fill/eyedropper (Outline has no key)
- X (hold) — temporary eraser
- R / Shift+R — rotate canvas 15° CW/CCW
- 0 — reset view (zoom, pan, rotation); 1 — 100% zoom (plain keys: browsers reserve Ctrl/Cmd+digit)
- Ctrl+=/- — zoom in/out
- [ / ] — decrease/increase brush size
- Ctrl+Z / Ctrl+Shift+Z — undo/redo
- Ctrl+C / Ctrl+X / Ctrl+V — copy / cut / paste selection; Delete or Backspace — clear selection
- Ctrl+S / Ctrl+O — save/open project (PSD)
- ↑ / ↓ — select the layer or group row above/below (`adjacentRow`; skips a collapsed group's members; ignored while a slider/dropdown has focus or a selection is lifted)
- Space+drag or middle mouse — pan
- Trackpad: two-finger swipe pans, pinch zooms; mouse wheel pans, Ctrl/Cmd+wheel zooms (as in slop-animator)

## Layer Features

- Lock: prevent editing. Groups lock too, and lock every member without changing the members' own locks; check with `layers.isLocked(node)` (`lockedInTree`), never `.locked`. A layer locked only by its group shows an amber lock with its own icon. Locks are not saved in the PSD (nor autosave)
- Alpha lock: paint only on existing pixels
- Duplicate layer, or a whole group (`duplicateGroup`: every member copied with fresh ids, placed above the original)
- Merge down (onto layer below)
- Per-layer opacity, visibility
- Drag-and-drop reordering with groups

## Brush / Eraser Settings

- Brush and eraser each keep their own size, opacity, smoothing, streamline, Press (size range), brush type (eraser defaults to size 8) and pressure curve
- Press is 1–8, default 3, on the brush bar (slop-animator's model): size is the nominal width, light pressure thins to size/Press, full pressure widens to size×Press. Mouse strokes ignore it and draw at size. A saved value outside 1–8 is clamped
- Smoothing and taper apply to Smooth only; Pool (how much ink swells where the pen lingers) to Ink only; nib angle and flatness to Calligraphy only
- Brush colour and draw-behind are shared by brush and eraser. Draw-behind stays on the bar. Fill has its OWN colour and opacity (`app.fillColor` / `fillOpacity`, as slop-animator): the toolbar's swatch and opacity slider edit the active tool's; a save without a fill colour seeds it from the brush's
- Saved as the top-level fields (brush) plus an `eraser` object in the settings

## Brush Cursor

- As slop-animator's BrushCursor (`updateBrushCursor` in App.svelte): the nominal stroke width at the current zoom, drawn as the nib itself for Calligraphy (flattened by nib flatness, turned by nib angle + the view's rotation), dashed for the eraser, with a centre dot; a dark ring with a light halo. Shown anywhere in the canvas area; hidden, with a not-allowed cursor, on a locked or hidden layer

## Eyedropper

- Samples the composited document (ignores layer lock); transparent pixels pick nothing
- Drag to aim (a swatch follows above-left of the point), release to pick; then returns to the previous tool
- Sets the colour of the tool it returns to: the fill's when it came from Fill (`app.eyedropperTarget`), else the brush's

## Reference Layers (Smart Objects)

- An imported/pasted image becomes a layer with `layer.ref = { src, corners }`: `src` holds the ORIGINAL file bytes and a decoded copy (shared by duplicates), `corners` where it sits. `layers.renderRef` re-draws the layer from the original, so scaling down and up loses nothing
- Handles as slop-animator: while a reference is the active layer (loaded, unlocked, visible) its transform handles show, WHATEVER the tool, and any canvas drag moves/scales/rotates it (eyedropper excepted). `syncRefHandles` (an effect on layerVersion + selectionVersion) shows or drops them; they come from the Selection in `handlesOnly` mode (`pasteFloat(…, true)`: no float drawn, `hasFloating` false, so saves, tool switches, ↑/↓ and undo treat it as nothing pending; App's `selectionState` reports idle). The layer itself is re-drawn from the original as the handles move (`renderRef(layer, corners, fast)`, once per frame), so it keeps its place in the layer order. Each release is one `pushRefEdit` (none for a tap); there is no Apply — picking another layer just leaves it. Esc/Enter clear the handles and they come straight back. Undo replaces `layer.ref`, which re-syncs the handles. Distort/Mesh are dimmed ("Bake it to warp it"); Flip acts on the reference
- Tool follow (as slop-animator's 2026-09-26 change, where it is Transform): the active layer BECOMING a reference switches to Select (its row has Free transform lit, Flip, Keep proportions) and remembers the tool; becoming a non-reference hands it back, only if still on Select (a tool picked meanwhile stays). Already on Select/Lasso: nothing owed. Eyedropper/Outline are never handed back to (Brush instead). Pure `ref-tool.ts` `refFocusChange`; an App effect on layerVersion with a `lastOnRef` latch, so every way the layer changes (tap, ↑/↓, undo, import, open) is covered. The handles still work under any tool. Accepted, as animator: the remembered tool isn't saved, so after a reload with a reference selected, picking a drawing layer stays on Select
- Painting, fill, Fill enclosed, Outline, clear, delete, cut and paste-into are refused with a status message; Merge down refuses onto a reference (its re-draw would wipe the merge). Bake (`pushRefEdit(…, ref, undefined)`) makes it a plain layer, one undo step
- PSD: written as `placedLayer` + `linkedFiles` (ag-psd), with the rendered pixels as the layer image; opening decodes the originals async (until then it can't be transformed). Canvas resize shifts the corners with the pixels

## Clipboard

- On iPad (no keyboard) the clipboard actions are in row 2 of the Select/Lasso tools (see Svelte UI Layer); the Edit menu keeps them too
- Copy also takes a float, as shown (transform/warp applied), cropped to its bounds (a mesh's bounds cover every grid point)
- Copy keeps the selection's pixels in memory (layer resolution + source rect) and also writes a PNG at document resolution to the system clipboard (best effort; the ClipboardItem must be built synchronously with a Blob promise for Safari)
- Paste goes through the window `paste` event: an image on the system clipboard becomes a REFERENCE layer (below); if its size equals the internal copy's, the internal copy is used instead so it keeps its position. Pasted pixels float on the active layer with transform handles (Enter applies, Esc cancels); the paste is one undo step
- Edit menu / row-2 Paste (for iPad without a keyboard) tries `navigator.clipboard.read()` and falls back to the internal copy. Never dimmed — the system clipboard may hold an image from another app (Photos) the app can't see until it asks; an empty paste says so in the status bar
- Delete/cut are one undo step and skip the step if nothing changed; so does applying an untouched transform (an import applied as it landed made the next undo appear to do nothing)

## Reference Images

- File ▸ Import image… (a file), File ▸ Import image from clipboard (only the system clipboard's image; says so when there is none), or pasting an image from another app, adds a reference: a layer carrying `ref` (see Reference Layers above) named `[ignore]ref <file>` (`referenceLayerName`, `paste.ts`) so Spine's PSD import skips it, at 60% (`REFERENCE_OPACITY`), inserted just BELOW the active layer (`addLayerBelow`) so the drawing traces over it, fitted to the page (1 image px = 1 doc px, scaled down only). One undo step; it becomes the active layer with its handles showing (and the Select tool, see Tool follow) — drag to place it; picking your layer again brings your tool back
- It keeps its original, so rescaling later loses nothing (Bake makes it plain pixels); PNG export includes it unless hidden
- Saves and exports (`withFloatApplied`) draw a lifted float into its layer for the save and put the layer back: a lift leaves a hole until applied, and an autosave mid-transform stored that hole

## Undo

- One stack for the document: strokes, fills, clears, selection commits, structural edits (add, delete, duplicate, merge down, group, drag-reorder) name edits (rename, Spine tags — tags live in the name) and per-node fields (visibility, opacity, lock, alpha lock) undo in the order they were made, on whichever layer they touched
- An opacity DRAG is one step: `LayerProps` opens it on the first `input` and closes it on `change`/release, so slider travel doesn't fill the stack
- `pushNameEdit` / `pushNodeFieldEdit` look their node up by id at apply time: `restoreStructure` rebuilds group nodes as fresh clones, so a captured group object can be detached by an unrelated structural undo
- The stack is cleared by New, Open, autosave restore and canvas resize (its snapshots are the old canvas size)
- Budget: 50 steps or 256 MB of pixel snapshots, whichever comes first
- Undo redrawing (2026-09-26): the real cause of "undo empties its stack but the stroke stays until the next stroke" was the PRODUCTION MINIFIER, in every browser, never in `npm run dev`. `undo.ts` held the redraw hook in an `export let` reassigned by `setOnHistoryApplied`; the minifier inlined its initial no-op and deleted every call. The hook now lives on an object (`hooks.onHistoryApplied`). Do not bring back an exported `let` that a setter reassigns. Changes made while chasing it that were NOT the fix: a `putImageData` workaround (removed again — undo writes layers with plain `putImageData`, as slop-animator), and the on-screen canvas losing `willReadFrequently` (kept: it is accelerated, as slop-animator's display)

## Status Bar

- Actions that can't act are dimmed with `aria-disabled` + a title saying why, never `disabled` (a disabled button dispatches no pointer events, so the status bar's hint could never read its title — and on iPad the hint is the only explanation)
- Fixed height, `px-5` so text clears an iPad's rounded window corners. Right side: the active tool
- Left side, in priority order: an explicit message (`flashStatus`, e.g. why an action did nothing), then `statusHint` — the `title` of the control under the pointer — then the selection/transform context
- The hint is written on `pointerover` AND `pointerdown` (capture) in App.svelte, since iPad has no hover: touching a control explains it. A `pointerover` resolving to the same element is ignored, or pointer capture's boundary events would clear a message the press just wrote
- Give every new control a `title`: on touch it is the only explanation the user gets

## Outline Tool

- Hollows the active layer's shapes to a line of `Thickness` (0.5–24 device px) inside the edge; Wobble moves it across the edge, Variation swells/thins it, the dice re-rolls the noise. Knobs are in toolbar row 2, session-only
- Picking the tool previews at once, written INTO the layer (so layer/group opacity apply) and re-derived from a snapshot on each knob change, once per frame. Apply (✓ / Enter) is one undo step and hands back the previous tool; Cancel (✗ / Esc), undo, switching tool or layer, locking the layer, New/Open/Resize all restore the snapshot. Refused on locked, hidden or empty layers; with no live preview a canvas tap starts one
- A marquee clips the write, not the maths (the line is truncated at the cut); alpha lock never adds ink
- Clear layer, copy/cut/delete cancel a live preview first, so their snapshots hold the art

## Fill Tool

- Alpha threshold ("gap close"): treats semi-transparent pixels as walls to prevent leaking through antialiased stroke edges
- Expand: dilates fill by N pixels, drawn behind existing content to eliminate seams between fill and outlines
- Fill enclosed (button in the fill options): fills every area the active layer's outlines enclose, behind the lines, in one undo step; Bridge (0–8, saved) closes outline breaks of about 2× that many device px. Refused on locked / alpha-locked layers. Cost grows with Bridge (≈0.3 s at 0, ≈1.6 s at 8 on a 1920×1080 doc at dpr 2, blocking)
- Inside a selection or on an alpha-locked layer, the fill runs on a temp copy and is composited back (`copy` / `source-atop`); a fill that changes no pixels pushes no undo step

## New Document

- The dialog warns (in `warn`) that it replaces the drawing, its undo history and the autosaved copy
- App shortcuts stand aside only for real text entry (`lib/text-entry.ts` `isTextEntry`): a slider keeps focus after a drag (the canvas prevents the focus change on press), and treating every `<input>` as a text field left Ctrl+Z and the tool keys dead after touching one. A focused `<select>` lets only Ctrl/Cmd shortcuts through
- Dialogs handle Enter/Escape on `window` (a backdrop never has focus, so a keydown there never fires), and App.svelte ignores app shortcuts while one is open

- Creates a white-filled "Background" layer at the bottom and an empty "Layer 1" on top

## PSD Export / Spine 2D

- All exports (PNG, PSD) use CSS pixel dimensions (not physical/dpr-scaled pixels)
- Layer groups in the tree are exported as PSD group folders
- Layer/group names can include Spine tags: `[slot]`, `[skin]`, `[bone]`, `[mesh]`, `[merge]`, `[ignore]`
- Layer order = draw order (bottom drawn first)
- See: https://esotericsoftware.com/spine-import-psd

## Autosave

- The project is autosaved to IndexedDB (db `slop-paint`, store `kv`, key `autosave`) as a PSD buffer, 3s after the last change and immediately when the tab is hidden (`pagehide` / `visibilitychange`), and restored on startup
- `persist/db.ts` guarantees the open promise settles (a version upgrade blocked by another tab fires no event) and closes the connection on both paths; `persist/generation.ts` drops in-flight saves superseded by a newer save or New
- Autosave stays OFF for the session if the startup restore failed, so a blank document can't overwrite the stored copy; failures are reported with a sticky `flashStatus(msg, 0)`
- New clears the slot. About 0.5 MB for a 1920×1080 doc with 3 layers

## Project Save/Load

- PSD is the project format — Ctrl+S to save, Ctrl+O to open
- The project has a name (`app.projectName`, saved with the settings; `filename.ts`): set in New, taken from an opened file, editable in the Document menu; the tab title shows it. Files: `name.psd` (save, Save to Files), `name-export.psd` (Spine export), `name.png`
- iPad/iPhone only: File ▸ Save to Files… shares the PSD through the share sheet, the only way a web page can put a file where the user picks (Safari has no save picker; a download always lands in Downloads). It tries the sheet on the tap that started it and, if that tap has expired (`NotAllowedError`), opens a dialog whose fresh tap retries; the dialog also offers a plain download. "Shared" means the sheet completed, not that the file reached Files
- `share.ts` (pure: device check, error classification), `download.ts` (`downloadBlob`, revokes the object URL after 60s — an immediate revoke can kill a large download on iPad), `lib/ShareReadyDialog.svelte`
- Round-trips layer tree, names, opacity, visibility, groups, reference Smart Objects
- Interoperable with Photoshop, GIMP, Spine, etc.

## Settings Persistence

- UI settings saved to localStorage (debounced)
- Includes: tool, brush type, size, opacity, smoothing, color, size range, both pressure curves, draw-behind, taper, fill settings, eraser settings, keep proportions, Fill enclosed bridge, nib angle/flatness, ink dwell, layer panel width, Spine tools
