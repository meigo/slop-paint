<script lang="ts">
  import { app } from "../appState.svelte.js";

  let {
    open = false,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    onConfirm: (width: number, height: number, anchorX: number, anchorY: number) => void;
    onCancel: () => void;
  } = $props();

  let width = $state(app.docWidth);
  let height = $state(app.docHeight);
  let anchorX = $state(0.5);
  let anchorY = $state(0.5);

  // Reset values when dialog opens
  $effect(() => {
    if (open) {
      width = app.docWidth;
      height = app.docHeight;
      anchorX = 0.5;
      anchorY = 0.5;
    }
  });

  const anchors: { x: number; y: number }[] = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 0.5 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 0.5 },
    { x: 0, y: 1 },
    { x: 0.5, y: 1 },
    { x: 1, y: 1 },
  ];

  function confirm() {
    const w = Math.max(1, Math.min(8192, Math.round(width)));
    const h = Math.max(1, Math.min(8192, Math.round(height)));
    onConfirm(w, h, anchorX, anchorY);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      confirm();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    onkeydown={handleKeydown}
    onpointerdown={(e: PointerEvent) => {
      if (e.target === e.currentTarget) onCancel();
    }}
  >
    <div class="flex w-80 flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-xl">
      <h2 class="text-sm font-semibold text-text">Resize Canvas</h2>

      <div class="flex flex-col gap-2">
        <span class="text-[11px] text-text-muted">Current: {app.docWidth} x {app.docHeight}</span>
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          Width
          <input
            type="number"
            min="1"
            max="8192"
            bind:value={width}
            class="h-7 flex-1 rounded border border-border bg-surface px-2 text-xs text-text"
            onkeydown={(e: KeyboardEvent) => e.stopPropagation()}
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
            class="h-7 flex-1 rounded border border-border bg-surface px-2 text-xs text-text"
            onkeydown={(e: KeyboardEvent) => e.stopPropagation()}
          />
          <span class="text-text-muted">px</span>
        </label>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-[11px] text-text-muted">Anchor</span>
        <div class="grid w-16 grid-cols-3 gap-1">
          {#each anchors as a}
            <button
              aria-label="Anchor {a.x},{a.y}"
              class="h-4 w-4 rounded-sm border transition-colors
                     {anchorX === a.x && anchorY === a.y
                ? 'border-accent bg-accent'
                : 'border-border bg-surface-hover hover:border-text-muted'}"
              onclick={() => {
                anchorX = a.x;
                anchorY = a.y;
              }}
            ></button>
          {/each}
        </div>
      </div>

      <p class="text-[11px] text-text-muted">This will clear undo history.</p>

      <div class="flex justify-end gap-2 pt-1">
        <button
          class="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover"
          onclick={onCancel}>Cancel</button
        >
        <button
          class="rounded bg-accent px-3 py-1.5 text-xs text-accent-text hover:opacity-90"
          onclick={confirm}>Resize</button
        >
      </div>
    </div>
  </div>
{/if}
