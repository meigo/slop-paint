<script lang="ts">
  import {
    Paintbrush,
    Eraser,
    BoxSelect,
    Lasso,
    PaintBucket,
    Undo2,
    Redo2,
    Settings,
    Pipette,
    SquareMinus,
    Dices,
    Check,
    X,
    Move,
    SquareDashed,
    Grid3x3,
    FlipHorizontal2,
    FlipVertical2,
    Link2,
    Link2Off,
    Copy,
    Scissors,
    ClipboardPaste,
    Trash2,
    SquareX,
    Scan,
    SendToBack,
  } from "@lucide/svelte";
  import { app, pressureCurves, type Tool } from "../appState.svelte.js";
  import type { BrushType } from "../brush-textures";
  import { createCurveEditor } from "../pressure-curve";
  import { clickOutside } from "./click-outside";
  import ToolbarMenu from "./ToolbarMenu.svelte";
  import { MAX_GAP } from "../fill-holes";
  import { MAX_NIB_FLATNESS } from "../calligraphy-brush";
  import { MAX_THICKNESS } from "../outline";
  import { PRESS_MAX, PRESS_MIN } from "../brush";
  import { sliderFill } from "./slider-fill";

  let {
    setTool,
    undo,
    redo,
    clearLayer,
    fillEnclosed,
    applyOutline,
    cancelOutline,
    canUndo,
    canRedo,
    hasSelection,
    hasClipboard,
    canCopy,
    selectAll,
    deselect,
    selectionMode,
    warpIsMesh,
    liftBlock,
    transform,
    distort,
    mesh,
    flip,
    toggleKeepProportions,
    applyFloat,
    cancelFloat,
    copy,
    cut,
    paste,
    deleteSelection,
    saveImage,
    exportPsd,
    savePsd,
    saveToFiles,
    openPsd,
    importReference,
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
    applyOutline: () => void;
    cancelOutline: () => void;
    canUndo: boolean;
    canRedo: boolean;
    /** A plain marquee exists, so copy/cut/delete can act. */
    hasSelection: boolean;
    hasClipboard: boolean;
    /** A marquee or a float — copy takes either. */
    canCopy: boolean;
    selectAll: () => void;
    deselect: () => void;
    selectionMode: "idle" | "selected" | "transforming" | "warping";
    /** Warping on a denser grid than Distort's 2×2. */
    warpIsMesh: boolean;
    /** Why transform/flip/cut/delete can't act on the active layer ("the layer is locked"), or "". */
    liftBlock: string;
    transform: () => void;
    distort: () => void;
    mesh: () => void;
    flip: (axis: "h" | "v") => void;
    toggleKeepProportions: () => void;
    applyFloat: () => void;
    cancelFloat: () => void;
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
    /** Pick an image file to add as a reference layer. */
    importReference: () => void;
    newDoc: () => void;
    resizeDoc: () => void;
    resetView: () => void;
    reset100: () => void;
    onSettingsChange: () => void;
  } = $props();

  let sizeDisplay = $derived(String(app.brushSettings.size));
  let opacityDisplay = $derived(app.brushSettings.opacity + "%");
  let fillThresholdDisplay = $derived(String(app.fillSettings.alphaThreshold ?? 0));
  let fillExpandDisplay = $derived((app.fillSettings.expand ?? 0) + "px");

  let activeTool = $derived(app.currentTool);
  let showBrush = $derived(activeTool === "brush" || activeTool === "eraser");
  let showFill = $derived(activeTool === "fill");
  let outlineWobble = $derived(Math.round(app.outline.wobble * 100));
  let outlineVariation = $derived(Math.round(app.outline.variation * 100));
  let outlineRandom = $derived(app.outline.wobble > 0 || app.outline.variation > 0);

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

  const tools: { tool: Tool; icon: typeof Paintbrush; title: string }[] = [
    { tool: "brush", icon: Paintbrush, title: "Brush (B)" },
    { tool: "eraser", icon: Eraser, title: "Eraser (E)" },
    { tool: "select", icon: BoxSelect, title: "Rect Select (S)" },
    { tool: "lasso", icon: Lasso, title: "Lasso Select (L)" },
    { tool: "fill", icon: PaintBucket, title: "Paint Bucket (G)" },
    { tool: "eyedropper", icon: Pipette, title: "Eyedropper (I) — drag to aim, release to pick" },
    { tool: "outline", icon: SquareMinus, title: "Outline — hollow the layer's shapes to a line" },
  ];

  const actionBtnClass =
    "size-7 rounded-md border border-border flex items-center justify-center bg-surface text-text-secondary hover:bg-surface-hover transition-colors";
  const iconBtnClass =
    "size-9 shrink-0 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-hover transition-colors";
  const menuItem =
    "w-full text-left px-3 py-1.5 text-sm whitespace-nowrap text-text-secondary hover:bg-surface-hover flex items-center justify-between gap-6";
  const kbd = "text-[11px] text-text-muted";
  const dimmable =
    "aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent";
  // Cut/Delete need a plain marquee; over a float (copy's other case) they wait for Apply/Cancel.
  let whyNoMarquee = $derived(canCopy ? "apply or cancel the transform first" : "nothing selected");
  // Paste is never dimmed: the system clipboard can hold an image from another app (Photos on an
  // iPad) that the app cannot see until it asks. An empty paste says so in the status bar.
  let pasteTitle = $derived(
    hasClipboard
      ? "Paste (Ctrl+V)"
      : "Paste (Ctrl+V) — an image from another app becomes a reference layer",
  );
  let floating = $derived(selectionMode === "transforming" || selectionMode === "warping");
  let selecting = $derived(selectionMode !== "idle");
  // Transform, Distort, Mesh and Flip lift the marquee's pixels, so they need an editable layer.
  let liftWhy = $derived(!selecting ? "nothing selected" : !floating && liftBlock ? liftBlock : "");
  let flipWhy = $derived(liftWhy || (selectionMode === "warping" ? "not while warping" : ""));
  let distortOn = $derived(selectionMode === "warping" && !warpIsMesh);
  let meshOn = $derived(selectionMode === "warping" && warpIsMesh);
  const iconBtn =
    "flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors";
  const iconIdle = "border-border bg-surface text-text-secondary hover:bg-surface-hover";
  const rowCls = "flex items-center gap-2 text-xs text-text-secondary";
  const labelCls = "w-20 shrink-0";
  const valueCls = "w-10 shrink-0 text-right text-[11px] text-text-muted";
