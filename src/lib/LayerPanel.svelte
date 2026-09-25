<script lang="ts">
  import {
    Plus,
    FolderPlus,
    Copy,
    ArrowDownToLine,
    Trash2,
    Eye,
    EyeOff,
    Lock,
    LockOpen,
    Grid2x2,
    ChevronRight,
    ChevronDown,
    GripVertical,
  } from "@lucide/svelte";
  import { app, bumpLayerVersion } from "../appState.svelte.js";
  import { pushNameEdit, pushNodeFieldEdit, structuralEdit } from "../undo";
  import type { LayerManager, LayerNode, Layer as AppLayer, LayerGroup } from "../layers";
  import Sortable from "sortablejs";
  import LayerProps from "./LayerProps.svelte";
  import { clampPanelWidth } from "../panel-layout";
  import { isDoubleTap, type Tap } from "./double-tap";
  import { parseTags, buildName } from "../spine-tags";

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
      const before = node.name;
      node.name = buildName(base, parseTags(node.name).tags);
      pushNameEdit(layers, node.id, before, node.name);
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

  // Every row toggle gets a real 20px box: these were bare 12-14px icons, the smallest targets in
  // an iPad-first app.
  const rowBtn = "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded";
  // 28px list actions, borderless, as in slop-animator's layer list header.
  const headerBtn =
    "flex size-7 cursor-pointer items-center justify-center rounded text-text-secondary hover:bg-surface-hover";
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

