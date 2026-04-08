<script lang="ts">
  let {
    open = false,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    onConfirm: (width: number, height: number) => void;
    onCancel: () => void;
  } = $props();

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

  function confirm() {
    const w = Math.max(1, Math.min(8192, Math.round(width)));
    const h = Math.max(1, Math.min(8192, Math.round(height)));
    onConfirm(w, h);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); confirm(); }
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    onkeydown={handleKeydown}
    onpointerdown={(e: PointerEvent) => { if (e.target === e.currentTarget) onCancel(); }}
  >
    <div class="bg-surface border border-border rounded-lg shadow-xl p-5 w-80 flex flex-col gap-4">
      <h2 class="text-sm font-semibold text-text">New Document</h2>

      <div class="flex flex-col gap-2">
        <label class="flex items-center gap-2 text-xs text-text-secondary">
          Width
          <input
            type="number"
            min="1"
            max="8192"
            bind:value={width}
            class="flex-1 h-7 px-2 text-xs bg-surface border border-border rounded text-text"
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
            class="flex-1 h-7 px-2 text-xs bg-surface border border-border rounded text-text"
            onkeydown={(e: KeyboardEvent) => e.stopPropagation()}
          />
          <span class="text-text-muted">px</span>
        </label>
        <button
          class="self-start text-[11px] text-text-muted hover:text-text px-1 py-0.5 rounded hover:bg-surface-hover"
          onclick={swap}
        >Swap W/H</button>
      </div>

      <div class="flex flex-col gap-1">
        <span class="text-[11px] text-text-muted">Presets</span>
        <div class="flex flex-wrap gap-1">
          {#each presets as preset}
            <button
              class="text-[10px] px-2 py-1 rounded border border-border text-text-secondary hover:bg-surface-hover transition-colors
                     {width === preset.w && height === preset.h ? 'bg-accent text-accent-text border-accent' : 'bg-surface'}"
              onclick={() => applyPreset(preset)}
            >{preset.label}</button>
          {/each}
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-1">
        <button
          class="px-3 py-1.5 text-xs rounded border border-border text-text-secondary hover:bg-surface-hover"
          onclick={onCancel}
        >Cancel</button>
        <button
          class="px-3 py-1.5 text-xs rounded bg-accent text-accent-text hover:opacity-90"
          onclick={confirm}
        >Create</button>
      </div>
    </div>
  </div>
{/if}
