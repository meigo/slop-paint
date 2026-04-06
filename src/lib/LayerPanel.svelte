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
      const input = document.createElement("input");
      input.type = "text";
      input.className = "layer-rename-input";
      input.value = node.name;
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        node.name = input.value.trim() || node.name;
        input.replaceWith(nameEl);
        nameEl.textContent = node.name;
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (ke) => {
        if (ke.key === "Enter") { ke.preventDefault(); input.blur(); }
        if (ke.key === "Escape") { input.value = node.name; input.blur(); }
        ke.stopPropagation();
      });
      input.addEventListener("click", (ce) => ce.stopPropagation());
    });
  }

  function renderLayerItem(layer: AppLayer): HTMLElement {
    const item = document.createElement("div");
    item.className = "layer-item flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border-light cursor-pointer text-xs transition-colors text-text-secondary hover:bg-surface-hover" +
      (layer.id === layers.activeId ? " !bg-surface-active !text-text" : "");
    item.dataset.nodeId = String(layer.id);

    // Drag handle
    const handle = document.createElement("span");
    handle.className = "layer-drag-handle cursor-grab text-text-muted hover:text-text-secondary shrink-0 select-none text-base";
    handle.textContent = "\u2261";

    // Visibility
    const visBtn = document.createElement("button");
    visBtn.className = "shrink-0 p-0 border-none bg-transparent cursor-pointer opacity-60 hover:opacity-100 text-text-secondary text-sm";
    visBtn.textContent = layer.visible ? "\u{1F441}" : "\u2013";
    visBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      layers.toggleVisibility(layer.id);
      bumpLayerVersion();
    });

    // Thumbnail
    const thumb = document.createElement("canvas");
    thumb.className = "w-7 h-7 border border-border rounded-sm thumb-checkerboard shrink-0";
    thumb.style.imageRendering = "pixelated";
    thumb.width = 28;
    thumb.height = 28;
    thumb.getContext("2d")!.drawImage(layer.canvas, 0, 0, 28, 28);

    // Name
    const nameEl = document.createElement("span");
    nameEl.className = "flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
    nameEl.textContent = layer.name;
    makeRenameHandler(nameEl, layer);

    // Lock
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

    // Alpha lock
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

    // Opacity slider
    const opSlider = document.createElement("input");
    opSlider.type = "range";
    opSlider.className = "w-12";
    opSlider.min = "0";
    opSlider.max = "100";
    opSlider.value = String(layer.opacity);
    opSlider.addEventListener("input", (e) => {
      e.stopPropagation();
      layers.setOpacity(layer.id, Number(opSlider.value));
    });
    opSlider.addEventListener("click", (e) => e.stopPropagation());

    // Click to select
    item.addEventListener("click", () => {
      layers.setActive(layer.id);
      bumpLayerVersion();
    });

    item.appendChild(handle);
    item.appendChild(visBtn);
    item.appendChild(thumb);
    item.appendChild(nameEl);
    item.appendChild(lockBtn);
    item.appendChild(alphaBtn);
    item.appendChild(opSlider);
    return item;
  }

  function renderGroupItem(group: LayerGroup): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "layer-group border-b border-border";
    wrapper.dataset.nodeId = String(group.id);

    const header = document.createElement("div");
    header.className = "flex items-center gap-1 px-1.5 py-1 text-xs font-semibold cursor-default transition-colors text-text-secondary " +
      (group.id === layers.activeId ? "bg-group-active outline outline-2 outline-selection -outline-offset-2" : "bg-group-bg hover:bg-group-hover");

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

    const nameEl = document.createElement("span");
    nameEl.className = "flex-1 overflow-hidden text-ellipsis whitespace-nowrap";
    nameEl.textContent = group.name;
    makeRenameHandler(nameEl, group);

    const opSlider = document.createElement("input");
    opSlider.type = "range";
    opSlider.className = "w-12";
    opSlider.min = "0";
    opSlider.max = "100";
    opSlider.value = String(group.opacity);
    opSlider.addEventListener("input", (e) => {
      e.stopPropagation();
      layers.setOpacity(group.id, Number(opSlider.value));
    });
    opSlider.addEventListener("click", (e) => e.stopPropagation());

    header.addEventListener("click", () => {
      layers.activeId = group.id;
      bumpLayerVersion();
    });

    header.appendChild(handle);
    header.appendChild(collapseBtn);
    header.appendChild(visBtn);
    header.appendChild(nameEl);
    header.appendChild(opSlider);
    wrapper.appendChild(header);

    const childContainer = document.createElement("div");
    childContainer.className = "layer-group-children pl-3 border-l-2 border-border ml-2 min-h-1";
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
