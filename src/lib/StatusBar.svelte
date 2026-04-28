<script lang="ts">
  import { app } from "../appState.svelte.js";
  import type { Selection } from "../selection";

  let { selection }: { selection: Selection | null } = $props();

  // Reading app.selectionVersion registers reactive dependency; the bar re-renders
  // whenever the Selection emits a state transition (idle ↔ selected ↔ transforming ↔ warping)
  // or its warp grid resolution changes.
  let state = $derived.by(() => {
    void app.selectionVersion;
    return selection?.state ?? "idle";
  });

  let warpRes = $derived.by(() => {
    void app.selectionVersion;
    return selection ? `${selection.warpRows}×${selection.warpCols}` : "";
  });

  let warpLabel = $derived(warpRes === "2×2" ? "4-corner distort" : `Mesh warp ${warpRes}`);

  const kbd = "font-mono text-[10px] px-1 py-px rounded-sm border border-border bg-surface-hover text-text mx-px";
  const sep = "opacity-60";
</script>

<div class="bg-surface border-t border-border px-3 py-1 text-xs text-text-secondary flex items-center gap-2 min-h-7 select-none flex-wrap">
  {#if state === "idle"}
    <span>Drag with the <kbd class={kbd}>S</kbd> or <kbd class={kbd}>L</kbd> tool to make a selection</span>
  {:else if state === "selected"}
    <span class="font-medium text-text">Selection</span>
    <span class={sep}>·</span>
    <span>drag inside to free-transform</span>
    <span class={sep}>·</span>
    <span><kbd class={kbd}>W</kbd> distort</span>
    <span><kbd class={kbd}>M</kbd> mesh warp</span>
    <span class={sep}>·</span>
    <span><kbd class={kbd}>Esc</kbd> deselect</span>
  {:else if state === "transforming"}
    <span class="font-medium text-text">Free transform</span>
    <span class={sep}>·</span>
    <span>corners scale, sides skew, top handle rotates</span>
    <span class={sep}>·</span>
    <span><kbd class={kbd}>W</kbd> distort</span>
    <span><kbd class={kbd}>M</kbd> mesh warp</span>
    <span class={sep}>·</span>
    <span><kbd class={kbd}>Enter</kbd> apply</span>
    <span><kbd class={kbd}>Esc</kbd> cancel</span>
  {:else if state === "warping"}
    <span class="font-medium text-text">{warpLabel}</span>
    <span class={sep}>·</span>
    <span>drag any control point</span>
    <span class={sep}>·</span>
    <span><kbd class={kbd}>M</kbd> densify</span>
    <span class={sep}>·</span>
    <span><kbd class={kbd}>Enter</kbd> apply</span>
    <span><kbd class={kbd}>Esc</kbd> cancel</span>
  {/if}
</div>
