<script lang="ts">
  import type { Snippet } from "svelte";
  import { clickOutside } from "./click-outside";

  // `children` receives a `close()` so menu items can dismiss the popover after acting.
  let { label, children }: { label: string; children: Snippet<[() => void]> } = $props();
  let open = $state(false);
  const close = () => (open = false);
</script>

<svelte:window
  onkeydown={(e) => {
    if (open && e.key === "Escape") close();
  }}
/>

<div class="relative shrink-0" use:clickOutside={close}>
  <button
    class="flex h-9 shrink-0 items-center gap-1 rounded-md px-2 text-sm text-text-secondary hover:bg-surface-hover"
    class:ui-on={open}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    {label}<span class="text-[10px] opacity-70">▾</span>
  </button>
  {#if open}
    <div
      class="absolute top-full right-0 z-30 mt-1 min-w-52 rounded-lg border border-border bg-surface py-1 shadow-lg"
      role="menu"
    >
      {@render children(close)}
    </div>
  {/if}
</div>
