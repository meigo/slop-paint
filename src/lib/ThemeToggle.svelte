<script lang="ts">
  import { Sun, Moon } from "@lucide/svelte";
  import { app, toggleTheme } from "../appState.svelte.js";
</script>

<button
  class="w-9 h-9 rounded-md border border-border flex items-center justify-center bg-surface text-text-secondary hover:bg-surface-hover transition-colors"
  onclick={toggleTheme}
  title={app.theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
>
  {#if app.theme === "light"}
    <Moon size={18} />
  {:else}
    <Sun size={18} />
  {/if}
</button>
