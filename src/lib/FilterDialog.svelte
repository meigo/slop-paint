<script lang="ts">
  // Filter ▸ Levels / Hue/Saturation / Threshold / Halftone. Every change is previewed in the layer
  // at once (App re-runs the filter from its snapshot, once a frame); OK keeps it as one undo step,
  // Cancel puts back what was there. As the text dialog: no dim, no cancel on an outside tap, and
  // no full-screen layer (App makes the rest `inert`).
  import { untrack } from "svelte";
  import { FILTER_TITLES, type FilterSpec, type Paper } from "../filters";
  import { isConfirmEnter } from "./dialog-keys";
  import { sliderFill } from "./slider-fill";

  let {
    open = false,
    initial,
    histogram,
    onChange,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    initial: FilterSpec;
    /** Levels only: the layer's luma histogram (painted pixels, by alpha). */
    histogram: Float64Array | null;
    onChange: (spec: FilterSpec) => void;
    onConfirm: (spec: FilterSpec) => void;
    onCancel: () => void;
  } = $props();

  let spec = $state<FilterSpec>({
    kind: "levels",
    inBlack: 0,
    inWhite: 255,
    gamma: 1,
    outBlack: 0,
    outWhite: 255,
  });

  // Reset when the dialog opens, and show the starting values at once (a halftone changes the
  // layer even before anything is touched).
  $effect(() => {
    if (open) {
      spec = untrack(() => ({ ...initial }));
      untrack(() => onChange({ ...spec }));
    }
  });

  function update(patch: Partial<FilterSpec>) {
    spec = { ...spec, ...patch } as FilterSpec;
    onChange({ ...spec });
  }

  function onWindowKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (isConfirmEnter(e)) {
      e.preventDefault();
      e.stopPropagation();
      onConfirm({ ...spec });
    }
  }

  // Midtones as Photoshop's gamma (0.1–10), on a slider that is even either side of 1.
  const gammaToSlider = (g: number) => Math.round(Math.log10(g) * 100);
  const sliderToGamma = (s: number) => Math.round(Math.pow(10, s / 100) * 100) / 100;

  // The histogram, scaled to its tallest bar (a logarithm, so a few dominant values — the white
  // of a Background — don't flatten the rest).
  let histEl = $state<HTMLCanvasElement>();
  $effect(() => {
    const el = histEl,
      h = histogram;
    if (!el || !h) return;
    const ctx = el.getContext("2d")!;
    const W = el.width,
      H = el.height;
    ctx.clearRect(0, 0, W, H);
    let max = 0;
    for (const v of h) max = Math.max(max, Math.log1p(v));
    if (!max) return;
    ctx.fillStyle = "#a1a1aa";
    for (let i = 0; i < 256; i++) {
      const bar = (Math.log1p(h[i]) / max) * H;
      ctx.fillRect((i / 256) * W, H - bar, W / 256 + 0.5, bar);
    }
  });

  const papers: { value: Paper; label: string; title: string }[] = [
    {
      value: "transparent",
      label: "Transparent",
      title: "What isn't ink becomes transparent — for a layer over others",
    },
    {
      value: "white",
      label: "White",
      title:
        "What isn't ink becomes white, inside the layer's own coverage — for a Background or a scan",
    },
  ];

  const row = "flex items-center gap-2 text-xs text-text-secondary";
  const seg = (on: boolean) =>
    `h-7 cursor-pointer rounded-md px-2 text-xs ${on ? "ui-on" : "text-text-secondary hover:bg-surface-hover"}`;
</script>

<svelte:window onkeydown={onWindowKey} />

{#snippet slider(
  label: string,
  title: string,
  value: number,
  min: number,
  max: number,
  shown: string,
  set: (v: number) => void,
)}
  <label class={row} {title}>
    <span class="w-20 shrink-0">{label}</span>
    <input
      type="range"
      class="min-w-0 flex-1"
      {min}
      {max}
      step="1"
      style={sliderFill(value, min, max)}
      {value}
      oninput={(e) => set(Number(e.currentTarget.value))}
    />
    <span class="w-10 text-right tabular-nums">{shown}</span>
  </label>
{/snippet}

