<script lang="ts">
  // The selected row's PROPERTIES — the controls that used to be a second line inside every layer
  // row. One strip at the top of the panel for whatever is selected (the Photoshop/Krita
  // convention, and what slop-animator moved to): list rows stay one line, so a row never grows
  // when selected and the row under the Pencil never moves.
  import { Blend, Pencil, Stamp, Tag, Type } from "@lucide/svelte";
  import { app, bumpLayerVersion, flashStatus } from "../appState.svelte.js";
  import type { Layer, LayerManager, LayerNode } from "../layers";
  import { clickOutside } from "./click-outside";
  import { pushNameEdit, pushNodeFieldEdit, pushRefEdit } from "../undo";
  import { sliderFill } from "./slider-fill";
  import { BLEND_MODES, blendLabel, canDraw } from "../blend";
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
    onEditText,
  }: {
    layers: LayerManager;
    /** Called after an edit, so the caller can recomposite / persist. */
    onSettingsChange: () => void;
    /** Start renaming the selected row in the list (the pencil — double-tap still works too). */
    onRename: (node: LayerNode) => void;
    /** Open the text dialog on the selected text reference. */
    onEditText: () => void;
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
  // A layer's blend mode (groups have none: their members blend through). The same `layerVersion`
  // read as `opacity`, or an undo wouldn't show here.
  const blend = $derived.by(() => {
    void app.layerVersion;
    return target?.type === "layer" ? (target.blend ?? "normal") : null;
  });

  function setBlend(mode: string) {
    if (target?.type !== "layer") return;
    const before = target.blend;
    const after = mode === "normal" ? undefined : mode;
    if (before === after) return;
    target.blend = after;
    pushNodeFieldEdit(layers, target.id, "blend", before, after);
    layers.composite();
    onSettingsChange();
  }

  const tags = $derived.by(() => {
    void app.layerVersion;
    return target ? parseTags(target.name).tags : [];
  });

  // A reference layer (a Smart Object in the PSD) gets Bake; its handles show on the canvas.
  const refLayer = $derived.by<Layer | null>(() => {
    void app.layerVersion;
    return target?.type === "layer" && target.ref ? target : null;
  });

  /** Bake: the reference becomes plain pixels, as it is drawn now. One undo step. */
  function bake() {
    if (!refLayer?.ref) return;
    if (layers.isLocked(refLayer)) return flashStatus("Layer is locked");
    pushRefEdit(layers, refLayer.id, refLayer.ref, undefined);
    refLayer.ref = undefined;
    flashStatus("Baked — it's a plain layer now");
    bumpLayerVersion();
  }

  let tagsOpen = $state(false);

  // A drag is ONE undo step: opened on the first `input`, closed on `change` (fired at release)
  // or when focus leaves. Without this every pixel of slider travel would be its own step.
  // The node is kept with it, so the step lands on the node the drag started on.
  let opacityStart: { id: number; value: number } | null = null;
  // While dragging, only the canvas and this readout follow the slider: `setOpacity` recomposites,
  // and the value shows from here. Bumping `layerVersion` per step rebuilt the whole layer list
  // (thumbnails included) and re-ran every layer effect — ~15 ms a step on a Mac, far more on iPad,
  // against 0.3 ms for the recomposite. The one bump comes at release, with the undo step.
  let dragOpacity = $state<number | null>(null);
  const shownOpacity = $derived(dragOpacity ?? opacity);

  function onOpacityInput(value: number) {
    if (!target) return;
    if (opacityStart === null) opacityStart = { id: target.id, value: target.opacity };
    dragOpacity = value;
    layers.setOpacity(target.id, value);
  }

  function commitOpacity() {
    dragOpacity = null;
    if (opacityStart === null) return;
    const { id, value: before } = opacityStart;
    opacityStart = null;
    const node = layers.findNode(id);
    if (node) pushNodeFieldEdit(layers, id, "opacity", before, node.opacity);
    onSettingsChange();
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
  class="@container flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface pr-[6px] pl-2.5 text-text-secondary"
>
  {#if target}
    <!-- In the narrowest panel the slider gives way (down to 32px) and the number hides, so the blend
         menu and the rename pencil still fit. -->
    <span
      class="flex min-w-0 shrink items-center gap-1"
      title="Opacity of the selected {target.type}"
    >
      <Blend size={13} class="shrink-0" />
      <input
        type="range"
        class="w-20 min-w-8 shrink"
        title="Opacity of the selected {target.type}"
        min="0"
        max="100"
        style={sliderFill(shownOpacity, 0, 100)}
        value={shownOpacity}
        oninput={(e) => onOpacityInput(Number(e.currentTarget.value))}
        onchange={commitOpacity}
        onpointerup={commitOpacity}
        onblur={commitOpacity}
      />
      <span class="hidden w-6 shrink-0 text-[11px] text-text-muted @min-[212px]:inline"
        >{shownOpacity}</span
      >
    </span>

    {#if blend !== null}
      <!-- Layers only. A PSD's own mode that the menu doesn't offer is listed too, by its name. -->
      <select
        class="h-6 w-[72px] shrink-0 cursor-pointer rounded border border-border bg-surface-raised px-1 text-[11px] text-text-secondary"
        title={canDraw(blend)
          ? `Blend mode — how the layer combines with the layers below (${blendLabel(blend)})`
          : `Blend mode ${blendLabel(blend)}, from the PSD — kept for Photoshop, drawn here as Normal`}
        value={blend}
        onchange={(e) => setBlend(e.currentTarget.value)}
      >
        {#each BLEND_MODES as b (b.psd)}
          <option value={b.psd}>{b.label}</option>
        {/each}
        {#if !BLEND_MODES.some((b) => b.psd === blend)}
          <option value={blend}>{blendLabel(blend)}</option>
        {/if}
      </select>
    {/if}

    {#if refLayer?.ref?.src.text}
      <button
        class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-text-secondary hover:text-text"
        title="Edit the text, font and guide lines"
        onclick={onEditText}><Type size={13} /></button
      >
    {/if}
    {#if refLayer}
      <button
        class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-text-secondary hover:text-text"
        title="Bake the reference into plain pixels (to paint on or warp it)"
        onclick={bake}><Stamp size={13} /></button
      >
    {/if}

    <!-- Spine tags: the chips (tap one to remove it), then the menu to add. -->
    <!-- Settings ▸ Spine tools off hides the chips and the menu; the span stays as the spacer that
         keeps the rename pencil on the right. -->
    <span class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
      {#each app.spineTools ? tags : [] as t (t)}
        <button
          class="shrink-0 cursor-pointer rounded border border-border bg-surface-raised px-1 font-mono text-[9px] leading-[14px] text-text-secondary hover:bg-surface-hover"
          title="[{t}] — click to remove"
          onclick={() => toggleNodeTag(t)}>{t}</button
        >
      {/each}
    </span>
    {#if app.spineTools}
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
    {/if}
    <button
      class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-text-secondary hover:text-text"
      title="Rename the selected {target.type}"
      onclick={() => target && onRename(target)}><Pencil size={13} /></button
    >
  {:else}
    <span class="text-[11px] text-text-muted">No layer selected</span>
  {/if}
</div>
