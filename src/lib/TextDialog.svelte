<script lang="ts">
  // Add / edit a text reference. Every change is previewed on the canvas at once (App re-renders
  // the layer); OK keeps it as one undo step, Cancel puts back what was there.
  import { untrack } from "svelte";
  import { Plus, TextAlignCenter, TextAlignEnd, TextAlignStart } from "@lucide/svelte";
  import { FONT_FILE_ACCEPT, type FontSource } from "../text-fonts";
  import {
    DEFAULT_TEXT_SPEC,
    bundledFont,
    fontKey,
    fontLabel,
    LINE_HEIGHT_MAX,
    LINE_HEIGHT_MIN,
    TEXT_FONTS,
    TEXT_SIZE_MAX,
    TEXT_SIZE_MIN,
    type TextAlign,
    type TextSpec,
  } from "../text-layout";

  let {
    open = false,
    adding,
    initial,
    onChange,
    onConfirm,
    onCancel,
    fonts,
    checkFont,
    onAddFont,
  }: {
    open: boolean;
    /** A new layer (the button reads "Add") or an edit of an existing one ("OK"). */
    adding: boolean;
    initial: TextSpec;
    onChange: (spec: TextSpec) => void;
    onConfirm: (spec: TextSpec) => void;
    onCancel: () => void;
    /** The user's font library (App keeps it current). */
    fonts: { font: string; weight: number; italic: boolean }[];
    /** Where the chosen font comes from on this device. */
    checkFont: (spec: TextSpec) => Promise<FontSource>;
    /** Import a font file; the face to switch to, or null (App reports why). */
    onAddFont: (file: File) => Promise<{ font: string; weight: number; italic: boolean } | null>;
  } = $props();

  let spec = $state<TextSpec>({ ...DEFAULT_TEXT_SPEC });
  let textareaEl = $state<HTMLTextAreaElement>();

  // Reset when the dialog opens (only then — not when `initial` changes), and put the caret in
  // the text (on iPad this brings the keyboard).
  $effect(() => {
    if (open) {
      spec = untrack(() => ({ ...initial }));
      queueMicrotask(() => textareaEl?.focus());
    }
  });

  function update(patch: Partial<TextSpec>) {
    spec = { ...spec, ...patch };
    onChange({ ...spec });
  }

  type Face = { font: string; weight: number; italic: boolean };
  const builtIn: Face[] = TEXT_FONTS.map((f) => ({ font: f.id, weight: 400, italic: false }));

  // Where the chosen font comes from here — a missing one is drawn in the default until it's added.
  let source = $state<FontSource>("bundled");
  let sourceSeq = 0;
  $effect(() => {
    if (!open) return;
    const face = { font: spec.font, weight: spec.weight, italic: spec.italic };
    const n = ++sourceSeq;
    void checkFont({ ...untrack(() => spec), ...face }).then((s) => {
      if (n === sourceSeq) source = s;
    });
  });
  // The chosen face isn't among the lists (an opened file's installed or missing font): it gets an
  // entry of its own, so the dropdown can show it.
  const current = $derived(fontKey(spec));
  const listed = $derived([...builtIn, ...fonts].some((f) => fontKey(f) === current));

  function pickFont(key: string) {
    const f = [...builtIn, ...fonts].find((x) => fontKey(x) === key);
    if (f) update({ font: f.font, weight: f.weight, italic: f.italic });
  }

  let fontInputEl = $state<HTMLInputElement>();
  let addingFont = $state(false);
  async function addFont() {
    const file = fontInputEl?.files?.[0];
    if (fontInputEl) fontInputEl.value = "";
    if (!file) return;
    addingFont = true;
    const face = await onAddFont(file);
    addingFont = false;
    if (face) update(face);
  }

  const clamp = (v: number, lo: number, hi: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

  const aligns: { value: TextAlign; title: string; icon: typeof TextAlignStart }[] = [
    { value: "left", title: "Align left", icon: TextAlignStart },
    { value: "center", title: "Align centre", icon: TextAlignCenter },
    { value: "right", title: "Align right", icon: TextAlignEnd },
  ];

  function onWindowKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Enter") {
      // Enter in the text is a new line; Ctrl/Cmd+Enter (or Enter anywhere else) confirms.
      const inText = e.target instanceof HTMLTextAreaElement;
      if (inText && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      onConfirm({ ...spec });
    }
  }

  const field =
    "h-7 rounded-md border border-border bg-surface-raised px-2 text-xs text-text focus:border-accent";
</script>

<svelte:window onkeydown={onWindowKey} />

