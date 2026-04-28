<script lang="ts">
  import { onMount } from "svelte";
  import { SquareDashed, Grid3x3, Check, X } from "@lucide/svelte";
  import type { Selection } from "../selection";
  import type { Viewport } from "../viewport";
  import { computeAnchor } from "../selection-anchor";

  let {
    selection,
    viewport,
    containerEl,
    isActionable,
    onDistort,
    onMesh,
    onCommit,
    onCancel,
  }: {
    selection: Selection;
    viewport: Viewport;
    /** Positioned ancestor: panel is positioned relative to this element and clamps to its size. */
    containerEl: HTMLElement;
    isActionable: () => boolean;
    onDistort: () => void;
    onMesh: () => void;
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
  class="absolute z-30 flex items-center gap-1 p-1 rounded-lg bg-surface border border-border shadow-md transition-opacity"
  style="left: {pos.x}px; top: {pos.y}px; opacity: {visible ? 1 : 0}; pointer-events: {visible ? 'auto' : 'none'}; touch-action: none;"
>
  <button
    class="w-11 h-11 rounded-md border flex items-center justify-center transition-colors"
    class:bg-accent={distortActive}
    class:text-accent-text={distortActive}
    class:border-accent={distortActive}
    class:bg-surface={!distortActive}
    class:text-text-secondary={!distortActive}
    class:border-border={!distortActive}
    onpointerdown={tap(onDistort)}
    title="Distort (W) — 4-corner warp"
  >
    <SquareDashed size={20} />
  </button>
  <button
    class="w-11 h-11 rounded-md border flex items-center justify-center transition-colors"
    class:bg-accent={meshActive}
    class:text-accent-text={meshActive}
    class:border-accent={meshActive}
    class:bg-surface={!meshActive}
    class:text-text-secondary={!meshActive}
    class:border-border={!meshActive}
    onpointerdown={tap(onMesh)}
    title="Mesh warp (M) — 3×3 grid"
  >
    <Grid3x3 size={20} />
  </button>

  {#if mode !== "selected"}
    <div class="w-px h-7 bg-border mx-0.5"></div>
    <button
      class="w-11 h-11 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center transition-colors"
      onpointerdown={tap(onCommit)}
      title="Commit (Enter)"
    >
      <Check size={20} />
    </button>
    <button
      class="w-11 h-11 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center transition-colors"
      onpointerdown={tap(onCancel)}
      title="Cancel (Esc)"
    >
      <X size={20} />
    </button>
  {/if}
</div>
