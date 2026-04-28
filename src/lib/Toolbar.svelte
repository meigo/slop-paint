<script lang="ts">
  import {
    Paintbrush,
    Eraser,
    BoxSelect,
    Lasso,
    PaintBucket,
    Undo2,
    Redo2,
    Trash2,
    Download,
    Save,
    FolderOpen,
    RotateCcw,
    Spline,
    FileDown,
    FilePlus,
  } from "@lucide/svelte";
  import ThemeToggle from "./ThemeToggle.svelte";
  import { app, pressureCurve, type Tool } from "../appState.svelte.js";
  import type { BrushType } from "../brush-textures";
  import { createCurveEditor } from "../pressure-curve";

  let {
    setTool,
    undo,
    redo,
    clearLayer,
    saveImage,
    exportPsd,
    savePsd,
    openPsd,
    newDoc,
    resizeDoc,
    resetView,
    reset100,
    onSettingsChange,
  }: {
    setTool: (tool: Tool) => void;
    undo: () => void;
    redo: () => void;
    clearLayer: () => void;
    saveImage: () => void;
    exportPsd: () => void;
    savePsd: () => void;
    openPsd: () => void;
    newDoc: () => void;
    resizeDoc: () => void;
    resetView: () => void;
    reset100: () => void;
    onSettingsChange: () => void;
  } = $props();

  let sizeDisplay = $derived(String(app.brushSettings.size));
  let opacityDisplay = $derived(app.brushSettings.opacity + "%");
  let sizeRangeDisplay = $derived(app.sizeRange.toFixed(1) + "x");
  let fillThresholdDisplay = $derived(String(app.fillSettings.alphaThreshold ?? 0));
  let fillExpandDisplay = $derived((app.fillSettings.expand ?? 0) + "px");

  let activeTool = $derived(app.currentTool);
  let showBrush = $derived(activeTool === "brush" || activeTool === "eraser");
  let showFill = $derived(activeTool === "fill");

  // Size editing
  let editingSize = $state(false);
  let sizeInputValue = $state("");

  function startEditSize() {
    sizeInputValue = String(app.brushSettings.size);
    editingSize = true;
  }

  function commitSize() {
    const v = parseFloat(sizeInputValue);
    if (!isNaN(v) && v >= 1 && v <= 80) {
      app.brushSettings.size = Math.round(v * 2) / 2; // snap to 0.5
      onSettingsChange();
    }
    editingSize = false;
  }

  function setSize(s: number) {
    app.brushSettings.size = s;
    onSettingsChange();
  }

  const sizePresets = [1, 2, 3, 5, 8, 12, 20, 40, 80];

  // Pressure curve popup
  let curvePopupEl = $state<HTMLDivElement | null>(null);
  let curveOpen = $state(false);
  let curveEditorEl: (HTMLElement & { redraw: () => void }) | null = null;

  $effect(() => {
    if (curvePopupEl && !curveEditorEl) {
      curveEditorEl = createCurveEditor(pressureCurve, onSettingsChange);
      curvePopupEl.appendChild(curveEditorEl);
    }
  });

  // Close curve popup when clicking outside — use mousedown (not pointerdown)
  // and check with a flag to avoid closing on the same click that opens
  let curveButtonEl = $state<HTMLButtonElement | null>(null);

  function handleDocumentClick(e: MouseEvent) {
    if (!curveOpen || !curvePopupEl || !curveButtonEl) return;
    if (!curvePopupEl.contains(e.target as Node) && !curveButtonEl.contains(e.target as Node)) {
      curveOpen = false;
    }
  }

  const swatches = [
    { color: "#1a1a1a", name: "Black" },
    { color: "#ffffff", name: "White" },
    { color: "#ef4444", name: "Red" },
    { color: "#3b82f6", name: "Blue" },
    { color: "#22c55e", name: "Green" },
    { color: "#f59e0b", name: "Yellow" },
    { color: "#8b5cf6", name: "Purple" },
    { color: "#ec4899", name: "Pink" },
  ];

  function onBrushTypeChange(e: Event) {
    app.brushType = (e.target as HTMLSelectElement).value as BrushType;
    onSettingsChange();
  }

  function onSizeRangeInput(e: Event) {
    app.sizeRange = Number((e.target as HTMLInputElement).value) / 100;
    onSettingsChange();
  }

  const tools: { tool: Tool; icon: typeof Paintbrush; title: string }[] = [
    { tool: "brush", icon: Paintbrush, title: "Brush (B)" },
    { tool: "eraser", icon: Eraser, title: "Eraser (E)" },
    { tool: "select", icon: BoxSelect, title: "Rect Select (S)" },
    { tool: "lasso", icon: Lasso, title: "Lasso Select (L)" },
    { tool: "fill", icon: PaintBucket, title: "Paint Bucket (G)" },
  ];

  const actionBtnClass = "w-9 h-9 rounded-md border border-border flex items-center justify-center bg-surface text-text-secondary hover:bg-surface-hover transition-colors";