{#snippet choice<T extends string>(
  label: string,
  items: { value: T; label: string; title: string }[],
  current: T,
  set: (v: T) => void,
)}
  <div class={row}>
    <span class="w-20 shrink-0">{label}</span>
    <div class="flex gap-1">
      {#each items as it (it.value)}
        <button
          class={seg(current === it.value)}
          title={it.title}
          aria-pressed={current === it.value}
          onclick={() => set(it.value)}>{it.label}</button
        >
      {/each}
    </div>
  </div>
{/snippet}

{#if open}
  <div
    class="fixed top-24 left-4 z-50 flex max-h-[calc(100dvh-7rem)] w-80 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-xl"
    role="dialog"
    aria-label={FILTER_TITLES[spec.kind]}
  >
    <h2 class="text-sm font-semibold text-text">{FILTER_TITLES[spec.kind]}</h2>

    {#if spec.kind === "levels"}
      {@const s = spec}
      <canvas
        bind:this={histEl}
        width="288"
        height="64"
        class="h-16 w-full rounded-md border border-border bg-surface-raised"
        title="How much of the layer is at each brightness, dark to light"
      ></canvas>
      {@render slider(
        "Black",
        "Input black point: this and darker become the output black",
        s.inBlack,
        0,
        253,
        String(s.inBlack),
        (v) => update({ inBlack: v, inWhite: Math.max(s.inWhite, v + 2) }),
      )}
      {@render slider(
        "Midtones",
        "Gamma: above 1 lightens the middle tones, below 1 darkens them",
        gammaToSlider(s.gamma),
        -100,
        100,
        s.gamma.toFixed(2),
        (v) => update({ gamma: sliderToGamma(v) }),
      )}
      {@render slider(
        "White",
        "Input white point: this and lighter become the output white",
        s.inWhite,
        2,
        255,
        String(s.inWhite),
        (v) => update({ inWhite: v, inBlack: Math.min(s.inBlack, v - 2) }),
      )}
      <div class="h-px bg-border"></div>
      {@render slider(
        "Output black",
        "The darkest the result gets",
        s.outBlack,
        0,
        255,
        String(s.outBlack),
        (v) => update({ outBlack: v }),
      )}
      {@render slider(
        "Output white",
        "The lightest the result gets (below Output black inverts)",
        s.outWhite,
        0,
        255,
        String(s.outWhite),
        (v) => update({ outWhite: v }),
      )}
    {:else if spec.kind === "hueSat"}
      {@const s = spec}
      {@render slider(
        "Hue",
        "Turn every colour round the colour wheel",
        s.hue,
        -180,
        180,
        `${s.hue}°`,
        (v) => update({ hue: v }),
      )}
      {@render slider(
        "Saturation",
        "−100 is grey, +100 as vivid as it goes",
        s.saturation,
        -100,
        100,
        String(s.saturation),
        (v) => update({ saturation: v }),
      )}
      {@render slider(
        "Lightness",
        "−100 is black, +100 white",
        s.lightness,
        -100,
        100,
        String(s.lightness),
        (v) => update({ lightness: v }),
      )}
    {:else if spec.kind === "threshold"}
      {@const s = spec}
      {@render slider(
        "Level",
        "Darker than this (as it looks on white) becomes solid black",
        s.level,
        1,
        255,
        String(s.level),
        (v) => update({ level: v }),
      )}
      {@render choice("Paper", papers, s.paper, (v) => update({ paper: v }))}
    {:else if spec.kind === "halftone"}
      {@const s = spec}
      {@render slider(
        "Cell",
        "The screen's spacing, in document pixels: one dot or line per cell",
        s.cell,
        3,
        48,
        `${s.cell} px`,
        (v) => update({ cell: v }),
      )}
      {@render slider(
        "Angle",
        "The screen's angle (45° is the classic screentone)",
        s.angle,
        0,
        90,
        `${s.angle}°`,
        (v) => update({ angle: v }),
      )}
      {@render choice(
        "Shape",
        [
          { value: "dots", label: "Dots", title: "Round dots that grow with the tone" },
          { value: "lines", label: "Lines", title: "Parallel lines that thicken with the tone" },
        ],
        s.shape,
        (v) => update({ shape: v }),
      )}
      {@render choice(
        "Ink",
        [
          { value: "black", label: "Black", title: "Black dots" },
          {
            value: "colour",
            label: "Layer's colour",
            title: "Dots in the colour underneath them (how many still follows how dark it is)",
          },
        ],
        s.ink,
        (v) => update({ ink: v }),
      )}
      {@render choice("Paper", papers, s.paper, (v) => update({ paper: v }))}
      <p class="text-[11px] text-text-muted">
        Darker parts get bigger dots. The screen lines up across layers.
      </p>
    {/if}

    <div class="flex justify-end gap-2 pt-1">
      <button
        class="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover"
        title="Put back what was there (Esc)"
        onclick={onCancel}>Cancel</button
      >
      <button
        class="rounded bg-accent px-3 py-1.5 text-xs text-accent-text hover:opacity-90"
        title="Apply to the layer — one undo step (Enter)"
        onclick={() => onConfirm({ ...spec })}>OK</button
      >
    </div>
  </div>
{/if}
