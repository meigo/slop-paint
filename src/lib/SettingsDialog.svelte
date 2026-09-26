<script lang="ts">
  // App preferences (saved with the other settings, not in the document). A home for more to come.
  import { app } from "../appState.svelte.js";

  let {
    open = false,
    onChange,
    onClose,
  }: {
    open: boolean;
    /** Called after a setting changes, so the caller can persist it. */
    onChange: () => void;
    onClose: () => void;
  } = $props();

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

      <div class="flex justify-end pt-1">
        <button
          class="rounded bg-accent px-3 py-1.5 text-xs text-accent-text hover:opacity-90"
          onclick={onClose}>Done</button
        >
      </div>
    </div>
  </div>
{/if}
