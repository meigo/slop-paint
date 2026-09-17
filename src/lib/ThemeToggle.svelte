<script lang="ts">
  import { Sun, Moon } from "@lucide/svelte";
  import { app, toggleTheme } from "../appState.svelte.js";
</script>

<button
  class="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-text-secondary transition-colors hover:bg-surface-hover"
  onclick={toggleTheme}
  title={app.theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
>
  {#if app.theme === "light"}
    <Moon size={18} />
  {:else}
    <Sun size={18} />
  {/if}
</button>