{#if open}
  <!-- No dim and no cancel on an outside tap: the canvas behind is the preview, and a stray tap
       mustn't throw away what was typed. The layer stays modal until OK or Cancel. -->
  <div class="fixed inset-0 z-50 flex items-start justify-start p-4 pt-24">
    <div
      class="flex w-80 flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xl"
      role="dialog"
      aria-label={adding ? "Add text" : "Edit text"}
    >
      <h2 class="text-sm font-semibold text-text">{adding ? "Add text" : "Edit text"}</h2>

      <textarea
        bind:this={textareaEl}
        class="min-h-24 resize-y rounded-md border border-border bg-surface-raised p-2 text-sm text-text focus:border-accent"
        title="The text — a new line where you want the line to break"
        placeholder="Type, or leave empty for ruled lines"
        value={spec.text}
        oninput={(e) => update({ text: e.currentTarget.value })}
        onkeydown={(e) => {
          if (e.key !== "Escape" && e.key !== "Enter") e.stopPropagation();
        }}></textarea>

      <div class="flex items-center gap-2 text-xs text-text-secondary">
        <span class="w-16">Font</span>
        <select
          class="{field} min-w-0 flex-1"
          title="Font"
          value={current}
          onchange={(e) => pickFont(e.currentTarget.value)}
        >
          <optgroup label="Built in">
            {#each builtIn as f (fontKey(f))}
              <option value={fontKey(f)}>{fontLabel(f)}</option>
            {/each}
          </optgroup>
          {#if fonts.length}
            <optgroup label="Your fonts">
              {#each fonts as f (fontKey(f))}
                <option value={fontKey(f)}>{fontLabel(f)}</option>
              {/each}
            </optgroup>
          {/if}
          {#if !listed}
            <option value={current}
              >{fontLabel(spec)}{source === "installed"
                ? " (installed)"
                : source === "missing"
                  ? " — not on this device"
                  : ""}</option
            >
          {/if}
        </select>
        <!-- A button, not an entry in the list: iPad opens a file picker only from a direct tap. -->
        <button
          class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-surface-raised text-text-secondary hover:bg-surface-hover aria-disabled:opacity-40"
          title="Add a font file (TTF, OTF, WOFF or WOFF2) — kept on this device for every document"
          aria-disabled={addingFont}
          onclick={(e) => {
            e.preventDefault();
            if (!addingFont) fontInputEl?.click();
          }}><Plus size={14} /></button
        >
        <input
          bind:this={fontInputEl}
          type="file"
          class="hidden"
          accept={FONT_FILE_ACCEPT}
          onchange={addFont}
        />
      </div>
      {#if source === "missing" && !bundledFont(spec.font)}
        <p class="-mt-1 text-[11px] text-warn">
          {fontLabel(spec)} isn't on this device: the layer shows its saved picture, and changes are drawn
          in {fontLabel(DEFAULT_TEXT_SPEC)}. Add the font file with + to use it here — the layer
          keeps asking for it by name.
        </p>
      {:else if source === "installed"}
        <p class="-mt-1 text-[11px] text-text-muted">
          Installed on this computer — another device needs it installed too, or added with +.
        </p>
      {/if}

      <div class="flex items-center gap-2 text-xs text-text-secondary">
        <label class="flex items-center gap-2" title="Font size, in document pixels">
          <span class="w-16">Size</span>
          <input
            type="number"
            class="{field} w-16"
            min={TEXT_SIZE_MIN}
            max={TEXT_SIZE_MAX}
            value={spec.size}
            onchange={(e) =>
              update({ size: clamp(Number(e.currentTarget.value), TEXT_SIZE_MIN, TEXT_SIZE_MAX) })}
          />
        </label>
        <label class="flex items-center gap-2" title="Line spacing, as a multiple of the font size">
          Lines
          <input
            type="number"
            class="{field} w-16"
            min={LINE_HEIGHT_MIN}
            max={LINE_HEIGHT_MAX}
            step="0.1"
            value={spec.lineHeight}
            onchange={(e) =>
              update({
                lineHeight: clamp(Number(e.currentTarget.value), LINE_HEIGHT_MIN, LINE_HEIGHT_MAX),
              })}
          />
        </label>
      </div>

      <div class="flex items-center gap-2 text-xs text-text-secondary">
        <span class="w-16">Align</span>
        <div class="flex gap-1">
          {#each aligns as a (a.value)}
            <button
              class="flex size-7 cursor-pointer items-center justify-center rounded-md {spec.align ===
              a.value
                ? 'ui-on'
                : 'text-text-secondary hover:bg-surface-hover'}"
              title={a.title}
              aria-pressed={spec.align === a.value}
              onclick={() => update({ align: a.value })}><a.icon size={14} /></button
            >
          {/each}
        </div>
        <label class="ml-auto flex items-center gap-2" title="Text colour">
          Colour
          <input
            type="color"
            class="h-7 w-9 cursor-pointer rounded-md border border-border bg-surface-raised"
            value={spec.color}
            oninput={(e) => update({ color: e.currentTarget.value })}
          />
        </label>
      </div>

      <label
        class="flex cursor-pointer items-start gap-2 text-xs text-text-secondary"
        title="Cap height, x-height and baseline rules under each line, to letter on"
      >
        <input
          type="checkbox"
          class="mt-0.5 accent-accent"
          checked={spec.guides}
          onchange={(e) => update({ guides: e.currentTarget.checked })}
        />
        <span>
          <span class="text-text">Guide lines</span><br />
          Cap height, x-height (dashed) and baseline for each line
        </span>
      </label>

      <div class="flex justify-end gap-2 pt-1">
        <button
          class="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover"
          title="Put back what was there"
          onclick={onCancel}>Cancel</button
        >
        <button
          class="rounded bg-accent px-3 py-1.5 text-xs text-accent-text hover:opacity-90"
          title={adding ? "Add the text layer (Ctrl+Enter)" : "Keep the changes (Ctrl+Enter)"}
          onclick={() => onConfirm({ ...spec })}>{adding ? "Add" : "OK"}</button
        >
      </div>
    </div>
  </div>
{/if}
