<script lang="ts">
  import {
    Paintbrush,
    Eraser,
    BoxSelect,
    Lasso,
    PaintBucket,
    Undo2,
    Redo2,
    Settings2,
    Pipette,
  } from "@lucide/svelte";
  import { app, pressureCurves, type Tool } from "../appState.svelte.js";
  import type { BrushType } from "../brush-textures";
  import { createCurveEditor } from "../pressure-curve";
  import { clickOutside } from "./click-outside";
  import ToolbarMenu from "./ToolbarMenu.svelte";
  import { MAX_GAP } from "../fill-holes";
  import { MAX_NIB_FLATNESS } from "../calligraphy-brush";

  let {
    setTool,
    undo,
    redo,
    clearLayer,
    fillEnclosed,
    copy,
    cut,
    paste,
    deleteSelection,
    saveImage,
    exportPsd,
    savePsd,
    saveToFiles,
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
    fillEnclosed: () => void;
    copy: () => void;
    cut: () => void;
    paste: () => void;
    deleteSelection: () => void;
    saveImage: () => void;
    exportPsd: () => void;
    savePsd: () => void;
    /** iPad/iPhone only: null elsewhere, and then the menu item is hidden. */
    saveToFiles: (() => void) | null;
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

  // Brush settings popover (holds the set-once options, incl. the pressure curve editor)
  let curvePopupEl = $state<HTMLDivElement | null>(null);
  let settingsOpen = $state(false);
  let colorOpen = $state(false);
  let curveEditors: Record<"brush" | "eraser", HTMLElement & { redraw: () => void }> | null = null;

  // Brush and eraser have their own curve, so there is an editor per tool. The host div only
  // exists while the popover is open (and is recreated when the brush options come back after
  // another tool), so attach the active tool's editor whenever either changes.
  $effect(() => {
    if (!curvePopupEl) return;
    curveEditors ??= {
      brush: createCurveEditor(pressureCurves.brush, onSettingsChange),
      eraser: createCurveEditor(pressureCurves.eraser, onSettingsChange),
    };
    const editor = curveEditors[activeTool === "eraser" ? "eraser" : "brush"];
    curvePopupEl.replaceChildren(editor);
    editor.redraw();
  });

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

  function onNibFlatnessInput(e: Event) {
    app.brushSettings.nibFlatness = Number((e.target as HTMLInputElement).value) / 100;
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
    { tool: "eyedropper", icon: Pipette, title: "Eyedropper (I) — drag to aim, release to pick" },
  ];

  const actionBtnClass =
    "w-9 h-9 rounded-md border border-border flex items-center justify-center bg-surface text-text-secondary hover:bg-surface-hover transition-colors";
  const iconBtnClass =
    "size-9 shrink-0 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-hover transition-colors";
  const menuItem =
    "w-full text-left px-3 py-1.5 text-sm whitespace-nowrap text-text-secondary hover:bg-surface-hover flex items-center justify-between gap-6";
  const kbd = "text-[11px] text-text-muted";
  const rowCls = "flex items-center gap-2 text-xs text-text-secondary";
  const labelCls = "w-20 shrink-0";
  const valueCls = "w-10 shrink-0 text-right text-[11px] text-text-muted";
</script>

<!-- Row 1: tools, history, zoom readout, menus. Fixed height. -->
<div class="z-20 flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-4">
  <div class="flex shrink-0 items-center gap-1">
    {#each tools as { tool, icon: Icon, title }}
      <button
        class="flex h-9 w-9 items-center justify-center rounded-md border transition-colors {activeTool ===
        tool
          ? 'ui-on'
          : 'border-border bg-surface text-text-secondary'}"
        aria-pressed={activeTool === tool}
        onclick={() => setTool(tool)}
        {title}
      >
        <Icon size={20} />
      </button>
    {/each}
  </div>

  <div class="mx-2 h-6 w-px shrink-0 bg-border"></div>

  <button class={iconBtnClass} onclick={undo} title="Undo (Ctrl+Z)"><Undo2 size={20} /></button>
  <button class={iconBtnClass} onclick={redo} title="Redo (Ctrl+Shift+Z)"
    ><Redo2 size={20} /></button
  >

  <div class="mx-2 h-6 w-px shrink-0 bg-border"></div>

  <span class="min-w-12 shrink-0 text-center text-[11px] text-text-muted" title="Zoom"
    >{app.zoomText}</span
  >

  <div class="ml-auto flex shrink-0 items-center gap-1">
    <ToolbarMenu label="File">
      {#snippet children(close)}
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            newDoc();
            close();
          }}>New…</button
        >
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            openPsd();
            close();
          }}>Open project… <span class={kbd}>Ctrl+O</span></button
        >
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            savePsd();
            close();
          }}>Save project <span class={kbd}>Ctrl+S</span></button
        >
        {#if saveToFiles}
          <button
            class={menuItem}
            role="menuitem"
            title="Save the PSD to a folder you pick in Files"
            onclick={() => {
              saveToFiles();
              close();
            }}>Save to Files…</button
          >
        {/if}
        <div class="my-1 h-px bg-border"></div>
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            resizeDoc();
            close();
          }}>Resize canvas… <span class={kbd}>{app.docWidth} × {app.docHeight}</span></button
        >
      {/snippet}
    </ToolbarMenu>
    <ToolbarMenu label="Edit">
      {#snippet children(close)}
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            cut();
            close();
          }}>Cut <span class={kbd}>Ctrl+X</span></button
        >
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            copy();
            close();
          }}>Copy <span class={kbd}>Ctrl+C</span></button
        >
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            paste();
            close();
          }}>Paste <span class={kbd}>Ctrl+V</span></button
        >
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            deleteSelection();
            close();
          }}>Delete selection <span class={kbd}>Del</span></button
        >
        <div class="my-1 h-px bg-border"></div>
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            clearLayer();
            close();
          }}>Clear layer</button
        >
      {/snippet}
    </ToolbarMenu>
    <ToolbarMenu label="Export">
      {#snippet children(close)}
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            saveImage();
            close();
          }}>PNG image</button
        >
        <button
          class={menuItem}
          role="menuitem"
          title="Layered PSD for Photoshop / Spine"
          onclick={() => {
            exportPsd();
            close();
          }}>PSD (layers)</button
        >
      {/snippet}
    </ToolbarMenu>
    <ToolbarMenu label="View">
      {#snippet children(close)}
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            resetView();
            close();
          }}>Fit to view <span class={kbd}>0</span></button
        >
        <button
          class={menuItem}
          role="menuitem"
          onclick={() => {
            reset100();
            close();
          }}>Actual size <span class={kbd}>1</span></button
        >
      {/snippet}
    </ToolbarMenu>
  </div>
