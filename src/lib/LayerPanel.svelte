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
    Image,
    Type,
  } from "@lucide/svelte";
  import { app, bumpLayerVersion, flashStatus } from "../appState.svelte.js";
  import { pushNameEdit, pushNodeFieldEdit, structuralEdit } from "../undo";
  import {
    moveNode,
    type LayerManager,
    type LayerNode,
    type Layer as AppLayer,
    type LayerGroup,
  } from "../layers";
  import { dragBlock, dropTarget, type Drop, type RowBox } from "./layer-drop";
  import { autoScrollStep, ghostTop, pastThreshold, shiftedRowIds } from "./layer-drag-visual";
  import LayerProps from "./LayerProps.svelte";
  import { clampPanelWidth } from "../panel-layout";
  import { isDoubleTap, type Tap } from "./double-tap";
  import { parseTags, buildName } from "../spine-tags";
  import { fontLabel } from "../text-layout";
  import { selectOnFocus } from "./select-on-focus";

  let {
    layers,
    onWidthChange,
    onAddText,
    onEditText,
    settlePending,
  }: {
    layers: LayerManager;
    /** Called when a resize drag ends, so the width can be saved. */
    onWidthChange: () => void;
    /** Add a text reference (App owns the dialog and its preview). */
    onAddText: () => void;
    /** Edit the selected text reference. */
    onEditText: () => void;
    /** Before an action that copies or merges a layer's pixels: apply a lifted float and cancel an
     *  Outline preview, or the copy took the float's hole / the unapplied preview. */
    settlePending: () => void;
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

  // The layer tree is imperative, so the rows are rebuilt whenever layerVersion changes. Reading it
  // in a $derived is what makes {#key} re-render.
  const version = $derived(app.layerVersion);
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
    structuralEdit(layers, () => layers.groupActive());
    bumpLayerVersion();
  }

  function removeNode() {
    const node = layers.findNode(layers.activeId);
    const members = (n: LayerNode): number =>
      n.type === "layer" ? 1 : n.children.reduce((sum, c) => sum + members(c), 0);
    if (node && layers.flatLayers().length - members(node) < 1)
      return flashStatus("The document needs at least one layer");
    structuralEdit(layers, () => layers.removeNode(layers.activeId));
    layers.composite();
    bumpLayerVersion();
  }

  function duplicateLayer() {
    settlePending();
    // The selected row decides: a group duplicates with everything in it.
    const node = layers.findNode(layers.activeId);
    structuralEdit(layers, () =>
      node?.type === "group"
        ? layers.duplicateGroup(node.id)
        : layers.duplicateLayer(layers.activeId),
    );
    layers.composite();
    bumpLayerVersion();
  }

  function mergeDown() {
    // A reference is re-drawn from its original, which would wipe what was merged onto it.
    const loc = layers.findParent(layers.activeId);
    const target = loc && loc.index > 0 ? loc.parent[loc.index - 1] : null;
    if (layers.findNode(layers.activeId)?.type === "group")
      return flashStatus("Merge down merges a layer — pick a layer, not a group");
    if (!target) return flashStatus("Nothing below to merge onto");
    if (target.type === "group")
      return flashStatus("The row below is a group — merge down works onto a layer");
    if (target?.type === "layer" && target.ref) {
      flashStatus("The layer below is a reference — Bake it first to merge onto it");
      return;
    }
    // Merge writes into the layer below and removes this one: both must be editable.
    const src = layers.findNode(layers.activeId);
    if (target && layers.isLocked(target)) return flashStatus("The layer below is locked");
    if (src && layers.isLocked(src)) return flashStatus("Layer is locked");
    settlePending();
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

  // --- Drag reorder (2026-10-01, as slop-vector-editor; ../SLOP-LAYER-DRAG.md) ---
  // Pointer events on the grip; `layer-drop.ts` decides where a drop lands; the panel only draws
  // that (the gap, the floating row, the outlined group); the tree changes once, on release,
  // through `moveNode` as one undo step. Nothing moves a DOM node. It replaced SortableJS, which
  // moved Svelte's nodes and had the order read back from the DOM (a duplicate row, a double-fired
  // drop, and no say in locks).

  /** A press on a grip; `live` once it has travelled past the threshold and become a drag. The
   *  rows, the grab offset and the content height are measured then, once. */
  let dragging: {
    id: number;
    pointerId: number;
    row: HTMLElement;
    startX: number;
    startY: number;
    clientY: number;
    live: boolean;
    boxes: RowBox[];
    grab: number;
    rowPx: number;
    contentHeight: number;
  } | null = null;
  let drop = $state<Drop | null>(null);
  /** The floating copy of the grabbed row, in content coordinates. */
  let ghost = $state<{ top: number; label: string; pad: string; height: number } | null>(null);
  /** Rows slid down to open the gap, and the rows being dragged (dimmed in place: a group keeps
   *  its members where they are, and the gap is one row — the doc's rule 7). */
  let shifted = $state.raw<Set<number>>(new Set());
  let dimmed = $state.raw<Set<number>>(new Set());
  let slidePx = $state(0);
  let scrollFrame = 0;

  /** Every rendered row, in the list's content coordinates. */
  function rowBoxes(): RowBox[] {
    const off = listEl.scrollTop - listEl.getBoundingClientRect().top;
    return [...listEl.querySelectorAll<HTMLElement>("[data-row-id]")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        kind: el.dataset.rowKind === "group" ? "group" : "layer",
        id: Number(el.dataset.rowId),
        top: r.top + off,
        bottom: r.bottom + off,
      };
    });
  }

  function startDrag(e: PointerEvent, node: LayerNode) {
    if (e.button !== 0 || dragging) return;
    const row = (e.currentTarget as Element).closest<HTMLElement>("[data-row-id]");
    if (!row) return;
    const why = dragBlock(layers.tree, node.id);
    if (why) return flashStatus(why);
    e.preventDefault();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Capture is a convenience (and refused for a simulated pointer); the window still hears it.
    }
    dragging = {
      id: node.id,
      pointerId: e.pointerId,
      row,
      startX: e.clientX,
      startY: e.clientY,
      clientY: e.clientY,
      live: false,
      boxes: [],
      grab: 0,
      rowPx: 0,
      contentHeight: 0,
    };
    drop = null;
  }

  /** The press became a drag: measure the rows once — rows sliding aside must not move the targets
   *  they are measured against — dim what moves, lift the copy and start the edge scroll. */
  function lift(d: NonNullable<typeof dragging>) {
    d.live = true;
    d.boxes = rowBoxes();
    const r = d.row.getBoundingClientRect();
    d.grab = d.startY - r.top;
    d.rowPx = r.height;
    d.contentHeight = listEl.scrollHeight;
    const node = layers.findNode(d.id);
    const ids = new Set<number>();
    const collect = (n: LayerNode) => {
      ids.add(n.id);
      if (n.type === "group") n.children.forEach(collect);
    };
    if (node) collect(node);
    dimmed = ids;
    slidePx = r.height;
    ghost = {
      top: 0,
      label: node ? parseTags(node.name).baseName || "(unnamed)" : "",
      pad: d.row.style.paddingLeft,
      height: r.height,
    };
    document.documentElement.classList.add("layer-dragging");
    scrollFrame = requestAnimationFrame(edgeScroll);
  }

  function update(d: NonNullable<typeof dragging>) {
    if (!ghost) return;
    const y = d.clientY - listEl.getBoundingClientRect().top + listEl.scrollTop;
    drop = dropTarget(layers.tree, d.boxes, y, d.id);
    shifted = shiftedRowIds(d.boxes, drop?.line ?? null);
    ghost = { ...ghost, top: ghostTop(y, d.grab, d.contentHeight, d.rowPx) };
    document.documentElement.classList.toggle("layer-drop-refused", drop === null);
  }

  /** Near the list's top or bottom edge, scroll it — once a frame while the drag lasts. */
  function edgeScroll() {
    const d = dragging;
    if (!d) return;
    if (!listEl?.isConnected) return finishDrag();
    const view = listEl.getBoundingClientRect();
    const step = autoScrollStep(d.clientY, view.top, view.bottom);
    const max = Math.max(d.contentHeight - listEl.clientHeight, 0);
    const next = Math.min(Math.max(listEl.scrollTop + step, 0), max);
    if (next !== listEl.scrollTop) {
      listEl.scrollTop = next;
      update(d);
    }
    scrollFrame = requestAnimationFrame(edgeScroll);
  }

  // The cursor classes sit on <html>, outside this component: never leave them behind.
  $effect(() => () => finishDrag());

  /** Puts everything back as it was before the press. */
  function finishDrag() {
    cancelAnimationFrame(scrollFrame);
    dragging = null;
    drop = null;
    ghost = null;
    shifted = new Set();
    dimmed = new Set();
    document.documentElement.classList.remove("layer-dragging", "layer-drop-refused");
  }

  function moveDrag(e: PointerEvent) {
    const d = dragging;
    if (!d || e.pointerId !== d.pointerId) return;
    d.clientY = e.clientY;
    if (!d.live) {
      if (!pastThreshold(e.clientX - d.startX, e.clientY - d.startY)) return;
      lift(d);
    }
    update(d);
  }

  function endDrag(e: PointerEvent, apply: boolean) {
    const d = dragging;
    if (!d || e.pointerId !== d.pointerId) return;
    d.clientY = e.clientY;
    // A press that never became a drag lands nothing.
    if (apply && d.live) update(d);
    const target = apply && d.live ? drop : null;
    const id = d.id;
    // Clear the slides first, in the same tick as the commit, or the re-ordered rows would
    // animate back from the gap.
    finishDrag();
    if (!target) return;
    structuralEdit(layers, () => moveNode(layers.tree, id, target.parentId, target.index));
    layers.composite();
    bumpLayerVersion();
  }

  /** A row's slide while a drag is open, and its transition (only while open: at the drop the rows
   *  jump straight to their new order). */
  const slide = (id: number) => (shifted.has(id) ? `translateY(${slidePx}px)` : null);
  const slideTransition = $derived(ghost ? "transform 150ms ease" : null);

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

