# Drawing App

Web-based drawing app with pressure-sensitive brushes, layers, and PSD export (Spine 2D compatible).

**This file holds the rules and the traps.** The history behind them — measurements, what was
tried and failed, dated bug stories — is in `docs/NOTES.md` under the same headings. Read the
matching section there before changing an area, and put new history there, not here.

## Tech Stack

- Svelte 5 + TypeScript + Vite
- Tailwind CSS v4 for styling (dark only, shared slop palette — see `../SLOP-TIMELINE-UI.md`)
- `@lucide/svelte` for icons
- Canvas2D for rendering
- Text references: bundled SIL fonts from `@fontsource/*` (Comic Neue, Bangers, Patrick Hand), loaded on demand
- Brush engines: perfect-freehand (Smooth), ink/marker (Ink), swept-nib ribbon (Calligraphy), bristle hairs (Dry brush), a wash with a rim (Watercolour), stamp tips (Pencil, Charcoal, Airbrush), a smudge (Blend)
- `ag-psd` for PSD export
- Vitest, ESLint, Prettier, `svelte-check`
- husky + lint-staged pre-commit hook: `eslint --fix` + `prettier --write` on staged files

## App Icon

- The shared slop mark in turquoise `#66fff0` (rule and every app's colour: `../SLOP-FAVICON-COLOURS.md`). Source of truth `public/favicon.svg`; regenerate PNGs with `node tools/make-icons.mjs`. Title, manifest and home-screen tags in `index.html` / `public/manifest.webmanifest`

## Commands

- `npm run dev` / `npm run dev:lan` (LAN, for iPad testing)
- `npm run build` — svelte-check + tsc + vite build
- `npm run deploy` — build, then `wrangler deploy` to the Cloudflare Worker `slop-paint` (assets-only; `public/_headers` caches only `/assets/*`). Manual, not on push. `preview_urls: false`
- `npm run test` / `npm run test:watch`
- `npm run test:ipad` — Playwright WebKit smoke check at iPad Pro 11 landscape with touch, fresh profile, own dev server on a free port (`-- <url>` to check a deployed site). ~35 independent checks, ~1.5 min; results read from the on-screen canvas's pixels, not undo titles. Screenshots in `test-results/ipad/` (`-FAIL` on failure); exit 1 on failure. First run: `npx playwright install webkit`. Pen strokes and multi-finger gestures are dispatched pointer events (`[sim]`); WebKit refuses `setPointerCapture` for them (ignored). NOT covered: the real Pencil, how gestures feel, the real share sheet, system clipboard, keyboard, iPadOS memory limits. No Xcode, so no real-device/Simulator route. Full list of what it walks: `docs/NOTES.md`
- `npm run lint`, `npm run check`, `npm run format` / `format:check`

## Testing Guidelines

- After adding features, write tests for pure logic (no DOM/canvas) in `src/__tests__/*.test.ts`. The list of tested modules and functions is in `docs/NOTES.md`; a new pure module gets tests the same way
- Don't test canvas rendering, pointer events, DOM, Svelte components
- `npm run test && npm run lint` before calling a feature done; `npm run check` and `npx tsc --noEmit` too
- After UI or input changes, run `npm run test:ipad` (WebKit catches Safari-only breakage)
- A bug only on the deployed site: reproduce on the production build (`npm run build && npx vite preview`) — the minifier can change behaviour (see Undo)
- Playwright WebKit is NOT Safari for performance or GPU-canvas behaviour: several iPad bugs never reproduced there. A device test is the evidence

## Workflow

As slop-vector-editor: branch off `main` (`fix/…`, `feat/…`, `chore/…`, `docs/…`), one commit per
task with a conventional subject, and merge into `main` with `--no-ff` ("Merge <what>") only when the
user says so. Keep README.md current with every user-visible change.

## Architecture

### Svelte UI Layer

- `main.ts` mounts `App.svelte` — canvas setup, input/gesture wiring, shortcuts, settings persistence
- `appState.svelte.ts` — shared `$state`: tool, brush/fill settings, layer version counter. `statusHint` = the `title` under the pointer. `flashStatus(msg, ms)` — use it whenever an action does nothing, so a no-op isn't silent; `ms = 0` is sticky (amber, until `clearSticky`)
- `lib/Toolbar.svelte` — two rows. Row 1 (48px): tools, undo/redo, zoom readout, File / Edit / Document / Filter / View menus (File, Edit, Document, View match slop-animator's order and naming; Filter is slop-paint's own). Short verbs, "…" when a dialog follows, shortcuts as key chips. Row 1 must not get `overflow` (it clips the menus); below 960px its paddings tighten so it fits 834px portrait. Row 2 (min 40px, wraps): the active tool's options — what changes while drawing on the bar, set-once settings behind the gear popover, palette behind the colour swatch. Below 960px the brush row shows 5 size presets, 48px sliders and an icon-only Deselect chip so it stays one line at ~817px; `test:ipad` checks every row in portrait — re-measure when a row gains a control. Row 2 keeps its height across tools: controls ≤ 28px, bare buttons wrapped in a flex box
- **Every canvas press has ONE owner**, decided at the press (`gesture` in App: brush, fill, select, move, ref, eyedropper, or none), and every later event of that pointer goes to it, whatever tool/layer/handles are by then. A brush stroke is PINNED to the layer, brush type and settings it started with (`gesture.stroke.layer`). `endGesture` finishes an open gesture as its release would; it must run before anything that changes the tool, the selection, the layer tree or the document under a press: `setTool`, selection actions, float apply on layer switch, mesh −/+, Clear layer, lock/hide applying a float, paste, New, Open, Restore autosave, Resize, Sharp layers, the panel's Delete / Duplicate / Merge down / Bake, ref handles going away. `isDrawing` stays true until the pen lifts. Undo/redo, view keys and the wheel are ignored while a gesture is open
- Brush kinds: `BrushKind` = smooth | ink | calligraphy | dry | watercolor | blend | stamp tips. Smooth/ink/calligraphy/dry/watercolor redraw the whole stroke each frame from a pre-stroke copy; stamps draw incrementally. Long OPAQUE Ink and Calligraphy strokes FREEZE their settled part into the pre-stroke copy every `FREEZE_STEP` points (`settledIndex` in `stroke-freeze.ts`, copied from slop-animator — keep identical); translucent strokes don't freeze. Dev: `window.slopNoFreeze = true`
- Stroke cost follows the STROKE's size (`dirty-rect.ts`, `redrawFrame`, `composite(box)`, `scheduleComposite(box)`); undo reads only touched 64-px tiles (`StrokeBackup` in `undo.ts`); the lift redraws and re-thumbnails only its part
- **SAFARI TRAP:** `drawImage` from a CPU-backed (`willReadFrequently`) canvas copies the WHOLE source first, whatever sub-rect is asked (~20 ms per 4000×6000 layer, every frame; Playwright's WebKit hides it). So every layer is read with `getImageData` into a part-sized canvas and drawn from there (`drawTree`'s `rect` path); default canvases (float, tint scratch) take plain sub-rect `drawImage`. The part canvas `partScratch` must be RE-SIZED for every layer even at the same size (WebKit bug 330116: reused, it drew stale parts). Drop the read only once that bug is fixed and measured
- Large documents: document-sized scratch canvases are released (size 0 first) when idle — pre-stroke copy after `PRE_STROKE_IDLE_MS`, float scratch on the next float-less composite, tint scratch after `SCRATCH_IDLE_MS`, the temporary copies of resampling and `shiftPixels` after use. Check a new big canvas with `canvasBacked` (an iPad refuses memory silently and reads back empty); a refused pre-stroke copy makes the press a "none" gesture. `runGesture` curves only NEW points — engines must not write to their `points` (it's the same array across events). Sparse input is interpolated every `interpolationSpacing(zoom)` canvas px
- `lib/ToolbarMenu.svelte` — `Label ▾` dropdown; while open App's Esc/Enter stand aside. Other popovers carry `data-popover` (App leaves Esc to them, each closes on it). A new popover needs one or the other
- `lib/click-outside.ts` — action: call back on a pointerdown outside the node (capture); wrap trigger + popup
- Selection actions have no floating bar: all in row 2 of Select/Lasso — Copy, Cut, Paste, Delete, Deselect, Select all │ Free transform, Distort, Mesh, mesh density (− n×n +, 3–8; coarser only while unbent — `mesh-size.ts`) │ Flip H/V, keep proportions │ Apply, Cancel. A float exists only on Select/Lasso. A float belongs to `floatLayer`: Apply/Cancel act on it whatever is active; selecting another layer applies it first with a message; locking/hiding its layer applies it first (`beforeShut`); deleting its layer discards it. Leaving a float applies it; Esc / ✗ / undo / redo discard it. A plain marquee survives a layer switch. Buttons that can't act are dimmed with a reason, never removed. With NO marquee, Free transform / Distort / Mesh / Flip take the whole layer (`selectLayerContent`). W / M go through `warpFromKey`: from other tools only with a marquee, switching to Select first. `enterFreeTransform` / `enterWarp` refuse group rows, locked or hidden layers themselves. Other tools show an amber Deselect chip while a marquee exists (it limits brush, eraser, fill, Outline)
- `lib/SettingsDialog.svelte` — Edit ▸ Settings: `app.hiResLayers` (Sharp layers) and `app.spineTools` (hides Spine UI only; tags in names stay and still export)
- `lib/LayerProps.svelte` — one-row strip for the selected node: opacity, blend menu, tint button (popover spans the strip), Spine tags, rename pencil (focus by action, not `autofocus`). An `@container` (narrow fallback below 212px). **Layer/group objects are NOT `$state`**: a field needs its own `$derived` that reads `app.layerVersion`, or the template shows a stale value
- `lib/LayerPanel.svelte` — layer tree in markup: recursive snippets, thumbnails via a canvas action, rename on double-click AND double-tap (`lib/double-tap.ts`; iPad dblclick is unreliable). Every control has a `title`
- Row layout (as slop-animator): one line, 20px thumbnails drawn at 40px, content indented 16px per depth, rows full width; state columns on the right (alpha lock, lock, eye; 20px each, aligned across rows; a reference shows its kind's icon in the alpha-lock column). Per-node controls live in LayerProps so rows never grow. Nested rows use `.group-rail` (background-image, not a border)
- Panel resizable by its left edge (`panel-layout.ts`: min 264px, max half the viewport), width saved
- Placement: ONE grid with two arrangements (nothing re-mounts). Panel beside row 2 when `viewport − panel ≥ TOOL_OPTIONS_WIDTH` (960), else below it. Wheel pan-zoom listens on the canvas area only
- Rows are rebuilt by `{#key version}`; the scroll box and drag ghost sit outside the key
- Row drag (read `../SLOP-LAYER-DRAG.md` first): pointer events on each row's grip (`touch-action: none`, moves/release on the window). `lib/layer-drop.ts` `dropTarget` ALONE decides where a drop lands (upper half above; lower half of a layer below; lower half of a group into it at the top; past the last row → root bottom; between rows → the row above's lower half); null into a locked group, a group into itself, or a no-op. Hidden groups take drops. `dragBlock` refuses a drag out of a locked group. The panel only draws that result: ghost past 3 px, rows slide by `rowOrderAfter` + `slideOffsets` (`layer-drag-visual.ts`) measured ONCE at the lift; refused spot → rows slide back + `not-allowed`. Release commits via `moveNode` / `moveNodes` as one `structuralEdit`. Escape, `pointercancel`, `lostpointercapture` put it back. Never go back to SortableJS
- `lib/NumberField.svelte` — every number box (shared with vector editor / animator). Horizontal 3 px drag scrubs (`lib/scrub.ts`), tap focuses (`type="text"` + `inputmode="decimal"`). A typed value is sent AS TYPED when in range (iPad doesn't blur on a dialog button tap). `typedNumber` decides what a draft sends; with `clamp` off (document sides) an empty draft sends NaN and the dialog refuses it. `onfocus` refuses focus while dragging (WebKit). `touch-pan-y`, never `touch-none`. Swallow the one stray `click` after a drag. No undo bracket (the dialog's OK is the step)
- `lib/select-on-focus.ts` — select all on focus (rename, size box, project name); not on the text dialog's textarea

### Canvas Engine (pure TypeScript, no Svelte)

- `input.ts` — pointer handling bound to the whole canvas AREA (strokes clip at the page; a new marquee is clamped to the page, a float move isn't). Pen/mouse vs touch. Only the pointer that started a stroke extends/ends it. `pointercancel` and `lostpointercapture` end a stroke at its LAST point (they carry no position). The lift reuses the last move's pressure (pen `pointerup` reports 0)
- `stroke-smoothing.ts` — Stream's rope and Smooth's path averaging; `holdRestPressure`
- `brush.ts` — `widthRange` (size = nominal; Press thins to size ÷ Press / widens to size × Press), Smooth via perfect-freehand (`size` is a radius basis: pass `maxSize / 2`; `decimationSmoothing` caps spacing). Taper: each end over `TAPER_WIDTHS` × widest width; at the lift (`taperFor`) at most half the length, and a stroke shorter than its width is a dot. The drawn start never changes while a stroke grows. Owed-to/shared with slop-animator
- `ink-brush.ts` — full redraw, width-batched runs, dwell swell (Pool); translucent → opaque scratch composited once, only its `rangeBox`
- `dry-brush.ts` — bristle hairs (`makeBristles`, `hairPaints`, `noise1`). FULL REDRAW but deterministic: resampled at fixed arc-length from the start, noise seeded by `strokeSeed` — what's drawn never changes as it grows (tested). Light pressure narrows the stroke (middle hairs only). Runs drawn as LINES in `TAPER_LEVELS` widths with butt ends — never filled outline polygons (broke into hollow boxes on iPad). Scratch cleared/composited only in the stroke's box. Taps/short strokes handled only at the lift (`bristleRuns(…, done)`, `dabRuns`)
- `wobble.ts` — Wobble for Smooth, Calligraphy (coarse octave only), Watercolour: outline points moved by 2D noise of PAGE position (`noise2`), per-stroke seed, so drawn parts never move. Smooth/Watercolour cap inward movement to half the local half-width via `pathSpine` / `spineAt` (earliest pass wins). Calligraphy doesn't get the cap yet
- Resting pen (`holdRestPressure`, Smooth and Watercolour): within `REST_PX` of the rest point pressure may rise, never fall. Not Calligraphy or Ink
- `watercolor-brush.ts` — one filled outline (`outlineOfPath`, `steadySpacing`), `washAlpha` with rim (`rimWidth`), paper `grainTile` pinned to layer device px, wobble, `multiply` when Mix colours (not under alpha lock / draw-behind). Rim via `distanceToMask` in a WINDOW from `changedFrom` (`rimWindowPad`); whole stroke under 1.5 widths. The coverage fill must stay UNCLIPPED (clipping made ticks at window borders). Dev: `window.slopWashFull = true`. Scratches released at the stroke's end (`releaseCanvas`)
- `calligraphy-brush.ts` — broad-nib ribbon; smoothing window narrows to the ends
- `stamp-brush.ts` — Pencil/Charcoal/Airbrush stamps; `spaceStamps` carries distance across segments AND calls; mouse = full alpha; Pencil grade (`pencilGrade`, 4H–8B); `stampFootprint` (sub-2px); stamps drawn from a MIP level (`mipIndex`); ≤ `SMALL_STAMP_PX` device px drawn as two soft discs (`discProfile`); larger stamps get a random turn
- `blend-brush.ts` — the Blend TOOL (J): moves the layer's own paint, never the brush colour. Dabs at whole device-pixel positions; read with `getImageData` (never `drawImage` from the layer — the Safari trap); blur in JS (`boxBlur3`, `blurPlan`; canvas shrink/grow lost paint); write via `destination-out` + `lighter` (or `source-atop` under alpha lock). `blendMix` from Smear. Own slot (`slotFor` → "blend") and pressure curve; no type menu, swatch or Draw behind. `BrushKind` keeps "blend" only for dispatch (`parseSlot` refuses it; `loadSettings` migrates old saves). `isStrokeTool` is the one list of stroke tools
- `brush-textures.ts` — procedural tips; `charcoalHoles`; `blendTip`
- `layers.ts` — tree layer/group management; `captureStructure`/`restoreStructure` (shape, layers by reference), `snapshotOf`/`restoreTo` (pixels); `canvasBacked`
- `history.ts` — one undo stack, 50 steps / 256 MB (from slop-animator)
- `undo.ts` — the `history` instance; `pushPixelEdit` (pushes nothing and returns false when no tile changed — callers report the no-op), `pushLayersEdit`, `pushRegionsEdit`, `structuralEdit` (nothing when the tree is unchanged; counts removed layers' canvases, `detachedLayerBytes`, `refSourceBytes`)
- `selection.ts` — rect/lasso, transform, `copyPixels` (snaps to whole layer pixels; a lasso's clip placed from its snapped box) / `clearRegion` / `liftPixels` / `pasteFloat`, `flip`, the matrix helpers. Corner/side handles; corner scale floored at `MIN_SCALE`. A marquee under 3 SCREEN px is a tap. Floats under `SMALL_FLOAT_PX` move from inside. Move drags step by whole layer pixels. Distort/Mesh: `drawWarpedMesh` draws triangles onto an empty scratch with `lighter` (no seams). An untouched lift goes back EXACTLY (`liftUntouched`: restore the pre-lift snapshot). `warpUntouched` compares the grid with the bilinear grid of its own corners
- `viewport.ts` — zoom/pan/rotation via CSS transform
- `touch-gestures.ts` — one-finger pan, double-tap eraser toggle, two-finger pinch-zoom-rotate (snap to 90° within 5°), two-finger tap undo, three-finger tap redo. A finger landing during a pen stroke is a resting hand (that gesture does nothing). A gesture that ever had three fingers never moves the view. A tap restores the view as it was at the first finger
- `pressure-curve.ts` — bezier curve with LUT; brush, eraser, Blend each have their own
- `tool-settings.ts` — brush/eraser/Blend slots, swapped in `setTool`
- `fill.ts`, `fill-holes.ts`, `mask-ops.ts` — see Fill Tool. Colours compare premultiplied (`withinTolerance`). Dilations/erosions go by `distanceToMask` (linear time), not round morphology
- `outline.ts` — Outline engine; `alphaBounds`; "inside" = half the art's PEAK alpha
- `export-psd.ts` — PSD save/load/export; `psdBuffer()` shared with autosave. At 1× hands ag-psd the layer canvases themselves; opening drops decoded layers once drawn
- `persist/` — `db.ts`, `autosave.ts`, `autosave-plan.ts`, `generation.ts`
- `ref-placement.ts`, `ref-image.ts`, `text-layout.ts`, `text-ref.ts`, `text-jitter.ts`, `text-fonts.ts`, `font-file.ts`, `png-text.ts` — see References / Text
- `lib/TextDialog.svelte` — no dim, no full-screen wrapper (iPad Home Screen edge-blur bug — see `../CLAUDE.md`): the box is `fixed` on its own and App makes the workspace `inert`
- `paste.ts` — `placeInternalPaste` (+8px, kept on page), `placeExternalImage` (centred, whole doc px, scaled down to fit), `imageUrlFromClipboard`

### State Management

- UI state: Svelte 5 runes in `appState.svelte.ts`. Engine objects (LayerManager, Viewport, Selection) are imperative, NOT `$state`
- `layerVersion` — bump for any change to the tree, a node field, a reference or the active row
- `bumpPixelVersion(id, area?)` — a pixel edit on ONE layer that changes nothing else (stroke end, fill, clear, delete/cut). Anything reacting to PIXELS must watch both (autosave and the Move box do)
- Thumbnails are cached per layer (`thumbCache`, `lib/thumb-stamp.ts`), redrawn only when stale. **App code that writes layer pixels must end in App's `bumpLayerVersion()` (marks every thumbnail stale) or `bumpPixelVersion(id)`; a component that writes pixels must call `touchThumb(id)`; previews written with no bump (Outline, Filter, ref fast drag) call `touchAllThumbs()` when put back.** appState's `bumpLayerVersion` (used by LayerPanel/LayerProps) and `LayerManager.onChange` do NOT mark thumbnails stale
- Settings persist to localStorage via debounced `$effect` in App.svelte

### Styling

- Tailwind v4 with `@theme` tokens; dark only, shared slop palette (`../SLOP-TIMELINE-UI.md`): zinc chrome, blue `accent` (#5b8cff), near-black `accent-text`
- Checkerboard is a tiled 16px SVG, not gradients (iPad repaint cost)
- Focus rings: `:focus-visible` 2px accent outline; never remove outright
- `--color-warn` (#d5b75d) = "this won't behave as you expect" (locked/hidden, dialog warnings). Not emphasis
- Bar controls share 28px height (size presets 24px). Radii 6px controls, 8px panels/popovers/dialogs. Inputs on `surface-raised`
- `.ui-on` for active tool/toggle, `.ui-selected` for the current row — never hand-rolled `bg-accent` / `class:` directives. `accent` = selection/active only
- `#app` is `position: fixed`, `100dvh`. App resets page scroll on `focusout`, visual-viewport resize and window `scroll`. Chrome-for-iPad keyboard shift is unfixable from the page (see `../CLAUDE.md`)
- Sliders: 4px track, 12px thumb; every slider passes `style={sliderFill(value, min, max)}` (`lib/slider-fill.ts`) or its track renders empty

## iPad / Touch Support

- Pencil draws; fingers navigate. One finger pans; a finger on a row's grip drags the row; pinch zooms/pans/rotates (snaps to 90°); two-finger tap undo, three-finger tap redo; one-finger double-tap toggles current tool ↔ eraser. The Pencil's barrel double-tap isn't exposed to the web

## Desktop Shortcuts

- B/E/J/S/L/V/G/I — brush/eraser/blend/select/lasso/move/fill/eyedropper (lower-cased, only without Ctrl/Cmd). Outline has no key
- X (hold) temporary eraser; leaving the window releases X and Space
- R / Shift+R rotate 15°; 0 reset view; 1 100%; Ctrl+=/- zoom; [ / ] brush size
- Ctrl+Z / Ctrl+Shift+Z undo/redo; Ctrl+C/X/V; Delete/Backspace clear selection
- Ctrl+S / Ctrl+O save/open; Ctrl+Shift+S Save as; Ctrl+N handled but browsers usually take it
- Ctrl+G group; ↑ / ↓ select row above/below (`adjacentRow`; not with a slider/dropdown focused or a float)
- Space+drag or middle mouse pan (only its own pointer; ends on cancel / lost capture; Space's default claimed outside text fields)
- Wheel pans, Ctrl/Cmd+wheel zooms by `wheelZoomFactor` (delta via `wheelPx`). Zoom clamped 10%–2000% (`clampZoom`), but a zoom already outside may stay. Readout uses `rotationDegrees`

## Layer Features

- **Where pixels may land: `paintBlock` in App** — not a GROUP row (`layers.activeIsGroup`; `active` falls back to the bottom layer), not locked, not hidden (`hiddenInTree`). Every pixel-writing action refuses through it
- Lock: groups lock their members; check with `layers.isLocked(node)`, never `.locked`. A locked group takes nothing in: Add, Duplicate, import, text next to a member go beside the outermost locked group (`outsideLocked`); New group on a member is refused. Locks aren't saved
- Alpha lock: paint only on existing pixels
- New group / Ctrl+G wraps the ACTIVE node in a new group in place (`groupActive` / `wrapInGroup`), one undo step
- Multi-select: `app.layerSelection` + Select mode (`app.layerSelecting`); Cmd/Ctrl+click, Shift+click range (`rowOrder`). Group / Delete act on the pick (`groupNodes`, `removeNodes`, `topSelection`), one step each; `dragBlock` and `layersLeftAfter` refuse. In Select mode the pick is exactly the checks, even empty. Outside it, a pick down to one row makes it active (`setPick`). Only visible rows are picked (collapsing unpicks). A picked row's grip drags all picked rows (`moveNodes`, stacked ghost `[data-drag-stack]`)
- Duplicate a layer or a whole group (`duplicateGroup`, fresh ids)
- Merge down: refused onto/from locked or hidden layers and onto references; bakes the lower layer's opacity and tint first. Duplicate and Merge down first `settlePending` (apply float, cancel Outline preview); Clear layer applies a float first
- Blend modes per LAYER (`blend.ts`, Photoshop names; menu: Normal, Multiply, Screen, Overlay, Add). Groups pass through. Other PSD modes kept, drawn via `canvasOp` or as Normal
- Tint per LAYER (`tint.ts`, flat colour keeping alpha): drawn through a scratch in `drawTree`; during a stroke other tinted layers are cached (`setLiveLayer`). Undo via `pushNodeFieldEdit(…, "tint")`; the custom picker is one step per drag (`closeTint`). PSD: Color Overlay (`effects.solidFill`, `tintFromPsd`); Spine export bakes it into a copy
- A LIFTED selection is drawn by the compositor (`layers.floatPreview`, keyed on `floatLayer`) in its layer's place; exports draw it in first (`withPendingResolved`). Apply/Cancel clear `floatLayer` BEFORE redrawing
- ONE compositing routine, `LayerManager.drawTree(ctx, w, h)` — screen, PNG and PSD preview all use it

## Brush / Eraser Settings

- Brush, eraser and Blend each keep size, opacity, smoothing, streamline, Press, type and pressure curve
- Press 1–8, default 3; mouse ignores it
- Stream: a rope of up to 40 SCREEN px applied to client coords in `input.ts`; catch-up via `catchUpPath` on pause (`PAUSE_MS`, `STILL_PX`), late frames and lift. Rope points take the pressure (`trailPressureAt`) and TIME (`trailTimeAt`) the pen had there. At Stream 0 no catch-up — except stamp brushes, which always get `STAMP_MIN_ROPE_PX`. A resting pen still adds points (Ink's Pool needs them); `smoothPath` collapses identical runs
- Smooth: arc-length path averaging over up to 32 screen px, narrowing to the ends; Sharp corners (off by default) smooths leg by leg between pauses (`pauseBreaks`). pf `smoothing` fixed at 0.5
- Which setting applies to which brush type is listed in `docs/NOTES.md`; Blend's Opacity is labelled Strength
- The eraser's Opacity works for every type
- Colour and draw-behind are shared by brush and eraser; Fill has its own colour/opacity (`app.fillColor` / `fillOpacity`)

## Brush Cursor

- `updateBrushCursor` in App (as slop-animator): nominal width at current zoom, nib shape for Calligraphy, dashed for eraser, centre dot; not-allowed on a locked/hidden layer

## Eyedropper

- Samples the composited document; transparent picks nothing. Drag to aim, release to pick, then back to the previous tool, setting that tool's colour (`app.eyedropperTarget`)

## Reference Layers (Smart Objects)

- An imported/pasted image is a layer with `layer.ref = { src, corners }` (original bytes + capped decoded copy, shared by duplicates). `layers.renderRef` re-draws from the original — lossless rescale
- Handles show while a reference is active (loaded, unlocked, visible) under any tool EXCEPT Move and eyedropper. Select transforms; Move translates whole layers. `syncRefHandles` (effect on layerVersion + selectionVersion + `app.currentTool`). Handles use Selection `handlesOnly` mode (`hasFloating` false). Each release is one `pushRefEdit` (none for a < 3 screen px tap). No Apply. Distort/Mesh dimmed ("Bake it to warp it")
- Tool follow: becoming a reference switches to Select and remembers the tool (`refFocusChange` in `ref-tool.ts`); leaving hands it back only if still on Select. "On a reference" is `layers.activeRef` — never `layers.active`
- Painting, fill, Outline, clear, delete, cut, paste-into refuse on a reference. Bake = `pushRefEdit(…, ref, undefined)`
- A new marquee's shape comes from the tool at `startCreate`; a drawn marquee keeps its own (`lassoPath`)
- PSD: `placedLayer` + `linkedFiles`; originals decode async (`decodeFailed` reported). A non-parallelogram Smart Object (`isParallelogram`) is never re-drawn — treated as undecodable ("distorted — Bake it"). Photoshop warp isn't read

## Text References

- Ghost type + guide lines to trace, as a reference layer (`[ignore]text …`, 60%). `RefSource.text = { spec, layout }`; `renderRef` draws from the layout. Settings: text, font, size, line/letter spacing, align, colour, guides, Randomise (`spec.seed` + `spec.jitter`; `text-jitter.ts` hash is pinned by a test — **a saved layer must never re-roll**; glyphs indexed across the whole text)
- An edit makes a NEW `RefSource` placed by `refitCorners`. OK = one step; Cancel restores. App shortcuts off while open; Ctrl/Cmd+Enter confirms
- Fonts: four bundled + a per-device library in IndexedDB (`text-fonts.ts`, `fontLibraryReady`, `font-file.ts`). A layer saves only the font NAME. Lookup: bundled → library (exact face only) → system → missing (keeps the saved picture, `savedOnly`; amber T). Adding a font rebuilds waiting layers as NEW sources refitted (`refreshTextFonts`, `refitToLayout`). Never write the font list from a session that couldn't read it (`readyToWrite`). OK/Add hold the dialog open while waiting for a font (`textDialog.pending`)
- PSD: a Smart Object whose PNG carries the spec in a `slop-paint-text` `tEXt` chunk

## Clipboard

- Copy refuses group rows; Cut checks Delete's refusals BEFORE copying. Copy takes a float as shown. Internal copy kept in memory + a PNG to the system clipboard (ClipboardItem built synchronously with a Blob promise, for Safari)
- Paste via the window `paste` event: a system image becomes a REFERENCE layer, unless it matches the internal copy's size. Pasted pixels float with handles; one undo step. Paste applies an open float first (`startPasteFloat`)
- Edit ▸ / row-2 Paste: `navigator.clipboard.read()`, fallback to the internal copy; never dimmed; a refused read reports the browser's reason. WebKit needs the `beforepaste` handler for Cmd+V over the canvas
- A paste/import while the Filter or text dialog is open is dropped (`previewDialogOpen`)
- A copied image given only as an ADDRESS is fetched (`imageUrlFromClipboard`, `fetchImage`; CORS only). An undecodable clipboard image falls back to the internal copy with a message. A clipboard with no readable image names what it holds (`clipboardTypes`)
- Delete/cut and an untouched transform apply skip the undo step when nothing changed

## Reference Images

- Import image… / Import image from clipboard / paste: a reference named `[ignore]ref <file>` at 60% (`REFERENCE_OPACITY`), inserted BELOW the active layer (`addLayerBelow`), fitted to the page; one undo step; becomes active (tool follow)
- Saves, exports and the blank-layers probe go through `withPendingResolved` (float drawn in, Outline preview taken out, then put back)

## Undo

- One stack for the whole document: pixels, structure, names, node fields
- An opacity DRAG is one step and bumps NO `layerVersion` until release. Live drags draw from PRE-MERGED COPIES (`setOpacity(…, live)` → `compositeLive`, `liveCache`, `liveKey`) — opacity slider, float transform, Move drag, ref handles. Any ordinary `composite()` drops them; every release must end in a `composite()`
- `pushNameEdit` / `pushNodeFieldEdit` look nodes up by id at apply time (structural undo clones groups)
- Cleared by New, Open, autosave restore, resize, Sharp layers
- Budget: 50 steps / 256 MB; the newest step always stays; only pixel steps evict for budget. Pixel steps keep only changed 64-px tiles (`changedTiles` / `cropPixels`), cut in their own function (`diffTiles`) so closures don't retain whole snapshots (`undo-memory.test.ts`)
- **Never bring back an exported `let` that a setter reassigns**: the production minifier inlined `undo.ts`'s no-op hook and deleted every call (undo didn't redraw, prod only). The hook lives on an object (`hooks.onHistoryApplied`)
- Tile steps hand `onHistoryApplied` a `PixelChange` box: App redraws and re-thumbnails only it; other steps redraw whole + `bumpLayerVersion()`

## Status Bar

- Actions that can't act: `aria-disabled` + a `title` saying why, NEVER `disabled` (no pointer events → no hint; on iPad the hint is the only explanation)
- Fixed height, `px-5`. Right: the active tool. Left, by priority: `flashStatus` message, sticky conditions (amber, joined by ·), `statusHint`, selection context
- The hint is written on `pointerover` AND `pointerdown` (capture); a `pointerover` to the same element is ignored
- **Every new control needs a `title`**

## Outline Tool

- Hollows the active layer's shapes to a line of `Thickness` (0.5–24 device px); Wobble, Variation, dice. Session-only knobs in row 2
- Preview written INTO the layer from a snapshot, once per frame. Apply = one step, hands back the previous tool; Cancel, undo, tool/layer switch, lock/hide, New/Open/Resize restore. Refused on locked, hidden, empty layers
- A marquee clips the write, not the maths; alpha lock never adds ink. Clear layer, copy/cut/delete cancel a live preview first

## Filter Menu

- Levels, Hue/Saturation, Posterize, Threshold, Colour to alpha │ Gaussian blur, Sharpen │ Halftone, Drop shadow, Glow — ONE-OFF pixel filters (not live). Pure maths in `filters.ts` (`applyFilter` on unpremultiplied RGBA; tested). Algorithm details, measured timings and the reasons behind each choice (OKLab palette Posterize, OKLCH Hue/Sat, solid per-cell halftone dots, premultiplied blur, smooth edges) are in `docs/NOTES.md` — read before touching a filter
- Area: ink bounds (`alphaBounds` / `inkBounds` in strips) grown by `filterReach`, cut to the marquee's box (`filterRect`). Blur-type filters spread past the ink. A fully transparent pixel stays transparent except where a filter spreads
- Several layers: `filterTargets` = Move's targets minus locked, hidden, reference (and alpha-locked for Colour to alpha), counted in the dialog. Shared state (palette, histogram) via `filterShared`. No layer held whole: each `FilterPart` keeps its `base`; one shared output buffer; undo = `pushRegionsEdit`, one step. Buffers released (`releaseFilterBuffers`)
- App (`openFilter` … `cancelFilter`): refuses as `paintBlock`; ends a gesture, applies a float, cancels Outline. Previews into the layers once a frame (`scheduleFilterPreview`); marquee clipped as Outline's. OK = one step (none + message when nothing changed); Cancel/Esc restore. Modal like the text dialog (no dim, workspace `inert`); autosave and the blank probe wait. Last settings per filter kept for the session
- Not measured on iPad; if too slow there, preview a reduced/visible part and run the whole on OK

## Move Tool

- Move (V) drags WHOLE layers: `layersToMove` — picked rows (Select mode: exactly the checks), else active layer, or a group's members; skipping locked/hidden with a count
- During the drag only the compositor offsets plain layers (`moveOffset`, screen only) and re-draws references from their originals (`drawMovePreview`). Release shifts by WHOLE device pixels; one step (`pushLayersEdit`: only tiles carried off the canvas, via `shiftLoss` strip by strip; undo shifts back with `shiftPixels`). Content past the edge is cut off at release. A float is applied and Outline cancelled first
- Ref handles hide under Move; selecting a reference doesn't leave Move (`TRANSFORM_ROW`)
- Marching-ants box (no handles) around the targets' painted bounds (`measureMoveBox`, `setMoveBox`); shifted, not re-measured, during and at release (`moveBoxKept`). A plain marquee is kept but hidden (`setMarqueeHidden`)
- Translation only

## Document resize

- Document ▸ Resize…: **Crop / extend** (`setDocumentSize`, at the anchor) or **Scale drawing** (`scaleDocument`, halving steps per side via `halvingSteps`; references re-drawn). Keep ratio uses the DOCUMENT's ratio (`linkedSize`). Clears undo, applies a float first. Sides must be 1–8192 (`docSide`) — refused with a reason, never clamped. Same size: message, no-op

## Fill Tool

- Bridge (`app.fillEnclosedGap`, 0–8) is shared by bucket and Fill enclosed: walls thickened by distance, flood, grow back over fillable pixels only (`growWithin`); a tap inside thickened walls starts from `nearestOpen`
- Expand: the tapped region is REPLACED; growth drawn behind. From a painted tap growth skips empty pixels and never makes pixels beyond the region more opaque
- Soft (`SOFT_STEPS`, index slider): antialiased edge. `ridgeCoverage` runs the fill behind the line to the line's MIDDLE found by geometry (`distanceToMask` both ways), fading on the inner half, capped at `UNDER_LINE_MAX_PX`. Pixels touching the region get no fade. Bucket reads `bucketStrength`, Fill enclosed `colourDistance`. With Expand: max of `expandedCoverage` and ridge coverage (`atLeast`). **Any rule that decides per pixel by steps keeps the staircase — use the line's alpha and geometry** (the failed attempts are in `docs/NOTES.md`)
- Fill enclosed: fills every enclosed area behind the lines, one step; only areas holding genuinely enclosed space (`keepAreasWith`, 4-connected). Refused on locked / alpha-locked layers
- Under a marquee or alpha lock the fill runs on a temp copy composited back. A tap that fills nothing says why. "Already this colour" only for EXACTLY the tapped pixel's colour and alpha

## New Document

- Warns it replaces the drawing, undo and the autosaved copy. Creates a white "Background" and an empty "Layer 1"
- A canvas press blurs a focused text field
- App shortcuts stand aside only for real text entry (`lib/text-entry.ts` `isTextEntry`); a focused `<select>` passes only Ctrl/Cmd shortcuts
- Dialogs handle Enter/Escape on `window`; App ignores shortcuts while one is open; Enter confirms only via `isConfirmEnter` (`lib/dialog-keys.ts`: not on a focused button, not an IME commit)

## PSD Export / Spine 2D

- Exports use document (CSS) pixels
- **Use `docDpr()`, never `window.devicePixelRatio`, for anything touching layer pixels.** Layers are at a whole ratio ≥ 1 (`layerPixelRatio`), PINNED in `layers.pixelRatio` (set only at startup and by the Sharp layers toggle). Sharp layers (`app.hiResLayers`) default off on iPad. Opening and toggling up scale NEAREST-neighbour (lossless round trip); toggling resamples in place (`setPixelRatio`), clears undo
- Groups export as PSD folders. Spine tags in names: `[slot]`, `[skin]`, `[bone]`, `[mesh]`, `[merge]`, `[ignore]` — `parseTags` reads known plain ones among leading bracket groups, skipping valued/unknown ones
- Layer order = draw order. See https://esotericsoftware.com/spine-import-psd

## Autosave

- PSD buffer to IndexedDB (db `slop-paint`, store `kv`, key `autosave`), 3s after the last change, at once on `pagehide` / `visibilitychange`; restored on startup
- Encoding blocks the page, so the timed save (`autosaveWhenQuiet`) waits while any pointer is pressed and `AUTOSAVE_QUIET_MS` after the last lift (stale pointers drop after `POINTER_STALE_MS`)
- `db.ts` always settles its open; `generation.ts` drops superseded saves; `autosave.ts` writes copy + meta in one transaction (`putPair`), one write at a time (`queued`)
- Autosave stays OFF for the session if the startup restore failed; failures are sticky status messages
- Copies: LATEST + up to 3 CHECKPOINTS ≥ 5 min apart (`planCheckpoint`) + a KEPT copy; File ▸ Restore autosave… (`lib/RestoreDialog.svelte`) lists them. Before New / Open / restoring an older copy, `keepOutgoing` saves and makes the latest a checkpoint. If work began during the startup read, the restore is skipped and the stored copy made a checkpoint
- **Blank layers guard** — never let an autosave overwrite the only copy unchecked: before each save, on `pageshow` and on return to visible, `inkedLayerIds` probes which layers have pixels, `looksBlanked` compares with the last save against undo steps since (`History.layerChanges`). A float's layer counts as at the last save (`carryPendingLayer`). Resize, Sharp layers, New, Open, restore reset the baseline only when every canvas got its memory (`markResampled`, `unbackedLayerCount`). On a blanking: pause (`autosaveHalted`), sticky status, restore dialog with "Keep the blank layers" (copies latest to the KEPT slot first). Not while the text dialog is open. Dev: `window.slopBlankLayers()`
- Layer memory shown in the Document menu (`layerMemoryBytes`); amber + warning on iPad above `IPAD_MEMORY_WARN_BYTES`

## Project Save/Load

- PSD is the project format. Dropping a file on the window is refused (`refuseFileDrop`); no drop-to-import
- Chrome/Edge desktop (`file-access.ts`, `fileAccessAvailable()`): the document keeps its file (`docFile`, session only); Save writes back, Save as moves it; Open uses the same picker. Permission asked BEFORE encoding. Nothing is written if another document replaced this one meanwhile (`docGeneration`). Elsewhere Save downloads
- Project name `app.projectName` (`filename.ts`): `name.psd`, `name-export.psd`, `name.png`; the tab title shows it
- iPad/iPhone: Save to Files… and both exports go through the share sheet (`sendToFiles`, `share.ts`, `lib/ShareReadyDialog.svelte`, retry on a fresh tap after `NotAllowedError`). In the Home Screen app (`isStandalone`) Save does too and "Download instead" hides (iOS can't download there). `download.ts` revokes the URL after 60 s
- Open also takes an image (`isPsdBuffer` decides; `createImageBitmap` BEFORE the document changes; `loadImageDocument`; `docFile` stays null)
- Open builds the new tree aside and swaps it in only when complete (`loadPsd`); open Filter/text dialogs are cancelled just before the swap (`beforeSwap`)
- Round-trips tree, names, opacity, visibility, tints, groups, references. A flat PSD opens at its own size; one with no drawing layer gets an empty Layer 1

## Settings Persistence

- UI settings in localStorage (debounced): tool and all brush/eraser/Blend settings and curves, fill settings, Bridge, Sharp layers, keep proportions, panel width, Spine tools. Full list in `docs/NOTES.md`