</div>

<!-- Row 2: options for the active tool. Keeps its minimum height when a tool has no options, so
     switching tools doesn't move the canvas. Wraps (rather than scrolling) so the pressure-curve
     popup isn't clipped; a very narrow window can still make it taller. -->
<div
  class="z-10 flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-surface px-4 py-1 *:shrink-0"
>
  <!-- Brush options -->
  {#if showBrush}
    <div class="flex items-center gap-1">
      <select
        id="brush-type"
        class="h-[30px] cursor-pointer rounded-md border border-border bg-surface px-1.5 text-xs text-text-secondary"
        value={app.brushType}
        onchange={onBrushTypeChange}
      >
        <option value="smooth">Smooth</option>
        <option value="ink">Ink</option>
        <option value="calligraphy">Calligraphy</option>
        <option value="pencil">Pencil</option>
        <option value="charcoal">Charcoal</option>
        <option value="airbrush">Airbrush</option>
      </select>
    </div>

    <div class="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-secondary">
      Size
      <input
        type="range"
        min="1"
        max="80"
        step="0.5"
        class="w-20"
        bind:value={app.brushSettings.size}
        oninput={onSettingsChange}
      />
      {#if editingSize}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="w-10 rounded border border-border bg-surface px-1 py-0.5 text-center text-[11px] text-text"
          type="text"
          inputmode="decimal"
          bind:value={sizeInputValue}
          autofocus
          onblur={commitSize}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitSize();
            }
            if (e.key === "Escape") {
              editingSize = false;
            }
            e.stopPropagation();
          }}
        />
      {:else}
        <button
          class="min-w-7 cursor-text rounded px-1 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
          onclick={startEditSize}
          title="Click to type exact size">{sizeDisplay}</button
        >
      {/if}
      <div class="flex gap-px">
        {#each sizePresets as s}
          <button
            class="rounded px-1 py-0.5 text-[10px] transition-colors
                     {app.brushSettings.size === s
              ? 'bg-accent text-accent-text'
              : 'text-text-muted hover:bg-surface-hover hover:text-text'}"
            onclick={() => setSize(s)}>{s}</button
          >
        {/each}
      </div>
    </div>
  {/if}

  {#if showBrush || showFill}
    <label class="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-secondary">
      Opacity
      <input
        type="range"
        min="1"
        max="100"
        class="w-20"
        bind:value={app.brushSettings.opacity}
        oninput={onSettingsChange}
      />
      <span class="min-w-7 text-[11px] text-text-muted">{opacityDisplay}</span>
    </label>
  {/if}

  {#if showBrush}
    <!-- Set-once settings live behind the gear so the bar keeps room for what is adjusted while
         drawing (type, size, opacity, colour). -->
    <div class="relative" use:clickOutside={() => (settingsOpen = false)}>
      <button
        class="{actionBtnClass} {settingsOpen ? 'ui-on' : ''}"
        aria-pressed={settingsOpen}
        aria-haspopup="dialog"
        onclick={() => (settingsOpen = !settingsOpen)}
        title="Brush settings — smoothing, pressure, and brush-specific options"
      >
        <Settings2 size={20} />
      </button>
      {#if settingsOpen}
        <div
          class="absolute top-full right-0 z-30 mt-1 flex w-72 flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-lg"
        >
          <label class={rowCls}>
            <span class={labelCls}>Smoothing</span>
            <input
              type="range"
              min="0"
              max="100"
              class="min-w-0 flex-1"
              bind:value={app.brushSettings.smoothing}
              oninput={onSettingsChange}
            />
            <span class={valueCls}>{app.brushSettings.smoothing}</span>
          </label>

          <label class={rowCls}>
            <span class={labelCls}>Streamline</span>
            <input
              type="range"
              min="0"
              max="100"
              class="min-w-0 flex-1"
              bind:value={app.streamline}
              oninput={onSettingsChange}
            />
            <span class={valueCls}>{app.streamline}</span>
          </label>

          <label class={rowCls}>
            <span class={labelCls}>Size range</span>
            <input
              type="range"
              min="100"
              max="5000"
              value={app.sizeRange * 100}
              oninput={onSizeRangeInput}
              class="min-w-0 flex-1"
            />
            <span class={valueCls}>{sizeRangeDisplay}</span>
          </label>

          {#if app.brushType === "calligraphy"}
            <label class={rowCls}>
              <span class={labelCls}>Nib angle</span>
              <input
                type="range"
                min="0"
                max="180"
                bind:value={app.brushSettings.nibAngle}
                oninput={onSettingsChange}
                class="min-w-0 flex-1"
              />
              <span class={valueCls}>{app.brushSettings.nibAngle}°</span>
            </label>
            <label class={rowCls}>
              <span class={labelCls}>Nib flatness</span>
              <input
                type="range"
                min="0"
                max={MAX_NIB_FLATNESS * 100}
                value={(app.brushSettings.nibFlatness ?? 0) * 100}
                oninput={onNibFlatnessInput}
                class="min-w-0 flex-1"
              />
              <span class={valueCls}>{Math.round((app.brushSettings.nibFlatness ?? 0) * 100)}</span>
            </label>
          {/if}

          {#if app.brushType === "ink"}
            <label class={rowCls} title="Swell the mark where the pen lingers">
              <span class={labelCls}>Dwell</span>
              <input
                type="range"
                min="0"
                max="100"
                bind:value={app.brushSettings.dwellPool}
                oninput={onSettingsChange}
                class="min-w-0 flex-1"
              />
              <span class={valueCls}>{app.brushSettings.dwellPool}</span>
            </label>
          {/if}

          {#if app.brushType === "smooth"}
            <label
              class="flex items-center gap-2 text-xs text-text-secondary"
              title="Taper the stroke's ends to a point instead of capping them"
            >
              <input
                type="checkbox"
                bind:checked={app.brushSettings.taper}
                onchange={onSettingsChange}
              />
              Taper stroke ends
            </label>
          {/if}

          <label class="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              bind:checked={app.brushSettings.drawBehind}
              onchange={onSettingsChange}
            />
            Draw behind existing pixels
          </label>

          <div class="mt-1 flex flex-col gap-1 border-t border-border pt-2">
            <span class="text-xs text-text-secondary"
              >Pressure curve{activeTool === "eraser" ? " (eraser)" : ""}</span
            >
            <div bind:this={curvePopupEl} class="curve-editor flex flex-col items-center"></div>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Fill options -->
  {#if showFill}
    <label class="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-secondary">
      Gap close
      <input
        type="range"
        min="0"
        max="200"
        bind:value={app.fillSettings.alphaThreshold}
        oninput={onSettingsChange}
        class="w-20"
      />
      <span class="min-w-7 text-[11px] text-text-muted">{fillThresholdDisplay}</span>
    </label>
    <label class="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-secondary">
      Expand
      <input
        type="range"
        min="0"
        max="20"
        bind:value={app.fillSettings.expand}
        oninput={onSettingsChange}
        class="w-20"
      />
      <span class="min-w-7 text-[11px] text-text-muted">{fillExpandDisplay}</span>
    </label>
    <div class="h-6 w-px bg-border"></div>
    <label
      class="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-secondary"
      title="Fill enclosed: close breaks in the outline up to about twice this many pixels"
    >
      Bridge
      <input
        type="range"
        min="0"
        max={MAX_GAP}
        bind:value={app.fillEnclosedGap}
        oninput={onSettingsChange}
        class="w-16"
      />
      <span class="min-w-4 text-[11px] text-text-muted">{app.fillEnclosedGap}</span>
    </label>
    <button
      class="h-8 rounded-md border border-border bg-surface px-2 text-xs whitespace-nowrap text-text-secondary transition-colors hover:bg-surface-hover"
      onclick={fillEnclosed}
      title="Fill every area the outlines on this layer enclose, behind the lines"
      >Fill enclosed</button
    >
  {/if}

  <!-- Color: one swatch showing the current colour, palette behind it — the bar has to fit a
       portrait iPad, and the 8 swatches plus the native picker were its widest block. -->
  {#if showBrush || showFill}
    <div class="relative flex items-center" use:clickOutside={() => (colorOpen = false)}>
      <button
        class="size-9 shrink-0 rounded-md border-2 border-border transition-colors hover:border-text-muted"
        style:background={app.brushSettings.color}
        aria-haspopup="dialog"
        aria-expanded={colorOpen}
        onclick={() => (colorOpen = !colorOpen)}
        title="Color — {app.brushSettings.color}"
      ></button>
      {#if colorOpen}
        <div
          class="absolute top-full right-0 z-30 mt-1 flex w-56 flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-lg"
        >
          <div class="grid grid-cols-4 gap-2">
            {#each swatches as { color, name }}
              <button
                class="h-8 w-full cursor-pointer rounded-md border-2 transition-transform hover:scale-105 {color ===
                app.brushSettings.color
                  ? 'border-accent'
                  : 'border-border'}"
                style:background={color}
                title={name}
                onclick={() => {
                  app.brushSettings.color = color;
                  onSettingsChange();
                }}
              ></button>
            {/each}
          </div>
          <label class="flex items-center gap-2 text-xs text-text-secondary">
            Custom
            <input
              type="color"
              bind:value={app.brushSettings.color}
              oninput={onSettingsChange}
              title="Pick any color"
            />
          </label>
        </div>
      {/if}
    </div>
  {/if}

  {#if activeTool === "eyedropper"}
    <div class="flex items-center gap-2 text-xs text-text-secondary">
      <span
        class="h-5 w-5 rounded-full border border-text-muted"
        style:background={app.brushSettings.color}
        title="Current color"
      ></span>
      <span class="text-text-muted">Drag to aim, release to pick a color</span>
    </div>
  {:else if activeTool === "select" || activeTool === "lasso"}
    <span class="text-xs text-text-muted"
      >{activeTool === "select" ? "Drag a rectangle" : "Draw around an area"} to select</span
    >
  {/if}
</div>
