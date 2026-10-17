<script lang="ts">
  import { docSide, MAX_DOC_PX } from "../resize";
  import { isConfirmEnter } from "./dialog-keys";

  let {
    open = false,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    onConfirm: (width: number, height: number, name: string) => void;
    onCancel: () => void;
  } = $props();

  let name = $state("untitled");
  let width = $state(1920);
  let height = $state(1080);

  const presets = [
    { label: "1920 x 1080", w: 1920, h: 1080 },
    { label: "1280 x 720", w: 1280, h: 720 },
    { label: "2048 x 2048", w: 2048, h: 2048 },
    { label: "1024 x 1024", w: 1024, h: 1024 },
    { label: "512 x 512", w: 512, h: 512 },
    { label: "A4 (2480 x 3508)", w: 2480, h: 3508 },
    { label: "4K (3840 x 2160)", w: 3840, h: 2160 },
  ];

  function applyPreset(p: { w: number; h: number }) {
    width = p.w;
    height = p.h;
  }

  function swap() {
    const tmp = width;
    width = height;
    height = tmp;
  }

  // An empty, zero or too large side is refused with a reason, never clamped (see docSide).
  const w = $derived(docSide(width));
  const h = $derived(docSide(height));
  const sizeError = $derived(
    w === null || h === null ? `Width and height must be 1 to ${MAX_DOC_PX} px` : null,
  );

  function confirm() {
    if (w === null || h === null) return;
    onConfirm(w, h, name);
  }

  function onWindowKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Enter") {
      if (!isConfirmEnter(e)) return; // a focused button presses itself; IME input commits
      e.preventDefault();
      e.stopPropagation();
      confirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  }
</script>

<!-- On the window, not the backdrop: the backdrop never has focus, so its keydown never fired.
     Guarded by `open` so a closed dialog doesn't swallow the app's shortcuts. -->
<svelte:window onkeydown={onWindowKey} />

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    onpointerdown={(e: PointerEvent) => {
      if (e.target === e.currentTarget) onCancel();
    }}
  >
    <div class="flex w-80 flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-xl">
      <h2 class="text-sm font-semibold text-text">New Document</h2>

      <label
        class="flex items-center gap-2 text-xs text-text-secondary"
        title="Project name — used for the saved and exported file names"
      >
        Name
        <input
          type="text"
          bind:value={name}
          class="h-7 flex-1 rounded-md border border-border bg-surface-raised px-2 text-xs text-text"
        />
      </label>

      <div class="flex flex-col gap-2">
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          Width
          <input
            type="number"
            min="1"
            max="8192"
            bind:value={width}
            class="h-7 flex-1 rounded-md border border-border bg-surface-raised px-2 text-xs text-text"
            onkeydown={(e: KeyboardEvent) => {
              if (e.key !== "Enter" && e.key !== "Escape") e.stopPropagation();
            }}
          />
          <span class="text-text-muted">px</span>
        </label>
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          Height
          <input
            type="number"
            min="1"
            max="8192"
            bind:value={height}
            class="h-7 flex-1 rounded-md border border-border bg-surface-raised px-2 text-xs text-text"
            onkeydown={(e: KeyboardEvent) => {
              if (e.key !== "Enter" && e.key !== "Escape") e.stopPropagation();
            }}
          />
          <span class="text-text-muted">px</span>
        </label>
        <button
          class="self-start rounded px-1 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
          onclick={swap}>Swap W/H</button
        >
      </div>

      <div class="flex flex-col gap-1">
        <span class="text-[11px] text-text-muted">Presets</span>
        <div class="flex flex-wrap gap-1">
          {#each presets as preset}
            <button
              class="rounded border border-border px-2 py-1 text-[10px] text-text-secondary transition-colors hover:bg-surface-hover
                     {width === preset.w && height === preset.h ? 'ui-on' : 'bg-surface'}"
              onclick={() => applyPreset(preset)}>{preset.label}</button
            >
          {/each}
        </div>
      </div>

      {#if sizeError}<p class="text-[11px] text-warn">{sizeError}</p>{/if}
      <p class="text-[11px] text-warn">
        Replaces the current drawing, its undo history and the autosaved copy. Save first (File ▸
        Save) to keep it.
      </p>

      <div class="flex justify-end gap-2 pt-1">
        <button
          class="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover"
          onclick={onCancel}>Cancel</button
        >
        <button
          class="rounded bg-accent px-3 py-1.5 text-xs text-accent-text hover:opacity-90 aria-disabled:opacity-40"
          aria-disabled={sizeError !== null}
          title={sizeError ?? "Create the new document"}
          onclick={confirm}>Create</button
        >
      </div>
    </div>
  </div>
{/if}
