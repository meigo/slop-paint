<script lang="ts">
  import { onMount } from "svelte";
  import {
    SquareDashed,
    Grid3x3,
    Check,
    X,
    Move,
    FlipHorizontal2,
    FlipVertical2,
    Link2,
    Link2Off,
  } from "@lucide/svelte";
  import type { Selection } from "../selection";
  import type { Viewport } from "../viewport";
  import { computeAnchor } from "../selection-anchor";

  let {
    selection,
    viewport,
    containerEl,
    isActionable,
    onTransform,
    onDistort,
    onMesh,
    onFlip,
    keepProportions,
    onToggleKeepProportions,
    onCommit,
    onCancel,
  }: {
    selection: Selection;
    viewport: Viewport;
    /** Positioned ancestor: panel is positioned relative to this element and clamps to its size. */
    containerEl: HTMLElement;
    isActionable: () => boolean;
    onTransform: () => void;
    onDistort: () => void;
    onMesh: () => void;
    onFlip: (axis: "h" | "v") => void;
    keepProportions: boolean;
    onToggleKeepProportions: () => void;
    onCommit: () => void;
    onCancel: () => void;
  } = $props();

  const MARGIN = 12;

  let panelEl: HTMLDivElement;
  let visible = $state(false);
  let mode = $state<"selected" | "transforming" | "warping">("selected");
  let warpRes = $state({ rows: 2, cols: 2 });
  let pos = $state({ x: 0, y: 0 });
  let rafId = 0;

  function tick() {
    if (panelEl && containerEl) {
      const bounds = selection.getScreenBounds();
      const blocked = !bounds || selection.isDragging || !isActionable();

      if (blocked) {
        visible = false;
      } else {
        mode = selection.state as "selected" | "transforming" | "warping";
        warpRes = { rows: selection.warpRows, cols: selection.warpCols };
        const wsRect = containerEl.getBoundingClientRect();
        const panelRect = panelEl.getBoundingClientRect();
        const panelW = panelRect.width || 200;
        const panelH = panelRect.height || 44;
        const a = computeAnchor({
          bboxDoc: bounds!,
          docToScreen: (p) => {
            const s = viewport.canvasToScreen(p.x, p.y);
            return { x: s.x - wsRect.left, y: s.y - wsRect.top };
          },
          panelSize: { w: panelW, h: panelH },
          viewport: { w: containerEl.clientWidth, h: containerEl.clientHeight },
          margin: MARGIN,
        });
        pos = { x: a.x, y: a.y };
        visible = true;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  onMount(() => {
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  });

  const distortActive = $derived(mode === "warping" && warpRes.rows === 2 && warpRes.cols === 2);
  const meshActive = $derived(mode === "warping" && (warpRes.rows !== 2 || warpRes.cols !== 2));
  const floating = $derived(mode !== "selected");

  const btn = "flex h-11 w-11 items-center justify-center rounded-md border transition-colors";
  const idle = "border-border bg-surface text-text-secondary";

  // Stop propagation so taps on buttons don't bleed through to the canvas (where
  // they would start a new selection or commit the current one).
  function tap(handler: () => void) {
    return (e: PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      handler();
    };
  }
</script>

<div
  bind:this={panelEl}
  class="selection-actions-panel absolute z-30 flex items-center gap-1 rounded-lg border border-border bg-surface p-1 shadow-md transition-opacity"
  style="left: {pos.x}px; top: {pos.y}px; opacity: {visible ? 1 : 0}; pointer-events: {visible
    ? 'auto'
    : 'none'}; touch-action: none;"
>
  <!-- Button positions must not change when a plain selection is lifted (Flip lifts it): the panel
       is centred on the selection, so a button appearing or disappearing would slide the others
       under the pen. Move stays and shows active; Apply/Cancel are shown dimmed until there is a
       float. Only Distort/Mesh (their own grid) drop Flip and keep-proportions. -->
  <button
    class="{btn} {mode === 'transforming' ? 'ui-on' : idle}"
    aria-pressed={mode === "transforming"}
    onpointerdown={tap(() => {
      if (mode === "selected") onTransform();
    })}
    title="Free transform — show scale/rotate handles"
  >
    <Move size={20} />
  </button>
  <button
    class="{btn} {distortActive ? 'ui-on' : idle}"
    aria-pressed={distortActive}
    onpointerdown={tap(onDistort)}
    title="Distort (W) — 4-corner warp"
  >
    <SquareDashed size={20} />
  </button>
  <button
    class="{btn} {meshActive ? 'ui-on' : idle}"
    aria-pressed={meshActive}
    onpointerdown={tap(onMesh)}
    title="Mesh warp (M) — 3×3 grid"
  >
    <Grid3x3 size={20} />
  </button>

  {#if mode !== "warping"}
    <div class="mx-0.5 h-7 w-px bg-border"></div>
    <button class="{btn} {idle}" onpointerdown={tap(() => onFlip("h"))} title="Flip horizontal">
      <FlipHorizontal2 size={20} />
    </button>
    <button class="{btn} {idle}" onpointerdown={tap(() => onFlip("v"))} title="Flip vertical">
      <FlipVertical2 size={20} />
    </button>
    <button
      class="{btn} {keepProportions ? 'ui-on' : idle}"
      aria-pressed={keepProportions}
      onpointerdown={tap(onToggleKeepProportions)}
      title={keepProportions
        ? "Corners keep proportions (Shift: free)"
        : "Corners scale freely (Shift: keep proportions)"}
    >
      {#if keepProportions}<Link2 size={20} />{:else}<Link2Off size={20} />{/if}
    </button>
  {/if}

  <div class="mx-0.5 h-7 w-px bg-border"></div>
  <button
    class="{btn} {idle} aria-disabled:cursor-default aria-disabled:opacity-40"
    aria-disabled={!floating}
    onpointerdown={tap(() => {
      if (floating) onCommit();
    })}
    title="Apply (Enter)"
  >
    <Check size={20} />
  </button>
  <button
    class="{btn} {idle} aria-disabled:cursor-default aria-disabled:opacity-40"
    aria-disabled={!floating}
    onpointerdown={tap(() => {
      if (floating) onCancel();
    })}
    title="Cancel (Esc)"
  >
    <X size={20} />
  </button>
</div>
