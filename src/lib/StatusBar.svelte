<script lang="ts">
  import { app } from "../appState.svelte.js";
  import type { Selection } from "../selection";

  let { selection }: { selection: Selection | null } = $props();

  // Reading app.selectionVersion registers reactive dependency; the bar re-renders
  // whenever the Selection emits a state transition (idle ↔ selected ↔ transforming ↔ warping)
  // or its warp grid resolution changes.
  let state = $derived.by(() => {
    void app.selectionVersion;
    return selection?.handlesOnly ? "reference" : (selection?.state ?? "idle");
  });

  let warpRes = $derived.by(() => {
    void app.selectionVersion;
    return selection ? `${selection.warpRows}×${selection.warpCols}` : "";
  });

  let warpLabel = $derived(warpRes === "2×2" ? "4-corner distort" : `Mesh warp ${warpRes}`);

  const toolLabels: Record<string, string> = {
    brush: "Brush",
    eraser: "Eraser",
    select: "Rect select",
    lasso: "Lasso",
    fill: "Fill",
    eyedropper: "Eyedropper",
    outline: "Outline",
  };
  const toolLabel = $derived(toolLabels[app.currentTool] ?? app.currentTool);

  const kbd =
    "font-mono text-[10px] px-1 py-px rounded-sm border border-border bg-surface-hover text-text mx-px";
  const sep = "opacity-60";
</script>

<!-- Fixed height, and px-5 so the text clears the rounded window corners on an iPad.
     Priority: an explicit message (why something did nothing) beats the hint for whatever the
     pointer is on, which beats the current context. -->
<div
  class="flex h-7 items-center justify-between gap-3 border-t border-border bg-surface px-5 text-xs text-text-secondary select-none"
>
  <span class="truncate">
    {#if app.statusMessage}
      <span class="text-text">{app.statusMessage}</span>
    {:else if app.statusHint}
      {app.statusHint}
    {:else if state === "reference"}
      <span class="font-medium text-text">Reference</span>
      <span class={sep}>·</span>
      drag to move, corners scale, top handle rotates
      <span class={sep}>·</span>
      Bake it (layer strip) to paint on it
    {:else if state === "idle"}
      Drag with the <kbd class={kbd}>S</kbd> or <kbd class={kbd}>L</kbd> tool to make a selection
    {:else if state === "selected"}
      <span class="font-medium text-text">Selection</span>
      <span class={sep}>·</span>
      drag inside to free-transform
      <span class={sep}>·</span>
      <kbd class={kbd}>W</kbd> distort
      <kbd class={kbd}>M</kbd> mesh warp
      <span class={sep}>·</span>
      <kbd class={kbd}>Esc</kbd> deselect
    {:else if state === "transforming"}
      <span class="font-medium text-text">Free transform</span>
      <span class={sep}>·</span>
      corners scale, sides stretch, top handle rotates
      <span class={sep}>·</span>
      <kbd class={kbd}>Shift</kbd> free corners / skew sides
      <span class={sep}>·</span>
      <kbd class={kbd}>Enter</kbd> apply
      <kbd class={kbd}>Esc</kbd> cancel
    {:else}
      <span class="font-medium text-text">{warpLabel}</span>
      <span class={sep}>·</span>
      drag any control point
      <span class={sep}>·</span>
      <kbd class={kbd}>M</kbd> densify
      <span class={sep}>·</span>
      <kbd class={kbd}>Enter</kbd> apply
      <kbd class={kbd}>Esc</kbd> cancel
    {/if}
  </span>
  <span class="shrink-0">{toolLabel}</span>
</div>