</script>

<!-- Row 1: tools, history, zoom readout, menus. Fixed height. -->
<!-- grid-area: App.svelte lays the two rows out in its grid (row 1 always full width). -->
<div
  class="z-20 flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-4"
  style:grid-area="row1"
>
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

  <!-- aria-disabled, not `disabled`: a disabled button dispatches no pointer events, so the status
       bar's hint could never read its title — and on iPad the hint is the only explanation. -->
  <button
    class="{iconBtnClass} {dimmable}"
    aria-disabled={!canUndo}
    title={canUndo ? "Undo (Ctrl+Z)" : "Undo — nothing to undo"}
    onclick={() => {
      if (canUndo) undo();
    }}><Undo2 size={20} /></button
  >
  <button
    class="{iconBtnClass} {dimmable}"
    aria-disabled={!canRedo}
    title={canRedo ? "Redo (Ctrl+Shift+Z)" : "Redo — nothing to redo"}
    onclick={() => {
      if (canRedo) redo();
    }}><Redo2 size={20} /></button
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
          title="Add an image as a faint reference layer to draw over (tagged [ignore] for Spine)"
          onclick={() => {
            importReference();
            close();
          }}>Import reference image…</button
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
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!hasSelection}
          title={hasSelection ? "" : "Cut — nothing selected"}
          onclick={() => {
            if (hasSelection) cut();
            close();
          }}>Cut <span class={kbd}>Ctrl+X</span></button
        >
        <button
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!canCopy}
          title={canCopy ? "" : "Copy — nothing selected"}
          onclick={() => {
            if (canCopy) copy();
            close();
          }}>Copy <span class={kbd}>Ctrl+C</span></button
        >
        <button
          class={menuItem}
          role="menuitem"
          title={pasteTitle}
          onclick={() => {
            paste();
            close();
          }}>Paste <span class={kbd}>Ctrl+V</span></button
        >
        <button
          class="{menuItem} {dimmable}"
          role="menuitem"
          aria-disabled={!hasSelection}
          title={hasSelection ? "" : "Delete — nothing selected"}
          onclick={() => {
            if (hasSelection) deleteSelection();
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
  class="z-10 flex min-h-10 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-4 py-1 *:shrink-0"
  style:grid-area="row2"
>
  <!-- Brush options -->
  {#if showBrush}
    <div class="flex items-center gap-1">
      <select
        id="brush-type"
        class="h-7 cursor-pointer rounded-md border border-border bg-surface-raised px-1.5 text-xs text-text-secondary"
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
        class="w-16"
        style={sliderFill(app.brushSettings.size, 1, 80)}
        bind:value={app.brushSettings.size}
        oninput={onSettingsChange}
      />
      {#if editingSize}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="h-7 w-12 rounded-md border border-border bg-surface-raised px-1 text-center text-[11px] text-text"
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
          class="h-7 w-12 cursor-text rounded-md text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
          onclick={startEditSize}
          title="Click to type exact size">{sizeDisplay}</button
        >
      {/if}
      <div class="flex gap-px">
        {#each sizePresets as s}
          <button
            class="size-6 rounded-md text-[10px] transition-colors {app.brushSettings.size === s
              ? 'ui-on'
              : 'text-text-muted hover:bg-surface-hover hover:text-text'}"
            title="Brush size {s}"
            onclick={() => setSize(s)}>{s}</button
          >
        {/each}
      </div>
    </div>

    <label
      class="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-secondary"
      title="How much pen pressure widens the stroke. 1× is a constant width"
    >
      Press
      <input
        type="range"
        min={PRESS_MIN}
        max={PRESS_MAX}
        step="0.5"
        class="w-16"
        style={sliderFill(app.sizeRange, PRESS_MIN, PRESS_MAX)}
        value={app.sizeRange}
        oninput={(e) => {
          app.sizeRange = Number((e.target as HTMLInputElement).value);
          onSettingsChange();
        }}
      />
      <span class="min-w-7 text-[11px] text-text-muted">{app.sizeRange}×</span>
    </label>
  {/if}

  {#if showBrush || showFill}
    <label class="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-secondary">
      Opacity
      <input
        type="range"
        min="1"
        max="100"
        class="w-16"
        style={sliderFill(app.brushSettings.opacity, 1, 100)}
        bind:value={app.brushSettings.opacity}
        oninput={onSettingsChange}
      />
      <span class="min-w-7 text-[11px] text-text-muted">{opacityDisplay}</span>
    </label>
  {/if}

  <!-- Draw behind is toggled while drawing (flats under line art), so it sits on the bar, not behind
       the gear. Brush only: the eraser ignores it. -->
  {#if activeTool === "brush"}
    <div class="flex items-center">
      <button
        class="{actionBtnClass} {app.brushSettings.drawBehind ? 'ui-on' : ''}"
        aria-pressed={app.brushSettings.drawBehind}
        title={app.brushSettings.drawBehind
          ? "Draw behind on — paint goes under existing pixels; tap to turn off"
          : "Draw behind — paint under existing pixels"}
        onclick={() => {
          app.brushSettings.drawBehind = !app.brushSettings.drawBehind;
          onSettingsChange();
        }}><SendToBack size={18} /></button
      >
    </div>
  {/if}

  {#if showBrush}
    <!-- Set-once settings live behind the gear. The bar keeps what changes while drawing:
         type, size, Press, opacity, draw-behind, colour. -->
    <div class="relative" use:clickOutside={() => (settingsOpen = false)}>
      <button
        class="{actionBtnClass} {settingsOpen ? 'ui-on' : ''}"
        aria-pressed={settingsOpen}
        aria-haspopup="dialog"
        onclick={() => (settingsOpen = !settingsOpen)}
        title="Brush settings — stream, and options for this brush"
      >
        <Settings size={18} />
      </button>
      {#if settingsOpen}
        <div
          class="absolute top-full right-0 z-30 mt-1 flex w-72 flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-lg"
        >
          {#if app.brushType === "smooth"}
            <label class={rowCls} title="Smooth the perfect-freehand outline">
              <span class={labelCls}>Smooth</span>
              <input
                type="range"
                min="0"
                max="100"
                class="min-w-0 flex-1"
                style={sliderFill(app.brushSettings.smoothing, 0, 100)}
                bind:value={app.brushSettings.smoothing}
                oninput={onSettingsChange}
              />
              <span class={valueCls}>{app.brushSettings.smoothing}</span>
            </label>
          {/if}

          <label class={rowCls} title="Smooth the incoming pointer path">
            <span class={labelCls}>Stream</span>
            <input
              type="range"
              min="0"
              max="100"
              class="min-w-0 flex-1"
              style={sliderFill(app.streamline, 0, 100)}
              bind:value={app.streamline}
              oninput={onSettingsChange}
            />
            <span class={valueCls}>{app.streamline}</span>
          </label>

          {#if app.brushType === "calligraphy"}
            <label class={rowCls}>
              <span class={labelCls}>Nib angle</span>
              <input
                type="range"
                min="0"
                max="180"
                style={sliderFill(app.brushSettings.nibAngle ?? 0, 0, 180)}
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
                style={sliderFill(
                  (app.brushSettings.nibFlatness ?? 0) * 100,
                  0,
                  MAX_NIB_FLATNESS * 100,
                )}
                value={(app.brushSettings.nibFlatness ?? 0) * 100}
                oninput={onNibFlatnessInput}
                class="min-w-0 flex-1"
              />
              <span class={valueCls}>{Math.round((app.brushSettings.nibFlatness ?? 0) * 100)}</span>
            </label>
          {/if}

          {#if app.brushType === "ink"}
            <label
              class={rowCls}
              title="Swell the mark where the pen lingers, the way ink soaks in — 0 is off"
            >
              <span class={labelCls}>Pool</span>
              <input
                type="range"
                min="0"
                max="100"
                style={sliderFill(app.brushSettings.dwellPool ?? 0, 0, 100)}
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
        style={sliderFill(app.fillSettings.alphaThreshold ?? 0, 0, 200)}
        bind:value={app.fillSettings.alphaThreshold}
        oninput={onSettingsChange}
        class="w-16"
      />
      <span class="min-w-7 text-[11px] text-text-muted">{fillThresholdDisplay}</span>
    </label>
    <label class="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-secondary">
      Expand
      <input
        type="range"
        min="0"
        max="20"
        style={sliderFill(app.fillSettings.expand ?? 0, 0, 20)}
        bind:value={app.fillSettings.expand}
        oninput={onSettingsChange}
        class="w-16"
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
        style={sliderFill(app.fillEnclosedGap, 0, MAX_GAP)}
        bind:value={app.fillEnclosedGap}
        oninput={onSettingsChange}
        class="w-16"
      />
      <span class="min-w-4 text-[11px] text-text-muted">{app.fillEnclosedGap}</span>
    </label>
    <button
      class="h-7 rounded-md border border-border bg-surface-raised px-2 text-xs whitespace-nowrap text-text-secondary transition-colors hover:bg-surface-hover"
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
        class="size-7 shrink-0 rounded-md border-2 border-border transition-colors hover:border-text-muted"
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
  {:else if activeTool === "outline"}
    <label
      class="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-secondary"
      title="Outline thickness in pixels"
    >
      Thickness
      <input
        type="range"
        min="0.5"
        max={MAX_THICKNESS}
        step="0.5"
        style={sliderFill(app.outline.thickness, 0.5, MAX_THICKNESS)}
        bind:value={app.outline.thickness}
        class="w-16"
      />
      <span class="min-w-7 text-[11px] text-text-muted">{app.outline.thickness}</span>
    </label>
    <label
      class="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-secondary"
      title="Outline wobble: how far the line wanders across the edge"
    >
      Wobble
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        style={sliderFill(outlineWobble, 0, 100)}
        value={outlineWobble}
        oninput={(e) => (app.outline.wobble = Number(e.currentTarget.value) / 100)}
        class="w-16"
      />
      <span class="min-w-7 text-[11px] text-text-muted">{outlineWobble}%</span>
    </label>
    <label
      class="flex items-center gap-1.5 text-xs whitespace-nowrap text-text-secondary"
      title="Outline variation: how much the line swells and thins"
    >
      Variation
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        style={sliderFill(outlineVariation, 0, 100)}
        value={outlineVariation}
        oninput={(e) => (app.outline.variation = Number(e.currentTarget.value) / 100)}
        class="w-16"
      />
      <span class="min-w-7 text-[11px] text-text-muted">{outlineVariation}%</span>
    </label>
    <div class="flex items-center">
      <!-- The seed only moves WHERE the line wobbles and swells; with both at 0 there is nothing to
           reshuffle, so say so rather than take a silent tap. -->
      <button
        class="{actionBtnClass} {dimmable}"
        aria-disabled={!outlineRandom}
        title={outlineRandom
          ? "Shuffle the outline's randomness"
          : "Shuffle — set Wobble or Variation above 0 first"}
        aria-label="Shuffle the outline's randomness"
        onclick={() => {
          if (outlineRandom) app.outline.seed = (app.outline.seed + 1) | 0;
        }}><Dices size={18} /></button
      >
    </div>
    <div class="h-6 w-px bg-border"></div>
    <div class="flex items-center gap-1">
      <button
        class="ui-on flex size-7 items-center justify-center rounded-md border {dimmable}"
        aria-disabled={!app.outlineActive}
        title={app.outlineActive
          ? "Apply outline (Enter)"
          : "Apply outline — tap the canvas to preview the active layer first"}
        aria-label="Apply outline"
        onclick={() => {
          if (app.outlineActive) applyOutline();
        }}><Check size={18} /></button
      >
      <button
        class="{actionBtnClass} {dimmable}"
        aria-disabled={!app.outlineActive}
        title={app.outlineActive ? "Cancel outline (Esc)" : "Cancel outline — nothing to cancel"}
        aria-label="Cancel outline"
        onclick={() => {
          if (app.outlineActive) cancelOutline();
        }}><X size={18} /></button
      >
    </div>
    {#if !app.outlineActive}
      <span class="text-xs text-text-muted">Tap the canvas to outline the active layer</span>
    {/if}
  {:else if activeTool === "select" || activeTool === "lasso"}
    <!-- Every selection action lives here (this app has no floating bar over the selection): a float
         can only exist on Select/Lasso — switching tools applies it — so this row is always showing
         when there is one. Left-aligned, so a button never moves when another is dimmed. -->
    <div class="flex items-center gap-1">
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!canCopy}
        title={canCopy ? "Copy (Ctrl+C)" : "Copy — nothing selected"}
        onclick={() => {
          if (canCopy) copy();
        }}><Copy size={16} /></button
      >
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!hasSelection || !!liftBlock}
        title={!hasSelection
          ? `Cut — ${whyNoMarquee}`
          : liftBlock
            ? `Cut — ${liftBlock}`
            : "Cut (Ctrl+X)"}
        onclick={() => {
          if (hasSelection && !liftBlock) cut();
        }}><Scissors size={16} /></button
      >
      <button class="{iconBtn} {iconIdle}" title={pasteTitle} onclick={paste}
        ><ClipboardPaste size={16} /></button
      >
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!hasSelection || !!liftBlock}
        title={!hasSelection
          ? `Delete — ${whyNoMarquee}`
          : liftBlock
            ? `Delete — ${liftBlock}`
            : "Delete selection (Del)"}
        onclick={() => {
          if (hasSelection && !liftBlock) deleteSelection();
        }}><Trash2 size={16} /></button
      >
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!hasSelection}
        title={hasSelection ? "Deselect (Esc)" : "Deselect — nothing selected"}
        onclick={() => {
          if (hasSelection) deselect();
        }}><SquareX size={16} /></button
      >
      <button class="{iconBtn} {iconIdle}" title="Select all" onclick={selectAll}
        ><Scan size={16} /></button
      >
    </div>
    <div class="h-6 w-px bg-border"></div>
    <div class="flex items-center gap-1">
      <button
        class="{iconBtn} {selectionMode === 'transforming' ? 'ui-on' : iconIdle} {dimmable}"
        aria-pressed={selectionMode === "transforming"}
        aria-disabled={!!liftWhy || selectionMode === "warping"}
        title={liftWhy
          ? `Free transform — ${liftWhy}`
          : selectionMode === "warping"
            ? "Free transform — apply or cancel the warp first"
            : "Free transform — scale/rotate handles"}
        onclick={() => {
          if (!liftWhy && selectionMode === "selected") transform();
        }}><Move size={16} /></button
      >
      <button
        class="{iconBtn} {distortOn ? 'ui-on' : iconIdle} {dimmable}"
        aria-pressed={distortOn}
        aria-disabled={!!liftWhy}
        title={liftWhy ? `Distort — ${liftWhy}` : "Distort (W) — 4-corner warp"}
        onclick={() => {
          if (!liftWhy) distort();
        }}><SquareDashed size={16} /></button
      >
      <button
        class="{iconBtn} {meshOn ? 'ui-on' : iconIdle} {dimmable}"
        aria-pressed={meshOn}
        aria-disabled={!!liftWhy}
        title={liftWhy ? `Mesh warp — ${liftWhy}` : "Mesh warp (M) — 3×3 grid"}
        onclick={() => {
          if (!liftWhy) mesh();
        }}><Grid3x3 size={16} /></button
      >
    </div>
    <div class="h-6 w-px bg-border"></div>
    <div class="flex items-center gap-1">
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!!flipWhy}
        title={flipWhy ? `Flip horizontal — ${flipWhy}` : "Flip horizontal"}
        onclick={() => {
          if (!flipWhy) flip("h");
        }}><FlipHorizontal2 size={16} /></button
      >
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!!flipWhy}
        title={flipWhy ? `Flip vertical — ${flipWhy}` : "Flip vertical"}
        onclick={() => {
          if (!flipWhy) flip("v");
        }}><FlipVertical2 size={16} /></button
      >
      <button
        class="{iconBtn} {app.keepProportions ? 'ui-on' : iconIdle}"
        aria-pressed={app.keepProportions}
        title={app.keepProportions
          ? "Corners keep proportions (Shift: free)"
          : "Corners scale freely (Shift: keep proportions)"}
        onclick={toggleKeepProportions}
        >{#if app.keepProportions}<Link2 size={16} />{:else}<Link2Off size={16} />{/if}</button
      >
    </div>
    <div class="h-6 w-px bg-border"></div>
    <div class="flex items-center gap-1">
      <button
        class="{iconBtn} {floating ? 'ui-on' : iconIdle} {dimmable}"
        aria-disabled={!floating}
        title={floating ? "Apply (Enter)" : "Apply — nothing lifted yet"}
        onclick={() => {
          if (floating) applyFloat();
        }}><Check size={16} /></button
      >
      <button
        class="{iconBtn} {iconIdle} {dimmable}"
        aria-disabled={!floating}
        title={floating ? "Cancel (Esc)" : "Cancel — nothing lifted yet"}
        onclick={() => {
          if (floating) cancelFloat();
        }}><X size={16} /></button
      >
    </div>
  {/if}

  <!-- A marquee outlives the Select tool and silently limits where brush, eraser and fill paint:
       say so, one tap from clearing it. Amber = "why this won't behave as you expect". -->
  {#if hasSelection && activeTool !== "select" && activeTool !== "lasso"}
    <div class="flex items-center">
      <button
        class="flex h-7 items-center gap-1 rounded-md border border-warn/50 bg-surface-raised px-2 text-xs whitespace-nowrap text-warn transition-colors hover:bg-surface-hover"
        title="A selection limits where this tool paints — tap to deselect"
        onclick={deselect}><SquareX size={14} />Deselect</button
      >
    </div>
  {/if}
</div>
