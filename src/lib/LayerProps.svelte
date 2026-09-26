<script lang="ts">
  // The selected row's PROPERTIES — the controls that used to be a second line inside every layer
  // row. One strip at the top of the panel for whatever is selected (the Photoshop/Krita
  // convention, and what slop-animator moved to): list rows stay one line, so a row never grows
  // when selected and the row under the Pencil never moves.
  import { Blend, Pencil, Tag } from "@lucide/svelte";
  import { app, bumpLayerVersion } from "../appState.svelte.js";
  import type { LayerManager, LayerNode } from "../layers";
  import { clickOutside } from "./click-outside";
  import { pushNameEdit, pushNodeFieldEdit } from "../undo";
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
    onRename,
  }: {
    layers: LayerManager;
    /** Called after an edit, so the caller can recomposite / persist. */
    onSettingsChange: () => void;
    /** Start renaming the selected row in the list (the pencil — double-tap still works too). */
    onRename: (node: LayerNode) => void;
  } = $props();

  // The layer tree is imperative, so layerVersion is what re-derives all of this. The node's
  // FIELDS need their own deriveds: editing opacity leaves the node object identical, so a template
  // reading `target.opacity` would never re-run — the strip showed a stale value while the canvas
  // already had the new one.
  const target = $derived.by<LayerNode | null>(() => {
    void app.layerVersion;
    return layers.findNode(layers.activeId);
  });
  const opacity = $derived.by(() => {
    void app.layerVersion;
    return target?.opacity ?? 100;
  });
  const tags = $derived.by(() => {
    void app.layerVersion;
    return target ? parseTags(target.name).tags : [];
  });

  let tagsOpen = $state(false);

  // A drag is ONE undo step: opened on the first `input`, closed on `change` (fired at release)
  // or when focus leaves. Without this every pixel of slider travel would be its own step.
  let opacityStart: number | null = null;

  function onOpacityInput(value: number) {
    if (!target) return;
    if (opacityStart === null) opacityStart = target.opacity;
    layers.setOpacity(target.id, value);
    onSettingsChange();
  }

  function commitOpacity() {
    if (opacityStart === null || !target) return;
    const before = opacityStart;
    opacityStart = null;
    pushNodeFieldEdit(layers, target.id, "opacity", before, target.opacity);
  }

  function toggleNodeTag(tag: SpineTag) {
    if (!target) return;
    const before = target.name;
    target.name = toggleTag(target.name, tag);
    pushNameEdit(layers, target.id, before, target.name); // tags live in the name
    bumpLayerVersion();
  }
</script>

<!-- One compact row, as slop-animator's strip: an icon names each control (no tooltips on iPad; the
     status bar reads the titles). Fixed height whatever is selected, so the list below never shifts.
     `pr-[6px]` puts the pencil's right edge on the rows' eye column. -->
<div
  class="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface pr-[6px] pl-2.5 text-text-secondary"
>
  {#if target}
    <span class="flex shrink-0 items-center gap-1" title="Opacity of the selected {target.type}">
      <Blend size={13} class="shrink-0" />
      <input
        type="range"
        class="w-20"
        title="Opacity of the selected {target.type}"
        min="0"
        max="100"
        style={sliderFill(opacity, 0, 100)}
        value={opacity}
        oninput={(e) => onOpacityInput(Number(e.currentTarget.value))}
        onchange={commitOpacity}
        onpointerup={commitOpacity}
        onblur={commitOpacity}
      />
      <span class="w-6 text-[11px] text-text-muted">{opacity}</span>
    </span>

    <!-- Spine tags: the chips (tap one to remove it), then the menu to add. -->
    <span class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
      {#each tags as t (t)}
        <button
          class="shrink-0 cursor-pointer rounded border border-border bg-surface-raised px-1 font-mono text-[9px] leading-[14px] text-text-secondary hover:bg-surface-hover"
          title="[{t}] — click to remove"
          onclick={() => toggleNodeTag(t)}>{t}</button
        >
      {/each}
    </span>
    <div class="relative flex shrink-0" use:clickOutside={() => (tagsOpen = false)}>
      <button
        class="flex size-5 cursor-pointer items-center justify-center rounded text-text-secondary hover:text-text"
        title="Spine tags for the selected {target.type}"
        aria-haspopup="menu"
        aria-expanded={tagsOpen}
        onclick={() => (tagsOpen = !tagsOpen)}
      >
        <Tag size={13} />
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
    <button
      class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-text-secondary hover:text-text"
      title="Rename the selected {target.type}"
      onclick={() => target && onRename(target)}><Pencil size={13} /></button
    >
  {:else}
    <span class="text-[11px] text-text-muted">No layer selected</span>
  {/if}
</div>