{#snippet layerRow(layer: AppLayer, nested: boolean)}
  <!-- ONE line. Left is identity (grip, thumbnail, name); right is state you scan ACROSS rows in
       fixed 20px columns — lock, alpha lock, eye — so they line up whatever the nesting. The
       per-layer CONTROLS (opacity, tags) live in the properties strip above the list, so a row
       never grows when selected and the row under the Pencil never moves. -->
  <div
    class="layer-item {nested
      ? 'group-rail'
      : ''} flex min-w-0 cursor-pointer items-center gap-1.5 border-b border-border-light px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover {layer.id ===
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
    <span class="layer-drag-handle shrink-0 cursor-grab text-text-muted hover:text-text-secondary"
      ><GripVertical size={14} /></span
    >
    <canvas
      class="thumb-checkerboard h-7 w-7 shrink-0 rounded-sm border border-border"
      style="image-rendering: pixelated"
      width="28"
      height="28"
      use:thumbnail={layer}
    ></canvas>
    {@render nameCell(layer)}
    <!-- Same columns, glyphs and colours as slop-animator's layer list. Alpha lock ("lock
         transparency") is the checkerboard, the usual transparency glyph — a second padlock beside the
         layer lock read as a duplicate — and fainter than the others when off, being the rarely-on one. -->
    <button
      class="{rowBtn} {layer.alphaLock ? 'text-accent' : 'text-text-muted/50 hover:text-text'}"
      aria-pressed={layer.alphaLock}
      title={layer.alphaLock
        ? "Alpha lock on — paint lands only on existing pixels; click to turn off"
        : "Alpha lock off — click to paint only over existing pixels"}
      onclick={(e) => {
        e.stopPropagation();
        layer.alphaLock = !layer.alphaLock;
        pushNodeFieldEdit(layers, layer.id, "alphaLock", !layer.alphaLock, layer.alphaLock);
        bumpLayerVersion();
      }}
    >
      <Grid2x2 size={15} />
    </button>
    <button
      class="{rowBtn} {layer.locked ? 'text-warn' : 'text-text-muted hover:text-text'}"
      title={layer.locked ? "Locked — click to unlock" : "Unlocked — click to lock drawing"}
      onclick={(e) => {
        e.stopPropagation();
        layer.locked = !layer.locked;
        pushNodeFieldEdit(layers, layer.id, "locked", !layer.locked, layer.locked);
        bumpLayerVersion();
      }}
    >
      {#if layer.locked}<Lock size={15} />{:else}<LockOpen size={15} />{/if}
    </button>
    <button
      class="{rowBtn} {layer.visible ? 'text-text-muted hover:text-text' : 'text-warn'}"
      title={layer.visible ? "Visible — click to hide" : "Hidden — click to show"}
      onclick={(e) => {
        e.stopPropagation();
        layers.toggleVisibility(layer.id);
        pushNodeFieldEdit(layers, layer.id, "visible", !layer.visible, layer.visible);
        bumpLayerVersion();
      }}
    >
      {#if layer.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
    </button>
  </div>
{/snippet}

{#snippet groupRow(group: LayerGroup, nested: boolean)}
  <div
    class="layer-group {nested ? 'group-rail' : ''} border-b border-border"
    data-node-id={group.id}
  >
    <div
      class="flex min-w-0 cursor-default items-center gap-1 px-2 py-1 text-xs font-semibold text-text-secondary transition-colors {group.id ===
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
      <span class="layer-drag-handle shrink-0 cursor-grab text-text-muted hover:text-text-secondary"
        ><GripVertical size={14} /></span
      >
      <!-- `-ml-0.5 mr-0.5`: the chevron glyph carries its own padding on the left; shifting the box
           2px left and giving it back on the right balances the ink without moving the name. -->
      <button
        class="mr-0.5 -ml-0.5 flex w-[15px] shrink-0 cursor-pointer justify-center text-text-secondary hover:text-text"
        title={group.collapsed ? "Expand group" : "Collapse group"}
        onclick={(e) => {
          e.stopPropagation();
          group.collapsed = !group.collapsed;
          bumpLayerVersion();
        }}
      >
        {#if group.collapsed}<ChevronRight size={15} />{:else}<ChevronDown size={15} />{/if}
      </button>
      {@render nameCell(group)}
      <!-- The alpha-lock and lock columns, empty: a group has no pixels and no lock of its own here,
           and the slots keep its eye in the same column as every layer's. -->
      <span class="size-5 shrink-0" role="presentation"></span>
      <span class="size-5 shrink-0" role="presentation"></span>
      <button
        class="{rowBtn} {group.visible ? 'text-text-muted hover:text-text' : 'text-warn'}"
        title={group.visible ? "Group visible — click to hide" : "Group hidden — click to show"}
        onclick={(e) => {
          e.stopPropagation();
          layers.toggleVisibility(group.id);
          pushNodeFieldEdit(layers, group.id, "visible", !group.visible, group.visible);
          bumpLayerVersion();
        }}
      >
        {#if group.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
      </button>
    </div>

    <!-- Always rendered (hidden when collapsed) so rows can still be dropped into a collapsed
         group's container and the DOM walk keeps seeing its members. -->
    <div
      class="layer-group-children mt-0 ml-1 min-h-1 pl-2"
      style:display={group.collapsed ? "none" : "block"}
      use:sortable
    >
      {@render nodeList(group.children, true)}
    </div>
  </div>
{/snippet}

{#snippet nodeList(nodes: LayerNode[], nested = false)}
  <!-- Top of the list is the top of the stack: render the array in reverse. -->
  {#each [...nodes].reverse() as node (node.id)}
    {#if node.type === "group"}
      {@render groupRow(node, nested)}
    {:else}
      {@render layerRow(node, nested)}
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
  <!-- h-10: the tool-options row's height (Toolbar row 2, `min-h-10`), which this header sits
       beside on a wide screen, so their bottom borders make one line. -->
  <div
    class="flex h-10 shrink-0 items-center justify-between border-b border-border px-2.5 text-xs font-semibold text-text-secondary"
  >
    <span>Layers</span>
    <div class="flex items-center gap-1">
      <!-- Grouped create │ derive │ destroy, as in slop-animator (SLOP-TIMELINE-UI.md §4): Delete
           stands alone so a mis-tap on Merge can't delete. -->
      <button class={headerBtn} onclick={addLayer} title="Add layer">
        <Plus size={16} />
      </button>
      <button class={headerBtn} onclick={addGroup} title="Add group">
        <FolderPlus size={16} />
      </button>
      <span class="-mx-0.5 h-5 w-px shrink-0 bg-border" role="presentation"></span>
      <button class={headerBtn} onclick={duplicateLayer} title="Duplicate layer">
        <Copy size={16} />
      </button>
      <button class={headerBtn} onclick={mergeDown} title="Merge down onto the layer below">
        <ArrowDownToLine size={16} />
      </button>
      <span class="-mx-0.5 h-5 w-px shrink-0 bg-border" role="presentation"></span>
      <button class={headerBtn} onclick={removeNode} title="Delete layer or group">
        <Trash2 size={16} />
      </button>
    </div>
  </div>

  <LayerProps {layers} onSettingsChange={() => bumpLayerVersion()} />

  <!-- Rebuilt whenever the tree changes (the manager is imperative) or after a drag. -->
  {#key `${version}:${dragNonce}`}
    <div class="layer-list flex-1 overflow-y-auto" bind:this={listEl} use:sortable>
      {@render nodeList(layers.tree)}
    </div>
  {/key}
</div>
