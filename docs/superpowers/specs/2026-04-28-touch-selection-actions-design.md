# Touch-friendly Selection Action Panel

## Problem

Distort (4-corner) and Mesh warp are currently only reachable via the `W` and `M`
keys (`App.svelte:632-640`). Commit (`Enter`) and Cancel (`Esc`) are also
keyboard-only. On iPad there is no keyboard, so these features are unreachable
through normal use.

## Goal

Add a floating, screen-aligned action panel that anchors to the active selection
and exposes the missing actions through buttons, without removing the existing
keyboard shortcuts.

## Non-goals

- No new selection or transform features. This is purely an alternative input
  surface for actions that already exist.
- No platform gating: the panel appears on desktop too. Keyboard shortcuts stay.
- No reorganization of the existing Toolbar or StatusBar.

## Action set (state-dependent)

| Selection state | Buttons shown |
|---|---|
| `selected` | Distort, Mesh |
| `transforming` | Distort, Mesh, Commit, Cancel |
| `warping` | Distort, Mesh, Commit, Cancel |
| `idle` / mid-creation / mid-drag / locked-or-hidden layer | (panel hidden) |

In `transforming`/`warping`, tapping Distort/Mesh routes through the existing
`enterWarp(rows, cols)` helper, which already handles "lift then warp",
"resample warp", and the no-op-when-already-at-resolution case.

## Architecture

```
src/
  lib/
    SelectionActions.svelte    NEW — floating panel component
  selection-anchor.ts          NEW — pure positioning math (testable)
  __tests__/
    selection-anchor.test.ts   NEW — unit tests for positioning
  selection.ts                 + getScreenBounds() helper
  viewport.ts                  + docToScreen() if not present
  App.svelte                   mounts the panel; wires callbacks
```

**Mount location.** Inside `workspaceEl`, *outside* `canvasContainerEl`. The
panel lives in screen space and does not inherit the canvas's zoom/rotation
transform — it is always upright.

**Why a Svelte component (not canvas-drawn).** Free hit-testing, free pointer
events, accessible, easy to style with the existing Tailwind tokens, matches
the look of `Toolbar.svelte`. Canvas-drawn buttons would re-implement what
the DOM gives us.

## Component contract

```ts
// SelectionActions.svelte props
{
  selection: Selection,
  viewport: Viewport,
  canvasContainerEl: HTMLElement,
  workspaceEl: HTMLElement,
  isActionable: () => boolean,   // false when active layer is locked or hidden
  onDistort: () => void,         // calls App.svelte's enterWarp(2, 2)
  onMesh:    () => void,         // calls App.svelte's enterWarp(3, 3)
  onCommit:  () => void,         // selection.commit() + bump layerVersion
  onCancel:  () => void,         // selection.cancel() + bump layerVersion
}
```

The component owns its own rAF loop. It reads selection state every frame and
updates its position. It does not subscribe to any reactive store.

## Anchor positioning

```ts
// selection-anchor.ts
export interface AnchorInput {
  bboxDoc: { x: number; y: number }[];   // doc-space points
  docToScreen: (p: { x: number; y: number }) => { x: number; y: number };
  panelSize: { w: number; h: number };
  viewport: { w: number; h: number };
  margin: number;                        // px, e.g. 12
}

export interface AnchorResult {
  x: number;                             // screen px, top-left of panel
  y: number;
  side: "above" | "below";
}

export function computeAnchor(input: AnchorInput): AnchorResult;
```

**Algorithm.**

1. Map each `bboxDoc` point to screen space and take the screen-space AABB
   (collapses canvas rotation).
2. Default: panel above the AABB, horizontally centered on its midpoint.
3. If above would be off-screen, flip below.
4. If still off-screen vertically (very small workspace), clamp y to the top
   margin.
5. Clamp x to `[margin, viewport.w - panelW - margin]`.

**State → bbox-points** (provided by new `Selection.getScreenBounds(): DocPoint[] | null`):

| State | Returns |
|---|---|
| `selected`, rect | 4 corners of `this.rect` |
| `selected`, lasso | 4 corners of `this.rect` (lasso AABB) |
| `transforming` | `this.transformedCorners()` |
| `warping` | `outerPerimeter(this.warpGrid, rows, cols)` |
| `idle`, `isCreating` | `null` |

## Reactivity / lifecycle

The component uses `requestAnimationFrame` to track the bbox each frame:

```svelte
<script lang="ts">
  let { selection, viewport, canvasContainerEl, workspaceEl, ... } = $props();
  let panelEl: HTMLDivElement;
  let visible = $state(false);
  let mode = $state<"selected" | "transforming" | "warping">("selected");
  let pos = $state({ x: 0, y: 0, side: "above" as const });
  let rafId = 0;

  function tick() {
    const bounds = selection.getScreenBounds();
    const blocked = !bounds || selection.dragging != null || !isActionable();

    if (blocked) {
      visible = false;
    } else {
      mode = selection.state;
      const r = panelEl.getBoundingClientRect();
      pos = computeAnchor({
        bboxDoc: bounds!,
        docToScreen: (p) => viewport.docToScreen(p, canvasContainerEl),
        panelSize: { w: r.width, h: r.height },
        viewport: { w: workspaceEl.clientWidth, h: workspaceEl.clientHeight },
        margin: 12,
      });
      visible = true;
    }
    rafId = requestAnimationFrame(tick);
  }

  $effect(() => { tick(); return () => cancelAnimationFrame(rafId); });
</script>
```

**Why rAF over a reactivity bridge.** Selection drags update the bbox between
Svelte ticks, and the marching-ants animation already runs an rAF loop in
`selection.ts`. One more rAF is free, and it picks up every change without
mutating every call site to bump a counter.

## Visuals

- Reuse the `Toolbar.svelte` button styling (rounded, `surface`/`border`/`text`
  Tailwind tokens, Lucide icons, dark-mode-aware).
- Min 44×44 px hit area per Apple HIG.
- Horizontal row, small gap, subtle drop shadow.
- Pointer events on the panel itself; the wrapper does not block clicks.
- Buttons `stopPropagation` so a tap doesn't also start a selection underneath.

Icons (Lucide): `square-dashed` (Distort), `grid-3x3` (Mesh), `check` (Commit),
`x` (Cancel).

## Tests

`src/__tests__/selection-anchor.test.ts`:

- Centered above bbox when there's room.
- Flips below when bbox is near top.
- Clamps x at left/right edges.
- Rotated-canvas case: rotated quad in doc space → axis-aligned AABB in
  screen space.
- Tiny viewport: clamps to top margin without flipping.

Visual verification (no automated test) for: live drag tracking, dark mode,
multi-resolution warp transitions, lasso vs rect bboxes.

## Out of scope / explicit non-changes

- Keyboard shortcuts (`W`, `M`, `Enter`, `Esc`) keep working.
- StatusBar keyboard hints stay as-is — they're still correct on desktop.
- No platform detection / no iPad-only path.
- No new selection or warp features.
