<script lang="ts">
  // App preferences (saved with the other settings, not in the document). A home for more to come.
  import { Plus, Trash2 } from "@lucide/svelte";
  import { app } from "../appState.svelte.js";
  import { FONT_FILE_ACCEPT } from "../text-fonts";

  let {
    open = false,
    onChange,
    onLayerResolution,
    onClose,
    fonts,
    onAddFont,
    onRemoveFont,
  }: {
    open: boolean;
    /** Called after a setting changes, so the caller can persist it. */
    onChange: () => void;
    /** Sharp layers toggled: the caller resamples the document. */
    onLayerResolution: (hi: boolean) => void;
    onClose: () => void;
    /** The fonts added on this device (the text dialog's +), as listed there. */
    fonts: { key: string; label: string }[];
    onAddFont: (file: File) => void;
    onRemoveFont: (key: string) => void;
  } = $props();

  let fontInputEl = $state<HTMLInputElement>();

  function onWindowKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }
</script>

<!-- On the window, not the backdrop (it never has focus); guarded by `open` so a closed dialog
     doesn't swallow the app's shortcuts. -->
<svelte:window onkeydown={onWindowKey} />

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    onpointerdown={(e: PointerEvent) => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    <div class="flex w-80 flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-xl">
      <h2 class="text-sm font-semibold text-text">Settings</h2>

      <label
        class="flex cursor-pointer items-start gap-2 text-xs text-text-secondary"
        title="Show the Spine tag chips and tag menu in the layer strip"
      >
        <input
          type="checkbox"
          class="mt-0.5 accent-accent"
          checked={app.spineTools}
          onchange={(e) => {
            app.spineTools = e.currentTarget.checked;
            onChange();
          }}
        />
        <span>
          <span class="text-text">Spine tools</span><br />
          Tag chips and the tag menu in the layer strip, and Spine wording on the PSD export. Off only
          hides them: tags already on layers stay, and are still exported.
        </span>
      </label>

      <label
        class="flex cursor-pointer items-start gap-2 text-xs text-text-secondary"
        title="Keep layers at the screen's pixel density: sharper when zoomed in, 4× the memory"
      >
        <input
          type="checkbox"
          class="mt-0.5 accent-accent"
          checked={app.hiResLayers}
          onchange={(e) => onLayerResolution(e.currentTarget.checked)}
        />
        <span>
          <span class="text-text">Sharp layers ({window.devicePixelRatio || 1}×)</span><br />
          Layers at the screen's density: crisper when zoomed in, but 4× the memory — an iPad may blank
          a big document's layers in the background. Saves and exports are document pixels either way.
          Changing it clears undo.
        </span>
      </label>

      <!-- The font library is per device, like the other settings here, not part of a document. -->
      <div class="flex flex-col gap-1.5 text-xs text-text-secondary">
        <span class="text-text">Fonts on this device</span>
        {#if fonts.length}
          <ul class="flex max-h-40 flex-col overflow-y-auto">
            {#each fonts as f (f.key)}
              <li class="flex items-center gap-2 py-0.5">
                <span class="min-w-0 flex-1 truncate" title={f.label}>{f.label}</span>
                <button
                  class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text"
                  title="Remove {f.label} from this device — text layers using it keep their look"
                  onclick={() => onRemoveFont(f.key)}><Trash2 size={13} /></button
                >
              </li>
            {/each}
          </ul>
        {:else}
          <span class="text-text-muted">None yet — add one here or with + in the text dialog.</span>
        {/if}
        <div>
          <button
            class="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2 text-text-secondary hover:bg-surface-hover"
            title="Add a font file (TTF, OTF, WOFF or WOFF2) — kept on this device for every document"
            onclick={() => fontInputEl?.click()}><Plus size={13} /> Add font…</button
          >
          <input
            bind:this={fontInputEl}
            type="file"
            class="hidden"
            accept={FONT_FILE_ACCEPT}
            onchange={() => {
              const file = fontInputEl?.files?.[0];
              if (fontInputEl) fontInputEl.value = "";
              if (file) onAddFont(file);
            }}
          />
        </div>
        <span class="text-[11px] text-text-muted">
          A text layer whose font is removed keeps its look, and shows the font as missing until
          it's added again.
        </span>
      </div>

      <div class="flex justify-end pt-1">
        <button
          class="rounded bg-accent px-3 py-1.5 text-xs text-accent-text hover:opacity-90"
          onclick={onClose}>Done</button
        >
      </div>
    </div>
  </div>
{/if}
