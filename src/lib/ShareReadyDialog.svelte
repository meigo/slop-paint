<script lang="ts">
  import { shareFile } from "../share";
  import { downloadBlob } from "../download";
  import { flashStatus } from "../appState.svelte.js";

  let {
    file,
    onClose,
  }: {
    /** The finished file, or null when the dialog is closed. */
    file: File | null;
    onClose: () => void;
  } = $props();

  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // Held while the share sheet is up: a second tap would throw InvalidStateError ("already open").
  let sharing = $state(false);
  // The dialog stays open on anything but success, so you can retry or fall back to a download.
  let dismissed = $state(false);
  let error = $state("");

  function close() {
    if (sharing) return;
    dismissed = false;
    error = "";
    onClose();
  }

  async function share() {
    if (!file || sharing) return;
    sharing = true;
    dismissed = false;
    // THIS tap is the fresh activation the direct attempt lacked — share() before any await.
    const r = await shareFile(file);
    sharing = false;
    if (r.outcome === "shared") {
      // "shared" means the sheet completed, not that the file reached Files (AirDrop and Copy
      // complete it too), so don't claim it was saved.
      flashStatus(`Sent ${file.name} to the share sheet`);
      error = "";
      onClose();
    } else if (r.outcome === "dismissed") {
      dismissed = true;
      error = "";
    } else {
      error =
        r.outcome === "needs-tap"
          ? "The browser refused to open the share sheet."
          : errText(r.error);
    }
  }

  function download() {
    if (!file || sharing) return;
    downloadBlob(file, file.name);
    flashStatus(`Downloaded ${file.name}`);
    onClose();
  }
</script>

{#if file}
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
    onclick={close}
    role="presentation"
  >
    <div
      class="flex w-80 flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm text-text"
      onclick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <span class="font-semibold">{file.name} is ready</span>
      <button
        class="rounded border border-border py-1 hover:bg-surface-hover disabled:opacity-40"
        disabled={sharing}
        onclick={share}>Save to Files…</button
      >
      <button
        class="rounded border border-border py-1 hover:bg-surface-hover disabled:opacity-40"
        disabled={sharing}
        title="Download to the browser's Downloads, as before"
        onclick={download}>Download instead</button
      >
      <button
        class="rounded border border-border py-1 hover:bg-surface-hover disabled:opacity-40"
        disabled={sharing}
        onclick={close}>Cancel</button
      >
      {#if dismissed}
        <span class="text-xs text-text-secondary">Not saved — the share sheet was closed.</span>
      {/if}
      {#if error}
        <span class="text-xs text-text-secondary">Couldn't share: {error}</span>
      {/if}
      <span class="text-xs text-text-secondary">
        In the share sheet, choose “Save to Files” and pick a folder.
      </span>
    </div>
  </div>
{/if}
