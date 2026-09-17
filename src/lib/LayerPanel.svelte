<script lang="ts">
  import {
    Plus,
    FolderPlus,
    Copy,
    ArrowDownToLine,
    Minus,
    Eye,
    EyeOff,
    Lock,
    LockOpen,
    Blend,
    Tag,
    ChevronRight,
    ChevronDown,
    GripVertical,
  } from "@lucide/svelte";
  import { app, bumpLayerVersion } from "../appState.svelte.js";
  import { structuralEdit } from "../undo";
  import type { LayerManager, LayerNode, Layer as AppLayer, LayerGroup } from "../layers";
  import Sortable from "sortablejs";
  import { clickOutside } from "./click-outside";
  import { clampPanelWidth } from "../panel-layout";
  import { sliderFill } from "./slider-fill";
  import { isDoubleTap, type Tap } from "./double-tap";
  import {
    parseTags,
    buildName,
    toggleTag,
    tagsForNodeType,
    tagConflictReason,
    TAG_DESCRIPTIONS,
    type SpineTag,
  } from "../spine-tags";

  let {
    layers,
    onWidthChange,
  }: {
    layers: LayerManager;
    /** Called when a resize drag ends, so the width can be saved. */
    onWidthChange: () => void;
  } = $props();

  // Panel resize. The panel is docked RIGHT, so dragging its left-edge grip LEFT makes it wider —
  // hence (start - current). Pointer capture keeps the drag alive outside the 8px strip.
  let gripStartX = 0;
  let gripStartW = 0;

  function gripDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gripStartX = e.clientX;
    gripStartW = app.layerPanelWidth;
  }

  function gripMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    app.layerPanelWidth = clampPanelWidth(gripStartW + (gripStartX - e.clientX), window.innerWidth);
  }

  function gripUp(e: PointerEvent) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    onWidthChange();
  }

  // The layer tree is imperative, so the list is rebuilt whenever layerVersion changes (and after a
  // drag, see rebuildFromDom). Reading it in a $derived is what makes {#key} re-render.
  const version = $derived(app.layerVersion);
  let dragNonce = $state(0);
  let dropHandled = false; // one drop can fire onEnd twice (cross-list); rebuild once
  let listEl = $state<HTMLDivElement>()!;

  let editingId = $state<number | null>(null);
  let draft = $state("");
  let tagPopoverFor = $state<number | null>(null);
  let lastTap: Tap | null = null;

  // --- Header actions ---

  function addLayer() {
    structuralEdit(layers, () => layers.addLayer());
    bumpLayerVersion();
  }

  function addGroup() {
    structuralEdit(layers, () => layers.addGroup());
    bumpLayerVersion();
  }

  function removeNode() {
    structuralEdit(layers, () => layers.removeNode(layers.activeId));
    layers.composite();
    bumpLayerVersion();
  }

  function duplicateLayer() {
    structuralEdit(layers, () => layers.duplicateLayer(layers.activeId));
    layers.composite();
    bumpLayerVersion();
  }

  function mergeDown() {
    // Merge also writes pixels onto the layer below, so that layer's pixels join the undo step.
    structuralEdit(
      layers,
      () => layers.mergeDown(layers.activeId),
      () => {
        const loc = layers.findParent(layers.activeId);
        const below = loc && loc.index > 0 ? loc.parent[loc.index - 1] : null;
        return below?.type === "layer" ? below : null;
      },
    );
    layers.composite();
    bumpLayerVersion();
  }

  // --- Drag reorder (SortableJS owns the DOM during a drag; we read the result back) ---

  function syncTreeFromDom(
    container: HTMLElement,
    targetArray: LayerNode[],
    lookup: Map<number, LayerNode>,
  ) {
    targetArray.length = 0;
    // The list is drawn top-first, the data is bottom-first.
    for (let i = container.children.length - 1; i >= 0; i--) {
      const el = container.children[i] as HTMLElement;
      const node = lookup.get(Number(el.dataset.nodeId));
      if (!node) continue;
      targetArray.push(node);
      if (node.type === "group") {
        const childContainer = el.querySelector(":scope > .layer-group-children");
        if (childContainer) syncTreeFromDom(childContainer as HTMLElement, node.children, lookup);
      }
    }
  }

  function rebuildFromDom(evt: Sortable.SortableEvent) {
    // One drop can fire onEnd twice (source list + destination list). The first walk already reads
    // the whole final order, and the node removal below would corrupt a second one.
    if (dropHandled) return;
    dropHandled = true;
    queueMicrotask(() => (dropHandled = false));

    const lookup = new Map<number, LayerNode>();
    for (const n of layers.flatAll()) lookup.set(n.id, n);
    structuralEdit(layers, () => syncTreeFromDom(listEl, layers.tree, lookup));

    // SortableJS physically moved the dragged node. Dropped at the bottom it can land past the
    // {#each} end anchor, where the re-render's teardown can't reach it and it survives as a
    // duplicate row. Remove it ourselves; the dragNonce re-render then rebuilds from state.
    evt.item.remove();
    dragNonce++;
    layers.composite();
    bumpLayerVersion();
  }

  /** Svelte action: make a container's rows draggable, including between groups. */
  function sortable(node: HTMLElement) {
    const s = Sortable.create(node, {
      group: "layers",
      animation: 150,
      fallbackOnBody: true,
      swapThreshold: 0.65,
      handle: ".layer-drag-handle",
      onEnd: rebuildFromDom,
    });
    return { destroy: () => s.destroy() };
  }

  /** Svelte action: draw a layer's pixels into its thumbnail canvas. */
  function thumbnail(node: HTMLCanvasElement, layer: AppLayer) {
    const draw = () => {
      const ctx = node.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, node.width, node.height);
      ctx.drawImage(layer.canvas, 0, 0, node.width, node.height);
    };
    draw();
    return { update: draw };
  }

  // --- Rename: double-click (mouse) or double-tap (iPad doesn't fire dblclick reliably) ---

  function startEdit(node: LayerNode) {
    draft = parseTags(node.name).baseName;
    editingId = node.id;
  }

  function commitEdit(node: LayerNode) {
    const base = draft.trim();
    if (base) {
      node.name = buildName(base, parseTags(node.name).tags);
      bumpLayerVersion();
    }
    editingId = null;
  }

  function onNamePointerDown(e: PointerEvent, node: LayerNode) {
    const tap: Tap = {
      target: `${node.type}:${node.id}`,
      t: e.timeStamp,
      x: e.clientX,
      y: e.clientY,
    };
    if (isDoubleTap(lastTap, tap)) {
      e.stopPropagation();
      e.preventDefault();
      lastTap = null;
      startEdit(node);
      return;
    }
    lastTap = tap;
  }

  // --- Spine tags ---

  function toggleNodeTag(node: LayerNode, tag: SpineTag) {
    node.name = toggleTag(node.name, tag);
    bumpLayerVersion();
  }

  const rowBtn = "shrink-0 cursor-pointer text-text-secondary transition-opacity";
  const headerBtn =
    "flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-border bg-surface text-text-secondary hover:bg-surface-hover";