</script>

<svelte:document onclick={handleDocumentClick} />

<div class="flex items-center gap-4 px-4 py-2 bg-surface border-b border-border shadow-sm z-10 flex-wrap min-h-12">
  <!-- Tool buttons -->
  <div class="flex items-center gap-1">
    {#each tools as { tool, icon: Icon, title }}
      <button
        class="w-9 h-9 rounded-md border flex items-center justify-center transition-colors"
        class:bg-accent={activeTool === tool}
        class:text-accent-text={activeTool === tool}
        class:border-accent={activeTool === tool}
        class:bg-surface={activeTool !== tool}
        class:text-text-secondary={activeTool !== tool}
        class:border-border={activeTool !== tool}
        onclick={() => setTool(tool)}
        {title}
      >
        <Icon size={20} />
      </button>
    {/each}
  </div>

  <!-- Brush options -->
  {#if showBrush}
    <div class="flex items-center gap-1">
      <select
        id="brush-type"
        class="h-[30px] border border-border rounded-md bg-surface text-text-secondary text-xs px-1.5 cursor-pointer"
        value={app.brushType}
        onchange={onBrushTypeChange}
      >
        <option value="smooth">Smooth</option>
        <option value="pencil">Pencil</option>
        <option value="charcoal">Charcoal</option>
        <option value="airbrush">Airbrush</option>
      </select>
    </div>

    <div class="flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap">
      Size
      <input type="range" min="1" max="80" step="0.5" class="w-20" bind:value={app.brushSettings.size} oninput={onSettingsChange} />
      {#if editingSize}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="w-10 text-[11px] text-center bg-surface border border-border rounded px-1 py-0.5 text-text"
          type="text"
          inputmode="decimal"
          bind:value={sizeInputValue}
          autofocus
          onblur={commitSize}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === "Enter") { e.preventDefault(); commitSize(); }
            if (e.key === "Escape") { editingSize = false; }
            e.stopPropagation();
          }}
        />
      {:else}
        <button
          class="text-[11px] min-w-7 text-text-muted hover:text-text hover:bg-surface-hover rounded px-1 py-0.5 cursor-text"
          onclick={startEditSize}
          title="Click to type exact size"
        >{sizeDisplay}</button>
      {/if}
      <div class="flex gap-px">
        {#each sizePresets as s}
          <button
            class="text-[10px] px-1 py-0.5 rounded transition-colors
                   {app.brushSettings.size === s ? 'bg-accent text-accent-text' : 'text-text-muted hover:bg-surface-hover hover:text-text'}"
            onclick={() => setSize(s)}
          >{s}</button>
        {/each}
      </div>
    </div>
  {/if}

  {#if showBrush || showFill}
    <label class="flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap">
      Opacity
      <input type="range" min="1" max="100" class="w-20" bind:value={app.brushSettings.opacity} oninput={onSettingsChange} />
      <span class="text-[11px] min-w-7 text-text-muted">{opacityDisplay}</span>
    </label>
  {/if}

  {#if showBrush}
    <label class="flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap">
      Smoothing
      <input type="range" min="0" max="100" class="w-20" bind:value={app.brushSettings.smoothing} oninput={onSettingsChange} />
    </label>

    <label class="flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap">
      Streamline
      <input type="range" min="0" max="100" class="w-20" bind:value={app.streamline} oninput={onSettingsChange} />
    </label>

    <label class="flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap">
      <input type="checkbox" bind:checked={app.brushSettings.drawBehind} onchange={onSettingsChange} />
      Behind
    </label>

    <label class="flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap">
      Size range
      <input type="range" min="100" max="5000" value={app.sizeRange * 100} oninput={onSizeRangeInput} class="w-20" />
      <span class="text-[11px] min-w-7 text-text-muted">{sizeRangeDisplay}</span>
    </label>

    <div class="relative">
      <button
        class={actionBtnClass}
        bind:this={curveButtonEl}
        onclick={() => { curveOpen = !curveOpen; }}
        title="Pressure Curve"
      >
        <Spline size={20} />
      </button>
      <div class="curve-popup" class:open={curveOpen} bind:this={curvePopupEl}></div>
    </div>
  {/if}

  <!-- Fill options -->
  {#if showFill}
    <label class="flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap">
      Gap close
      <input type="range" min="0" max="200" bind:value={app.fillSettings.alphaThreshold} oninput={onSettingsChange} class="w-20" />
      <span class="text-[11px] min-w-7 text-text-muted">{fillThresholdDisplay}</span>
    </label>
    <label class="flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap">
      Expand
      <input type="range" min="0" max="20" bind:value={app.fillSettings.expand} oninput={onSettingsChange} class="w-20" />
      <span class="text-[11px] min-w-7 text-text-muted">{fillExpandDisplay}</span>
    </label>
  {/if}

  <!-- Color -->
  {#if showBrush || showFill}
    <div class="flex items-center gap-1">
      <input type="color" bind:value={app.brushSettings.color} oninput={onSettingsChange} title="Color" />
      <div class="flex gap-0.5">
        {#each swatches as { color, name }}
          <button
            class="w-[22px] h-[22px] rounded-full border-2 border-border cursor-pointer transition-transform hover:scale-120"
            class:border-text-muted={color === "#ffffff"}
            style:background={color}
            title={name}
            onclick={() => { app.brushSettings.color = color; onSettingsChange(); }}
          ></button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Zoom + reset -->
  <div class="flex items-center gap-1">
    <span class="text-[11px] text-text-muted min-w-9 text-center cursor-default">{app.zoomText}</span>
    <button class={actionBtnClass} onclick={resetView} title="Fit to View (Ctrl+0)">
      <RotateCcw size={20} />
    </button>
    <button
      class="h-9 px-2 rounded-md border border-border bg-surface text-text-secondary text-[11px] font-mono hover:bg-surface-hover transition-colors"
      onclick={reset100}
      title="Actual Size — 100% (Ctrl+1)"
    >
      1:1
    </button>
  </div>

  <!-- Doc size (click to resize) -->
  <button
    class="text-[11px] text-text-muted hover:text-text hover:bg-surface-hover rounded px-1 py-0.5 whitespace-nowrap"
    onclick={resizeDoc}
    title="Resize Canvas"
  >{app.docWidth} x {app.docHeight}</button>

  <!-- Actions -->
  <div class="flex items-center gap-1 ml-auto">
    <button class={actionBtnClass} onclick={undo} title="Undo (Ctrl+Z)"><Undo2 size={20} /></button>
    <button class={actionBtnClass} onclick={redo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={20} /></button>
    <button class={actionBtnClass} onclick={clearLayer} title="Clear Layer"><Trash2 size={20} /></button>
    <button class={actionBtnClass} onclick={newDoc} title="New Document"><FilePlus size={20} /></button>
    <button class={actionBtnClass} onclick={saveImage} title="Save as PNG"><Download size={20} /></button>
    <button class={actionBtnClass} onclick={exportPsd} title="Export as PSD"><FileDown size={20} /></button>
    <button class={actionBtnClass} onclick={savePsd} title="Save Project (Ctrl+S)"><Save size={20} /></button>
    <button class={actionBtnClass} onclick={openPsd} title="Open Project (Ctrl+O)"><FolderOpen size={20} /></button>
    <ThemeToggle />
  </div>
</div>
