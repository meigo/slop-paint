<script lang="ts">
  // The selected row's PROPERTIES — the controls that used to be a second line inside every layer
  // row. One strip at the top of the panel for whatever is selected (the Photoshop/Krita
  // convention, and what slop-animator moved to): list rows stay one line, so a row never grows
  // when selected and the row under the Pencil never moves.
  import { Tag } from "@lucide/svelte";
  import { app, bumpLayerVersion } from "../appState.svelte.js";
  import type { LayerManager, LayerNode } from "../layers";
  import { clickOutside } from "./click-outside";
  import { sliderFill } from "./slider-fill";
  import {
    parseTags,
    toggleTag,
    tagsForNodeType,
    tagConflictReason,
    TAG_DESCRIPTIONS,
    type SpineTag,
  } from "../spine-tags";

  let {
    layers,
    onSettingsChange,
  }: {
    layers: LayerManager;
    /** Called after an edit, so the caller can recomposite / persist. */
    onSettingsChange: () => void;
  } = $props();

  // The layer tree is imperative; layerVersion is what re-derives this.
  const target = $derived.by<LayerNode | null>(() => {
    void app.layerVersion;
    return layers.findNode(layers.activeId);
  });

  let tagsOpen = $state(false);

  function setOpacity(value: number) {
    if (!target) return;
    layers.setOpacity(target.id, value);
    onSettingsChange();
  }

  function toggleNodeTag(tag: SpineTag) {
    if (!target) return;
    target.name = toggleTag(target.name, tag);
    bumpLayerVersion();
  }
</script>

<!-- Fixed height whatever is selected, so the list below never shifts. -->
<div
  class="flex min-h-[3.25rem] flex-col justify-center gap-1 border-b border-border bg-surface px-2.5 py-1.5"
>
  {#if target}
    {@const tags = parseTags(target.name).tags}
    <div class="flex items-center gap-2 text-[11px] text-text-secondary">
      <span class="w-12 shrink-0 text-text-muted">Opacity</span>
      <input
        type="range"
        class="h-3 min-w-0 flex-1"
        title="Opacity of the selected {target.type}"
        min="0"
        max="100"
        style={sliderFill(target.opacity, 0, 100)}
        value={target.opacity}
        oninput={(e) => setOpacity(Number(e.currentTarget.value))}
      />
      <span class="w-8 shrink-0 text-right text-text-muted">{target.opacity}%</span>
    </div>

    <div class="flex items-center gap-1.5">
      <span class="w-12 shrink-0 text-[11px] text-text-muted">Tags</span>
      {#each tags as t (t)}
        <button
          class="shrink-0 cursor-pointer rounded border border-border bg-surface-raised px-1 font-mono text-[9px] leading-[14px] text-text-secondary hover:bg-surface-hover"
          title="[{t}] — click to remove"
          onclick={() => toggleNodeTag(t)}>{t}</button
        >
      {/each}
      {#if tags.length === 0}
        <span class="text-[10px] text-text-muted">none</span>
      {/if}
      <div class="relative ml-auto flex shrink-0" use:clickOutside={() => (tagsOpen = false)}>
        <button
          class="flex size-5 cursor-pointer items-center justify-center rounded text-text-secondary opacity-60 hover:opacity-100"
          title="Spine tags for the selected {target.type}"
          aria-haspopup="menu"
          aria-expanded={tagsOpen}
          onclick={() => (tagsOpen = !tagsOpen)}
        >
          <Tag size={14} />
        </button>
        {#if tagsOpen}
          <div
            class="absolute top-full right-0 z-50 mt-1 flex min-w-[200px] flex-col gap-0.5 rounded-lg border border-border bg-surface p-1 text-xs shadow-lg"
            role="menu"
          >
            {#each tagsForNodeType(target.type) as t (t)}
              {@const conflict = tagConflictReason(t, tags)}
              <button
                class="flex items-center gap-2 rounded-md px-2 py-1 text-left {conflict
                  ? 'cursor-not-allowed text-text-muted opacity-50'
                  : 'cursor-pointer text-text-secondary hover:bg-surface-hover'}"
                role="menuitem"
                disabled={!!conflict}
                title={conflict ?? TAG_DESCRIPTIONS[t]}
                onclick={() => toggleNodeTag(t)}
              >
                <span
                  class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-border text-[9px] {tags.includes(
                    t,
                  )
                    ? 'ui-on'
                    : ''}">{tags.includes(t) ? "✓" : ""}</span
                >
                <span class="flex-1 font-mono text-text">[{t}]</span>
                <span class="truncate text-[10px] text-text-muted"
                  >{conflict ?? TAG_DESCRIPTIONS[t]}</span
                >
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <span class="text-[11px] text-text-muted">No layer selected</span>
  {/if}
</div>
