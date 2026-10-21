<script lang="ts">
  // Add / edit a text reference. Every change is previewed on the canvas at once (App re-renders
  // the layer); OK keeps it as one undo step, Cancel puts back what was there.
  import { untrack } from "svelte";
  import { Dices, Plus, TextAlignCenter, TextAlignEnd, TextAlignStart } from "@lucide/svelte";
  import { FONT_FILE_ACCEPT, type FontSource } from "../text-fonts";
  import {
    DEFAULT_TEXT_SPEC,
    bundledFont,
    fontKey,
    fontLabel,
    LINE_HEIGHT_MAX,
    LINE_HEIGHT_MIN,
    SPACING_MAX,
    SPACING_MIN,
    TEXT_FONTS,
    TEXT_SIZE_MAX,
    TEXT_SIZE_MIN,
    type TextAlign,
    type TextSpec,
  } from "../text-layout";
  import { JITTER_MAX, hasJitter, newSeed, type JitterAmounts } from "../text-jitter";
  import { isConfirmEnter } from "./dialog-keys";
  import NumberField from "./NumberField.svelte";
  import { sliderFill } from "./slider-fill";

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

  const aligns: { value: TextAlign; title: string; icon: typeof TextAlignStart }[] = [
    { value: "left", title: "Align left", icon: TextAlignStart },
    { value: "center", title: "Align centre", icon: TextAlignCenter },
    { value: "right", title: "Align right", icon: TextAlignEnd },
  ];

  // Randomise. Scale and baseline are stored as fractions and shown as percentages.
  const jitters: { key: keyof JitterAmounts; label: string; unit: string; title: string }[] = [
    {
      key: "rotate",
      label: "Rotation",
      unit: "°",
      title: "How far each letter may turn, either way",
    },
    { key: "scale", label: "Scale", unit: "%", title: "How much each letter may grow or shrink" },
    {
      key: "offset",
      label: "Baseline",
      unit: "%",
      title: "How far each letter may sit above or below the line, as a share of the size",
    },
    { key: "skew", label: "Skew", unit: "°", title: "How far each letter may lean, either way" },
  ];
  const percent = (k: keyof JitterAmounts) => k === "scale" || k === "offset";
  const jitterShown = (k: keyof JitterAmounts) =>
    percent(k) ? Math.round(spec.jitter[k] * 100) : spec.jitter[k];
  const jitterMax = (k: keyof JitterAmounts) => (percent(k) ? JITTER_MAX[k] * 100 : JITTER_MAX[k]);
  function setJitter(k: keyof JitterAmounts, shown: number) {
    update({ jitter: { ...spec.jitter, [k]: percent(k) ? shown / 100 : shown } });
  }
  const jittered = $derived(hasJitter(spec.jitter));

  function onWindowKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Enter") {
      // Enter in the text is a new line; Ctrl/Cmd+Enter (or Enter anywhere else but a focused
      // button, which presses itself) confirms.
      if (!isConfirmEnter(e)) return;
      const inText = e.target instanceof HTMLTextAreaElement;
      if (inText && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      // A typed Size or Lines is already in `spec`: the field commits on its own Enter keydown,
      // which reaches it before this window listener (a typed size was once confirmed as the old
      // one).
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
      class="flex max-h-[calc(100dvh-7rem)] w-80 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-xl"
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
        <label class="flex items-center gap-2">
          <span class="w-16">Size</span>
          <NumberField
            class="w-16"
            title="Font size, in document pixels"
            value={spec.size}
            min={TEXT_SIZE_MIN}
            max={TEXT_SIZE_MAX}
            onchange={(v) => update({ size: v })}
          />
        </label>
        <label class="flex items-center gap-2">
          Lines
          <NumberField
            class="w-16"
            title="Line spacing, as a multiple of the font size"
            value={spec.lineHeight}
            min={LINE_HEIGHT_MIN}
            max={LINE_HEIGHT_MAX}
            step={0.1}
            onchange={(v) => update({ lineHeight: v })}
          />
        </label>
      </div>

      <label
        class="flex items-center gap-2 text-xs text-text-secondary"
        title="Letter spacing: extra room between letters, as a share of the size (below 0 tightens)"
      >
        <span class="w-16">Spacing</span>
        <input
          type="range"
          class="min-w-0 flex-1"
          min={SPACING_MIN * 100}
          max={SPACING_MAX * 100}
          step="1"
          style={sliderFill(Math.round(spec.spacing * 100), SPACING_MIN * 100, SPACING_MAX * 100)}
          value={Math.round(spec.spacing * 100)}
          oninput={(e) => update({ spacing: Number(e.currentTarget.value) / 100 })}
        />
        <span class="w-10 text-right tabular-nums">{Math.round(spec.spacing * 100)}%</span>
      </label>

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

      <div class="flex flex-col gap-2 text-xs text-text-secondary">
        <div class="flex items-center gap-2">
          <span class="w-16 text-text">Randomise</span>
          <button
            class="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2 text-text-secondary hover:bg-surface-hover aria-disabled:opacity-40"
            title={jittered
              ? "Re-roll: a new random pick for every letter"
              : "Set an amount below first — at 0 nothing is randomised"}
            aria-disabled={!jittered}
            onclick={() => jittered && update({ seed: newSeed() })}
            ><Dices size={14} /> Re-roll</button
          >
        </div>
        {#each jitters as j (j.key)}
          <label class="flex items-center gap-2" title={j.title}>
            <span class="w-16">{j.label}</span>
            <input
              type="range"
              class="min-w-0 flex-1"
              min="0"
              max={jitterMax(j.key)}
              step="1"
              style={sliderFill(jitterShown(j.key), 0, jitterMax(j.key))}
              value={jitterShown(j.key)}
              oninput={(e) => setJitter(j.key, Number(e.currentTarget.value))}
            />
            <span class="w-10 text-right tabular-nums">±{jitterShown(j.key)}{j.unit}</span>
          </label>
        {/each}
      </div>

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