</script>

{#snippet nameCell(node: LayerNode)}
  {#if editingId === node.id}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="layer-rename-input"
      value={draft}
      autofocus
      oninput={(e) => (draft = e.currentTarget.value)}
      onblur={() => commitEdit(node)}
      onclick={(e) => e.stopPropagation()}
      onpointerdown={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          editingId = null;
        }
        e.stopPropagation();
      }}
    />
  {:else}
    <span
      class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
      ondblclick={(e) => {
        e.stopPropagation();
        startEdit(node);
      }}
      onpointerdown={(e) => onNamePointerDown(e, node)}
      role="presentation">{parseTags(node.name).baseName || "(unnamed)"}</span
    >
  {/if}
{/snippet}

{#snippet tagRow(node: LayerNode)}
  {#each parseTags(node.name).tags as t (t)}
    <button
      class="shrink-0 cursor-pointer rounded border border-accent bg-accent px-1 font-mono text-[9px] leading-[11px] text-accent-text hover:opacity-70"
      title="[{t}] — click to remove"
      onclick={(e) => {
        e.stopPropagation();
        toggleNodeTag(node, t);
      }}>{t}</button
    >
  {/each}
  <div class="relative flex shrink-0 items-center" use:clickOutside={() => (tagPopoverFor = null)}>
    <button
      class="{rowBtn} flex items-center opacity-50 hover:opacity-100"
      title="Spine tags"
      onclick={(e) => {
        e.stopPropagation();
        tagPopoverFor = tagPopoverFor === node.id ? null : node.id;
      }}
    >
      <Tag size={14} />
    </button>
    {#if tagPopoverFor === node.id}
      <div
        class="absolute top-full left-0 z-50 mt-1 flex min-w-[200px] flex-col gap-0.5 rounded-md border border-border bg-surface p-1 text-xs shadow-lg"
      >
        {#each tagsForNodeType(node.type) as t (t)}
          {@const tags = parseTags(node.name).tags}
          {@const conflict = tagConflictReason(t, tags)}
          <button
            class="flex items-center gap-2 rounded px-2 py-1 text-left {conflict
              ? 'cursor-not-allowed text-text-muted opacity-50'
              : 'cursor-pointer text-text-secondary hover:bg-surface-hover'}"
            disabled={!!conflict}
            title={conflict ?? TAG_DESCRIPTIONS[t]}
            onclick={(e) => {
              e.stopPropagation();
              toggleNodeTag(node, t);
            }}
          >
            <span
              class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-border text-[9px] {tags.includes(
                t,
              )
                ? 'border-accent bg-accent text-accent-text'
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
{/snippet}

{#snippet layerRow(layer: AppLayer)}
  <div
    class="layer-item flex cursor-pointer flex-col gap-0.5 border-b border-border-light px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover {layer.id ===
    layers.activeId
      ? 'ui-selected'
      : ''}"
    data-node-id={layer.id}
    title="Tap to draw on this layer · double-tap the name to rename"
    onclick={() => {
      layers.setActive(layer.id);
      bumpLayerVersion();
    }}
    role="presentation"
  >
    <div class="flex min-w-0 items-center gap-1.5">
      <span class="layer-drag-handle shrink-0 cursor-grab text-text-muted hover:text-text-secondary"
        ><GripVertical size={14} /></span
      >
      <button
        class="{rowBtn} opacity-60 hover:opacity-100"
        title={layer.visible ? "Hide layer" : "Show layer"}
        onclick={(e) => {
          e.stopPropagation();
          layers.toggleVisibility(layer.id);
          bumpLayerVersion();
        }}
      >
        {#if layer.visible}<Eye size={14} />{:else}<EyeOff size={14} />{/if}
      </button>
      <canvas
        class="thumb-checkerboard h-7 w-7 shrink-0 rounded-sm border border-border"
        style="image-rendering: pixelated"
        width="28"
        height="28"
        use:thumbnail={layer}
      ></canvas>
      {@render nameCell(layer)}
    </div>

    <div class="flex min-w-0 items-center gap-1.5 pl-9 leading-none">
      {@render tagRow(layer)}
      <button
        class="{rowBtn} {layer.locked ? 'opacity-100' : 'opacity-30 hover:opacity-60'}"
        title={layer.locked ? "Unlock layer" : "Lock layer (no drawing)"}
        onclick={(e) => {
          e.stopPropagation();
          layer.locked = !layer.locked;
          bumpLayerVersion();
        }}
      >
        {#if layer.locked}<Lock size={12} />{:else}<LockOpen size={12} />{/if}
      </button>
      <button
        class="{rowBtn} {layer.alphaLock ? 'opacity-100' : 'opacity-30 hover:opacity-60'}"
        title="Alpha lock — paint only where this layer already has pixels"
        onclick={(e) => {
          e.stopPropagation();
          layer.alphaLock = !layer.alphaLock;
          bumpLayerVersion();
        }}
      >
        <Blend size={12} />
      </button>
      <input
        type="range"
        class="h-3 min-w-0 flex-1"
        title="Opacity"
        min="0"
        max="100"
        style={sliderFill(layer.opacity, 0, 100)}
        value={layer.opacity}
        oninput={(e) => {
          e.stopPropagation();
          layers.setOpacity(layer.id, Number(e.currentTarget.value));
        }}
        onclick={(e) => e.stopPropagation()}
      />
    </div>
  </div>
{/snippet}

{#snippet groupRow(group: LayerGroup)}
  <div class="layer-group border-b border-border" data-node-id={group.id}>
    <div
      class="flex cursor-default flex-col gap-0.5 px-1.5 py-1 text-xs font-semibold text-text-secondary transition-colors {group.id ===
      layers.activeId
        ? 'ui-selected'
        : 'bg-group-bg hover:bg-group-hover'}"
      title="Layer group · double-tap the name to rename"
      onclick={() => {
        layers.activeId = group.id;
        bumpLayerVersion();
      }}
      role="presentation"
    >
      <div class="flex min-w-0 items-center gap-1">
        <span
          class="layer-drag-handle shrink-0 cursor-grab text-text-muted hover:text-text-secondary"
          ><GripVertical size={14} /></span
        >
        <button
          class="{rowBtn} text-text-muted"
          title={group.collapsed ? "Expand group" : "Collapse group"}
          onclick={(e) => {
            e.stopPropagation();
            group.collapsed = !group.collapsed;
            bumpLayerVersion();
          }}
        >
          {#if group.collapsed}<ChevronRight size={12} />{:else}<ChevronDown size={12} />{/if}
        </button>
        <button
          class="{rowBtn} opacity-60 hover:opacity-100"
          title={group.visible ? "Hide group" : "Show group"}
          onclick={(e) => {
            e.stopPropagation();
            layers.toggleVisibility(group.id);
            bumpLayerVersion();
          }}
        >
          {#if group.visible}<Eye size={14} />{:else}<EyeOff size={14} />{/if}
        </button>
        {@render nameCell(group)}
      </div>

      <div class="flex min-w-0 items-center gap-1.5 pl-7 leading-none">
        {@render tagRow(group)}
        <input
          type="range"
          class="h-3 min-w-0 flex-1"
          title="Group opacity"
          min="0"
          max="100"
          style={sliderFill(group.opacity, 0, 100)}
          value={group.opacity}
          oninput={(e) => {
            e.stopPropagation();
            layers.setOpacity(group.id, Number(e.currentTarget.value));
          }}
          onclick={(e) => e.stopPropagation()}
        />
      </div>
    </div>

    <!-- Always rendered (hidden when collapsed) so rows can still be dropped into a collapsed
         group's container and the DOM walk keeps seeing its members. -->
    <div
      class="layer-group-children mt-0 ml-1 min-h-1 border-l border-border pl-2"
      style:display={group.collapsed ? "none" : "block"}
      use:sortable
    >
      {@render nodeList(group.children)}
    </div>
  </div>
{/snippet}

{#snippet nodeList(nodes: LayerNode[])}
  <!-- Top of the list is the top of the stack: render the array in reverse. -->
  {#each [...nodes].reverse() as node (node.id)}
    {#if node.type === "group"}
      {@render groupRow(node)}
    {:else}
      {@render layerRow(node)}
    {/if}
  {/each}
{/snippet}

<div
  class="layer-panel relative z-2 flex shrink-0 flex-col overflow-hidden border-l border-border bg-surface"
  style:width="{app.layerPanelWidth}px"
>
  <!-- Resize grip on the docked edge: an 8px hit strip, tinted on hover. `touch-action: none` or
       iPad treats the drag as a scroll and cancels the pointer stream. -->
  <div
    class="group absolute inset-y-0 left-0 z-30 w-2 cursor-col-resize"
    style="touch-action: none"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize layer panel"
    title="Drag to resize the layer panel"
    onpointerdown={gripDown}
    onpointermove={gripMove}
    onpointerup={gripUp}
    onpointercancel={gripUp}
  >
    <div class="absolute inset-y-0 left-0 w-1 group-hover:bg-text/10"></div>
  </div>
  <div
    class="flex items-center justify-between border-b border-border px-2.5 py-2 text-xs font-semibold text-text-secondary"
  >
    <span>Layers</span>
    <div class="flex gap-0.5">
      <button class={headerBtn} onclick={addLayer} title="Add layer">
        <Plus size={14} />
      </button>
      <button class={headerBtn} onclick={addGroup} title="Add group">
        <FolderPlus size={14} />
      </button>
      <button class={headerBtn} onclick={duplicateLayer} title="Duplicate layer">
        <Copy size={14} />
      </button>
      <button class={headerBtn} onclick={mergeDown} title="Merge down onto the layer below">
        <ArrowDownToLine size={14} />
      </button>
      <button class={headerBtn} onclick={removeNode} title="Delete layer or group">
        <Minus size={14} />
      </button>
    </div>
  </div>

  <!-- Rebuilt whenever the tree changes (the manager is imperative) or after a drag. -->
  {#key `${version}:${dragNonce}`}
    <div class="layer-list flex-1 overflow-y-auto" bind:this={listEl} use:sortable>
      {@render nodeList(layers.tree)}
    </div>
  {/key}
</div>