<svelte:window
  onpointermove={moveDrag}
  onpointerup={(e) => endDrag(e, true)}
  onpointercancel={(e) => endDrag(e, false)}
  onkeydowncapture={(e) => {
    // Escape puts the drag back — and only that: the app's own Escape mustn't also run.
    if (e.key !== "Escape" || !dragging) return;
    finishDrag();
    e.preventDefault();
    e.stopPropagation();
  }}
/>

{#snippet nameCell(node: LayerNode)}
  {#if editingId === node.id}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="layer-rename-input"
      value={draft}
      autofocus
      use:selectOnFocus
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

{#snippet grip(node: LayerNode)}
  <!-- `touch-action: none`, or iPad takes the drag for a scroll and cancels the pointer. The moves
       and the release are heard on the window. -->
  <span
    class="flex shrink-0 cursor-grab items-center self-stretch text-text-muted hover:text-text-secondary"
    style="touch-action: none"
    title="Drag to move this {node.type}"
    onpointerdown={(e) => startDrag(e, node)}
    onlostpointercapture={(e) => endDrag(e, false)}
    role="presentation"><GripVertical size={14} /></span
  >
{/snippet}

{#snippet layerRow(layer: AppLayer, depth: number)}
  <!-- ONE line. Left is identity (grip, thumbnail, name); right is state you scan ACROSS rows in
       fixed 20px columns — lock, alpha lock, eye — so they line up whatever the nesting. The
       per-layer CONTROLS (opacity, tags) live in the properties strip above the list, so a row
       never grows when selected and the row under the Pencil never moves. -->
  <!-- As slop-animator's rows: full width, so the rail and the selected bar sit on the panel edge,
       with the CONTENT indented 16px per group level; names at text-sm, the selected one brighter. -->
  <div
    class="layer-item {depth > 0
      ? 'group-rail'
      : ''} flex min-w-0 cursor-pointer items-center gap-1 border-b border-border-light py-1 pr-[6px] text-sm transition-colors hover:bg-surface-hover {layer.id ===
    layers.activeId
      ? 'ui-selected text-text'
      : 'text-text-secondary'}"
    class:opacity-40={dimmed.has(layer.id)}
    style:padding-left="{8 + 16 * depth}px"
    style:transform={slide(layer.id)}
    style:transition={slideTransition}
    data-row-id={layer.id}
    data-row-kind="layer"
    title="Tap to draw on this layer · double-tap the name to rename"
    onclick={() => {
      layers.setActive(layer.id);
      bumpLayerVersion();
    }}
    role="presentation"
  >
    {@render grip(layer)}
    <!-- 20px (was 28), drawn at 40 so it stays sharp on a retina screen. -->
    <canvas
      class="thumb-checkerboard size-5 shrink-0 rounded-sm border border-border"
      width="40"
      height="40"
      use:thumbnail={layer}
    ></canvas>
    {@render nameCell(layer)}
    <!-- Same columns, glyphs and colours as slop-animator's layer list. Alpha lock ("lock
         transparency") is the checkerboard, the usual transparency glyph — a second padlock beside the
         layer lock read as a duplicate — and fainter than the others when off, being the rarely-on one.
         A reference (image or text) can't be painted until it's baked, so it has no alpha lock: its
         kind's icon takes the column instead, so the lock and eye still line up. -->
    {#if layer.ref?.src.text?.fontMissing}
      <!-- Amber, as for anything that won't behave as expected: its font isn't on this device. -->
      <span
        class="flex size-5 shrink-0 items-center justify-center text-warn"
        title="Text reference — its font, {fontLabel(
          layer.ref.src.text.spec,
        )}, isn't on this device: add it in the text dialog (+)"><Type size={15} /></span
      >
    {:else if layer.ref?.src.text}
      <span
        class="flex size-5 shrink-0 items-center justify-center text-text-muted"
        title="Text reference — to letter over; edit it in the layer strip, Bake it to paint on it"
        ><Type size={15} /></span
      >
    {:else if layer.ref}
      <span
        class="flex size-5 shrink-0 items-center justify-center text-text-muted"
        title="Reference — moves and scales from its original; Bake it to paint on it"
        ><Image size={15} /></span
      >
    {:else}
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
    {/if}
    <!-- Amber when the layer can't be drawn on, whether by its own lock or a locked group's; the
         icon is the layer's OWN lock, which a group lock leaves as it was (as slop-animator). -->
    <button
      class="{rowBtn} {layers.isLocked(layer) ? 'text-warn' : 'text-text-muted hover:text-text'}"
      title={layer.locked
        ? "Locked — click to unlock"
        : layers.isLocked(layer)
          ? "Locked by its group — click to lock this layer too"
          : "Unlocked — click to lock drawing"}
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

{#snippet groupRow(group: LayerGroup, depth: number)}
  <div class="layer-group {depth > 0 ? 'group-rail' : ''} border-b border-border">
    <div
      class="flex min-w-0 cursor-default items-center gap-1 py-1 pr-[6px] text-sm font-semibold transition-colors {group.id ===
      layers.activeId
        ? 'ui-selected text-text'
        : 'text-text-secondary hover:bg-surface-hover'}"
      class:opacity-40={dimmed.has(group.id)}
      class:ui-drop-target={drop?.parentId === group.id}
      style:padding-left="{8 + 16 * depth}px"
      style:transform={slide(group.id)}
      style:transition={slideTransition}
      data-row-id={group.id}
      data-row-kind="group"
      title="Layer group · double-tap the name to rename"
      onclick={() => {
        layers.activeId = group.id;
        bumpLayerVersion();
      }}
      role="presentation"
    >
      {@render grip(group)}
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
      <!-- The alpha-lock column, empty (a group has no pixels of its own), so the group's lock and
           eye line up with every layer's. -->
      <span class="size-5 shrink-0" role="presentation"></span>
      <button
        class="{rowBtn} {layers.isLocked(group) ? 'text-warn' : 'text-text-muted hover:text-text'}"
        title={group.locked
          ? "Group locked — click to unlock (members keep their own locks)"
          : layers.isLocked(group)
            ? "Locked by its parent group — click to lock this group too"
            : "Unlocked — click to lock every layer in this group"}
        onclick={(e) => {
          e.stopPropagation();
          group.locked = !group.locked;
          pushNodeFieldEdit(layers, group.id, "locked", !group.locked, group.locked);
          bumpLayerVersion();
        }}
      >
        {#if group.locked}<Lock size={15} />{:else}<LockOpen size={15} />{/if}
      </button>
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

    <!-- A collapsed group's members aren't rendered: a drop on its header goes in at the top. -->
    <!-- No margin or padding: members run full width (their rail on the panel edge) and indent
         their own content by depth, as slop-animator's `group-members`. -->
    {#if !group.collapsed}
      <div>
        {@render nodeList(group.children, depth + 1)}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet nodeList(nodes: LayerNode[], depth = 0)}
  <!-- Top of the list is the top of the stack: render the array in reverse. -->
  {#each [...nodes].reverse() as node (node.id)}
    {#if node.type === "group"}
      {@render groupRow(node, depth)}
    {:else}
      {@render layerRow(node, depth)}
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
      <button
        class={headerBtn}
        onclick={addGroup}
        title="Group the selected layer or group (Ctrl+G)"
      >
        <FolderPlus size={16} />
      </button>
      <button
        class={headerBtn}
        onclick={onAddText}
        title="Add text — ghost type and guide lines to letter over"
      >
        <Type size={16} />
      </button>
      <span class="-mx-0.5 h-5 w-px shrink-0 bg-border" role="presentation"></span>
      <button class={headerBtn} onclick={duplicateLayer} title="Duplicate layer or group">
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

  <LayerProps
    {layers}
    onSettingsChange={() => bumpLayerVersion()}
    onRename={startEdit}
    {onEditText}
  />

  <div class="layer-list flex-1 overflow-y-auto" bind:this={listEl}>
    <div class="relative">
      <!-- Rebuilt whenever the tree changes (the manager is imperative). -->
      {#key version}
        {@render nodeList(layers.tree)}
      {/key}
      {#if ghost}
        <!-- The grabbed row, following the pointer. -->
        <div
          data-drag-ghost
          class="pointer-events-none absolute inset-x-0 z-10 flex items-center gap-1 rounded bg-surface-raised pr-[6px] text-sm text-text shadow-lg ring-1 ring-accent"
          style="top: {ghost.top}px; height: {ghost.height}px; padding-left: {ghost.pad}"
        >
          <span class="shrink-0 text-text-muted"><GripVertical size={14} /></span>
          <span class="min-w-0 flex-1 truncate">{ghost.label}</span>
        </div>
      {/if}
    </div>
  </div>
</div>
