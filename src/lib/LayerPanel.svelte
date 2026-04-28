<script lang="ts">
  import {
    Plus,
    FolderPlus,
    Copy,
    ArrowDownToLine,
    Minus,
  } from "@lucide/svelte";
  import { app, bumpLayerVersion } from "../appState.svelte.js";
  import type { LayerManager, LayerNode, Layer as AppLayer, LayerGroup } from "../layers";
  import Sortable from "sortablejs";
  import {
    parseTags,
    buildName,
    toggleTag,
    tagsForNodeType,
    tagConflictReason,
    TAG_DESCRIPTIONS,
  } from "../spine-tags";

  let {
    layers,
  }: {
    layers: LayerManager;
  } = $props();

  function addLayer() {
    layers.addLayer();
    bumpLayerVersion();
  }

  function addGroup() {
    layers.addGroup();
    bumpLayerVersion();
  }

  function removeNode() {
    layers.removeNode(layers.activeId);
    layers.composite();
    bumpLayerVersion();
  }

  function duplicateLayer() {
    layers.duplicateLayer(layers.activeId);
    layers.composite();
    bumpLayerVersion();
  }

  function mergeDown() {
    layers.mergeDown(layers.activeId);
    layers.composite();
    bumpLayerVersion();
  }

  // --- Imperative layer list rendering (same approach as original vanilla code) ---
  // This avoids Svelte/SortableJS DOM conflicts entirely.
  let layerListEl: HTMLDivElement;

  function syncTreeFromDom(container: HTMLElement, targetArray: LayerNode[], lookup: Map<number, LayerNode>) {
    targetArray.length = 0;
    const items = container.children;
    for (let i = items.length - 1; i >= 0; i--) {
      const el = items[i] as HTMLElement;
      const id = Number(el.dataset.nodeId);
      const node = lookup.get(id);
      if (!node) continue;
      targetArray.push(node);
      if (node.type === "group") {
        const childContainer = el.querySelector(":scope > .layer-group-children") as HTMLElement;
        if (childContainer) {
          syncTreeFromDom(childContainer, node.children, lookup);
        }
      }
    }
  }

  function makeSortable(container: HTMLElement) {
    Sortable.create(container, {
      group: "layers",
      animation: 150,
      fallbackOnBody: true,
      swapThreshold: 0.65,
      handle: ".layer-drag-handle",
      onEnd: () => {
        const lookup = new Map<number, LayerNode>();
        for (const n of layers.flatAll()) {
          lookup.set(n.id, n);
        }
        syncTreeFromDom(layerListEl, layers.tree, lookup);
        layers.composite();
        bumpLayerVersion();
      },
    });
  }

  function makeRenameHandler(nameEl: HTMLSpanElement, node: LayerNode) {
    nameEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const { tags, baseName } = parseTags(node.name);
      const input = document.createElement("input");
      input.type = "text";
      input.className = "layer-rename-input";
      input.value = baseName;
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        const newBase = input.value.trim();
        if (newBase) node.name = buildName(newBase, tags);
        input.replaceWith(nameEl);
        nameEl.textContent = parseTags(node.name).baseName || "(unnamed)";
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (ke) => {
        if (ke.key === "Enter") { ke.preventDefault(); input.blur(); }
        if (ke.key === "Escape") { input.value = baseName; input.blur(); }
        ke.stopPropagation();
      });
      input.addEventListener("click", (ce) => ce.stopPropagation());
    });
  }

  // ---- Spine tag picker ----

  const TAG_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>`;

  let openPopoverEl: HTMLDivElement | null = null;
  let openPopoverNodeId: number | null = null;

  function closePopover() {
    if (openPopoverEl) {
      openPopoverEl.remove();
      openPopoverEl = null;
      openPopoverNodeId = null;
      document.removeEventListener("pointerdown", onDocPointerDown, true);
    }
  }

  function onDocPointerDown(e: PointerEvent) {
    if (openPopoverEl && !openPopoverEl.contains(e.target as Node)) {
      closePopover();
    }
  }

  function openTagPopover(anchor: HTMLElement, node: LayerNode) {
    closePopover();
    const popover = document.createElement("div");
    openPopoverEl = popover;
    openPopoverNodeId = node.id;
    popover.className = "fixed z-50 bg-surface border border-border rounded-md shadow-lg p-1 text-xs flex flex-col gap-0.5 min-w-[180px]";
    const valid = tagsForNodeType(node.type);
    function refresh() {
      popover.innerHTML = "";
      const { tags } = parseTags(node.name);
      for (const t of valid) {
        const isOn = tags.includes(t);
        const conflict = tagConflictReason(t, tags);
        const disabled = conflict !== null;
        const row = document.createElement("button");
        row.disabled = disabled;
        row.className = "flex items-center gap-2 px-2 py-1 rounded text-left " +
          (disabled
            ? "text-text-muted cursor-not-allowed opacity-50"
            : "text-text-secondary cursor-pointer hover:bg-surface-hover");
        row.title = conflict ?? TAG_DESCRIPTIONS[t];
        const check = document.createElement("span");
        check.className = "shrink-0 w-3.5 h-3.5 border border-border rounded-sm flex items-center justify-center text-[9px] " + (isOn ? "bg-accent text-accent-text border-accent" : "");
        check.textContent = isOn ? "✓" : "";
        const label = document.createElement("span");
        label.className = "flex-1 font-mono text-text";
        label.textContent = `[${t}]`;
        const desc = document.createElement("span");
        desc.className = "text-text-muted text-[10px] truncate";
        desc.textContent = conflict ?? TAG_DESCRIPTIONS[t];
        row.appendChild(check);
        row.appendChild(label);
        row.appendChild(desc);
        if (!disabled) {
          row.addEventListener("click", (e) => {
            e.stopPropagation();
            node.name = toggleTag(node.name, t);
            bumpLayerVersion();
            refresh();
          });
        }
        popover.appendChild(row);
      }
    }
    refresh();
    const rect = anchor.getBoundingClientRect();
    popover.style.left = rect.left + "px";
    popover.style.top = (rect.bottom + 4) + "px";
    document.body.appendChild(popover);
    // Adjust if it would overflow the right edge
    const popRect = popover.getBoundingClientRect();
    if (popRect.right > window.innerWidth - 8) {
      popover.style.left = (window.innerWidth - popRect.width - 8) + "px";
    }
    // Defer the outside-click listener so the click that opened us doesn't immediately close.
    // Guard against the popover being closed in between (e.g. by a deletion-triggered $effect).
    setTimeout(() => {
      if (openPopoverEl === popover) {
        document.addEventListener("pointerdown", onDocPointerDown, true);
      }
    }, 0);
  }

  function makeTagButton(node: LayerNode): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "shrink-0 p-0 border-none bg-transparent cursor-pointer text-text-secondary opacity-50 hover:opacity-100 flex items-center";
    btn.title = "Spine tags";
    btn.innerHTML = TAG_ICON_SVG;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openTagPopover(btn, node);
    });
    return btn;
  }

  function buildNameSpan(node: LayerNode): HTMLSpanElement {
    const { baseName } = parseTags(node.name);
    const nameEl = document.createElement("span");
    nameEl.className = "flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
    nameEl.textContent = baseName || "(unnamed)";
    makeRenameHandler(nameEl, node);
    return nameEl;
  }

  function buildTagPills(node: LayerNode): HTMLSpanElement[] {
    const { tags } = parseTags(node.name);
    return tags.map((t) => {
      const pill = document.createElement("span");
      pill.className = "shrink-0 px-1 rounded text-[9px] leading-[11px] bg-accent text-accent-text border border-accent font-mono cursor-pointer hover:opacity-70";
      pill.textContent = t;
      pill.title = `[${t}] — click to remove`;
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        node.name = toggleTag(node.name, t);
        bumpLayerVersion();
      });
      return pill;
    });
  }

  function renderLayerItem(layer: AppLayer): HTMLElement {
    const item = document.createElement("div");
    item.className = "layer-item flex flex-col gap-0.5 px-2 py-1 border-b border-border-light cursor-pointer text-xs transition-colors text-text-secondary hover:bg-surface-hover" +
      (layer.id === layers.activeId ? " !bg-surface-active !text-text" : "");
    item.dataset.nodeId = String(layer.id);

    // ----- Row 1: handle, vis, thumb, name -----
    const row1 = document.createElement("div");
    row1.className = "flex items-center gap-1.5 min-w-0";

    const handle = document.createElement("span");
    handle.className = "layer-drag-handle cursor-grab text-text-muted hover:text-text-secondary shrink-0 select-none text-base";
    handle.textContent = "\u2261";

    const visBtn = document.createElement("button");
    visBtn.className = "shrink-0 p-0 border-none bg-transparent cursor-pointer opacity-60 hover:opacity-100 text-text-secondary text-sm";
    visBtn.textContent = layer.visible ? "\u{1F441}" : "\u2013";
    visBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      layers.toggleVisibility(layer.id);
      bumpLayerVersion();
    });

    const thumb = document.createElement("canvas");
    thumb.className = "w-7 h-7 border border-border rounded-sm thumb-checkerboard shrink-0";
    thumb.style.imageRendering = "pixelated";
    thumb.width = 28;
    thumb.height = 28;
    thumb.getContext("2d")!.drawImage(layer.canvas, 0, 0, 28, 28);

    const nameSpan = buildNameSpan(layer);

    row1.appendChild(handle);
    row1.appendChild(visBtn);
    row1.appendChild(thumb);
    row1.appendChild(nameSpan);

    // ----- Row 2: pills, tag picker, lock, alpha lock, opacity slider -----
    const row2 = document.createElement("div");
    row2.className = "flex items-center gap-1.5 pl-9 min-w-0 leading-none";

    for (const pill of buildTagPills(layer)) row2.appendChild(pill);

    const tagBtn = makeTagButton(layer);

    const lockBtn = document.createElement("button");
    lockBtn.className = "shrink-0 p-0 border-none bg-transparent cursor-pointer text-text-secondary text-[11px] transition-opacity " +
      (layer.locked ? "opacity-100" : "opacity-30 hover:opacity-60");
    lockBtn.textContent = "\u{1F512}";
    lockBtn.title = "Lock layer";
    lockBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      layer.locked = !layer.locked;
      lockBtn.classList.toggle("opacity-100", layer.locked);
      lockBtn.classList.toggle("opacity-30", !layer.locked);
    });

    const alphaBtn = document.createElement("button");
    alphaBtn.className = "shrink-0 p-0 border-none bg-transparent cursor-pointer text-text-secondary text-[11px] transition-opacity " +
      (layer.alphaLock ? "opacity-100" : "opacity-30 hover:opacity-60");
    alphaBtn.textContent = "\u{1F3C1}";
    alphaBtn.title = "Alpha lock";
    alphaBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      layer.alphaLock = !layer.alphaLock;
      alphaBtn.classList.toggle("opacity-100", layer.alphaLock);
      alphaBtn.classList.toggle("opacity-30", !layer.alphaLock);
    });

    const opSlider = document.createElement("input");
    opSlider.type = "range";
    opSlider.className = "flex-1 min-w-0 h-3";
    opSlider.min = "0";
    opSlider.max = "100";
    opSlider.value = String(layer.opacity);
    opSlider.addEventListener("input", (e) => {
      e.stopPropagation();
      layers.setOpacity(layer.id, Number(opSlider.value));
    });
    opSlider.addEventListener("click", (e) => e.stopPropagation());

    row2.appendChild(tagBtn);
    row2.appendChild(lockBtn);
    row2.appendChild(alphaBtn);
    row2.appendChild(opSlider);

    item.addEventListener("click", () => {
      layers.setActive(layer.id);
      bumpLayerVersion();
    });

    item.appendChild(row1);
    item.appendChild(row2);
    return item;
  }

  function renderGroupItem(group: LayerGroup): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "layer-group border-b border-border";
    wrapper.dataset.nodeId = String(group.id);

    const header = document.createElement("div");
    header.className = "flex flex-col gap-0.5 px-1.5 py-1 text-xs font-semibold cursor-default transition-colors text-text-secondary " +
      (group.id === layers.activeId ? "bg-group-active outline outline-2 outline-selection -outline-offset-2" : "bg-group-bg hover:bg-group-hover");

    // ----- Row 1: handle, collapse, vis, name -----
    const row1 = document.createElement("div");
    row1.className = "flex items-center gap-1 min-w-0";

    const handle = document.createElement("span");
    handle.className = "layer-drag-handle cursor-grab text-text-muted hover:text-text-secondary shrink-0 select-none text-base";
    handle.textContent = "\u2261";

    const collapseBtn = document.createElement("button");
    collapseBtn.className = "w-4 h-4 border-none bg-transparent cursor-pointer text-text-muted p-0 shrink-0 text-[10px]";
    collapseBtn.textContent = group.collapsed ? "\u25B6" : "\u25BC";
    collapseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      group.collapsed = !group.collapsed;
      collapseBtn.textContent = group.collapsed ? "\u25B6" : "\u25BC";
      childContainer.style.display = group.collapsed ? "none" : "block";
    });

    const visBtn = document.createElement("button");
    visBtn.className = "shrink-0 p-0 border-none bg-transparent cursor-pointer opacity-60 hover:opacity-100 text-text-secondary text-sm";
    visBtn.textContent = group.visible ? "\u{1F441}" : "\u2013";
    visBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      layers.toggleVisibility(group.id);
      bumpLayerVersion();
    });

    const nameSpan = buildNameSpan(group);

    row1.appendChild(handle);
    row1.appendChild(collapseBtn);
    row1.appendChild(visBtn);
    row1.appendChild(nameSpan);

    // ----- Row 2: pills, tag picker, opacity slider -----
    const row2 = document.createElement("div");
    row2.className = "flex items-center gap-1.5 pl-7 min-w-0 leading-none";

    for (const pill of buildTagPills(group)) row2.appendChild(pill);

    const tagBtn = makeTagButton(group);

    const opSlider = document.createElement("input");
    opSlider.type = "range";
    opSlider.className = "flex-1 min-w-0 h-3";
    opSlider.min = "0";
    opSlider.max = "100";
    opSlider.value = String(group.opacity);
    opSlider.addEventListener("input", (e) => {
      e.stopPropagation();
      layers.setOpacity(group.id, Number(opSlider.value));
    });
    opSlider.addEventListener("click", (e) => e.stopPropagation());

    row2.appendChild(tagBtn);
    row2.appendChild(opSlider);

    header.addEventListener("click", () => {
      layers.activeId = group.id;
      bumpLayerVersion();
    });

    header.appendChild(row1);
    header.appendChild(row2);
    wrapper.appendChild(header);

    const childContainer = document.createElement("div");
    childContainer.className = "layer-group-children pl-2 border-l border-border ml-1 min-h-1";
    childContainer.style.display = group.collapsed ? "none" : "block";
    renderNodeList(group.children, childContainer);
    wrapper.appendChild(childContainer);

    return wrapper;
  }

  function renderNodeList(nodes: LayerNode[], container: HTMLElement) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.type === "group") {
        container.appendChild(renderGroupItem(node));
      } else {
        container.appendChild(renderLayerItem(node as AppLayer));
      }
    }
    makeSortable(container);
  }

  function renderLayerList() {
    if (!layerListEl) return;
    layerListEl.innerHTML = "";
    renderNodeList(layers.tree, layerListEl);
  }

  // Re-render layer list when layerVersion changes
  $effect(() => {
    void app.layerVersion;
    // If the popover was anchored to a node that no longer exists (deleted),
    // close it. Otherwise leave it open so multi-toggle keeps working.
    if (openPopoverNodeId !== null) {
      const stillExists = layers.flatAll().some((n) => n.id === openPopoverNodeId);
      if (!stillExists) closePopover();
    }
    renderLayerList();
  });
</script>

<div class="layer-panel w-70 min-w-70 bg-surface border-l border-border flex flex-col overflow-hidden relative z-2">
  <div class="flex items-center justify-between px-2.5 py-2 border-b border-border text-xs font-semibold text-text-secondary">
    <span>Layers</span>
    <div class="flex gap-0.5">
      <button class="w-6 h-6 border border-border rounded bg-surface hover:bg-surface-hover flex items-center justify-center text-text-secondary cursor-pointer" onclick={addLayer} title="Add Layer">
        <Plus size={14} />
      </button>
      <button class="w-6 h-6 border border-border rounded bg-surface hover:bg-surface-hover flex items-center justify-center text-text-secondary cursor-pointer" onclick={addGroup} title="Add Group">
        <FolderPlus size={14} />
      </button>
      <button class="w-6 h-6 border border-border rounded bg-surface hover:bg-surface-hover flex items-center justify-center text-text-secondary cursor-pointer" onclick={duplicateLayer} title="Duplicate Layer">
        <Copy size={14} />
      </button>
      <button class="w-6 h-6 border border-border rounded bg-surface hover:bg-surface-hover flex items-center justify-center text-text-secondary cursor-pointer" onclick={mergeDown} title="Merge Down">
        <ArrowDownToLine size={14} />
      </button>
      <button class="w-6 h-6 border border-border rounded bg-surface hover:bg-surface-hover flex items-center justify-center text-text-secondary cursor-pointer" onclick={removeNode} title="Remove">
        <Minus size={14} />
      </button>
    </div>
  </div>

  <div class="flex-1 overflow-y-auto" bind:this={layerListEl}></div>
</div>
