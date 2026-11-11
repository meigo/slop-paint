<script lang="ts">
  // Filter ▸ every filter's settings. Every change is previewed in the layers
  // at once (App re-runs the filter from its snapshot, once a frame); OK keeps it as one undo step,
  // Cancel puts back what was there. As the text dialog: no dim, no cancel on an outside tap, and
  // no full-screen layer (App makes the rest `inert`).
  import { untrack } from "svelte";
  import {
    BLUR_MAX,
    FILTER_TITLES,
    SHADOW_BLUR_MAX,
    SHADOW_DISTANCE_MAX,
    SHARPEN_MAX,
    type FilterSpec,
    type Paper,
  } from "../filters";
  import { isConfirmEnter } from "./dialog-keys";
  import { sliderFill } from "./slider-fill";

  let {
    open = false,
    initial,
    histogram,
    scope = "",
    onChange,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    initial: FilterSpec;
    /** Levels only: the luma histogram of every layer it runs on (painted pixels, by alpha). */
    histogram: Float64Array | null;
    /** Which layers it runs on, when not just the active one ("5 layers (left out: 1 locked)"). */
    scope?: string;
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

  // Blur radius on a slider that is even in ratio (0.2 … BLUR_MAX): a small blur needs tenths, a
  // big one doesn't.
  const BLUR_MIN = 0.2;
  const radiusToSlider = (r: number) =>
    Math.round((Math.log(r / BLUR_MIN) / Math.log(BLUR_MAX / BLUR_MIN)) * 100);
  const sliderToRadius = (v: number) => {
    const r = BLUR_MIN * Math.pow(BLUR_MAX / BLUR_MIN, v / 100);
    return r < 10 ? Math.round(r * 10) / 10 : Math.round(r);
  };

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

  const edges: { value: "smooth" | "hard"; label: string; title: string }[] = [
    {
      value: "smooth",
      label: "Smooth",
      title: "Antialiased: a pixel the cut runs through gets a share of each side",
    },
    {
      value: "hard",
      label: "Hard",
      title: "Every pixel takes one side — jagged, but only the exact colours (pixel art)",
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

{#snippet colour(
  label: string,
  title: string,
  value: string,
  set: (v: string) => void,
  presets: { value: string; label: string }[] = [],
)}
  <div class={row} {title}>
    <span class="w-20 shrink-0">{label}</span>
    <input
      type="color"
      class="h-7 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-surface-raised p-0.5"
      aria-label={label}
      {value}
      oninput={(e) => set(e.currentTarget.value)}
    />
    {#each presets as p (p.value)}
      <button class={seg(value.toLowerCase() === p.value)} onclick={() => set(p.value)}
        >{p.label}</button
      >
    {/each}
    <span class="ml-auto text-text-muted tabular-nums">{value}</span>
  </div>
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
    <div>
      <h2 class="text-sm font-semibold text-text">{FILTER_TITLES[spec.kind]}</h2>
      {#if scope}
        <p class="mt-0.5 text-[11px] text-text-muted">On {scope}</p>
      {/if}
    </div>

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
        "Turn every colour round the colour wheel, each as light as it was",
        s.hue,
        -180,
        180,
        `${s.hue}°`,
        (v) => update({ hue: v }),
      )}
      {@render slider(
        "Saturation",
        "−100 is grey (as light as the colour looks), +100 as vivid as the screen can show",
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
    {:else if spec.kind === "posterize"}
      {@const s = spec}
      {@render slider(
        "Colours",
        "How many colours the layer keeps — picked from its own paint",
        s.colours,
        2,
        32,
        String(s.colours),
        (v) => update({ colours: v }),
      )}
      {@render slider(
        "Alpha",
        "Steps of transparency, picked from the layer's own (one of them fully transparent) — Off keeps it as it is",
        Math.max(1, s.alphaSteps),
        1,
        32,
        s.alphaSteps >= 2 ? String(s.alphaSteps) : "Off",
        (v) => update({ alphaSteps: v < 2 ? 0 : v }),
      )}
      {@render choice("Edges", edges, s.smooth ? "smooth" : "hard", (v) =>
        update({ smooth: v === "smooth" }),
      )}
    {:else if spec.kind === "blur"}
      {@const s = spec}
      {@render slider(
        "Radius",
        "How far the blur spreads, in document pixels (the Gaussian's σ)",
        radiusToSlider(s.radius),
        0,
        100,
        `${s.radius} px`,
        (v) => update({ radius: sliderToRadius(v) }),
      )}
      <p class="text-[11px] text-text-muted">
        Spreads into transparent parts too. With a selection, only inside it changes.
      </p>
    {:else if spec.kind === "colourToAlpha"}
      {@const s = spec}
      {@render colour(
        "Colour",
        "The colour to make transparent; mixes of it become see-through",
        s.colour,
        (v) => update({ colour: v }),
        [
          { value: "#ffffff", label: "White" },
          { value: "#000000", label: "Black" },
        ],
      )}
      <p class="text-[11px] text-text-muted">
        Grey on white becomes see-through black, so a scanned sketch keeps its soft lines.
        Alpha-locked layers are left out.
      </p>
    {:else if spec.kind === "sharpen"}
      {@const s = spec}
      {@render slider(
        "Amount",
        "How much the edges are pushed apart",
        s.amount,
        0,
        500,
        `${s.amount}%`,
        (v) => update({ amount: v }),
      )}
      {@render slider(
        "Radius",
        "How wide an edge it works on, in document pixels",
        Math.round(s.radius * 10),
        3,
        SHARPEN_MAX * 10,
        `${s.radius} px`,
        (v) => update({ radius: v / 10 }),
      )}
    {:else if spec.kind === "shadow"}
      {@const s = spec}
      {@render colour("Colour", "The shadow's colour", s.colour, (v) => update({ colour: v }))}
      {@render slider(
        "Opacity",
        "How dark the shadow is",
        s.opacity,
        0,
        100,
        `${s.opacity}%`,
        (v) => update({ opacity: v }),
      )}
      {@render slider(
        "Distance",
        "How far the shadow falls from the shape, in document pixels",
        s.distance,
        0,
        SHADOW_DISTANCE_MAX,
        `${s.distance} px`,
        (v) => update({ distance: v }),
      )}
      {@render slider(
        "Angle",
        "Where the light comes from (120°: the upper left, the shadow falls down-right)",
        s.angle,
        0,
        360,
        `${s.angle}°`,
        (v) => update({ angle: v }),
      )}
      {@render slider(
        "Blur",
        "How soft the shadow is, in document pixels",
        s.blur,
        0,
        SHADOW_BLUR_MAX,
        `${s.blur} px`,
        (v) => update({ blur: v }),
      )}
    {:else if spec.kind === "glow"}
      {@const s = spec}
      {@render colour("Colour", "The glow's colour", s.colour, (v) => update({ colour: v }))}
      {@render slider(
        "Opacity",
        "How strong the glow is",
        s.opacity,
        0,
        100,
        `${s.opacity}%`,
        (v) => update({ opacity: v }),
      )}
      {@render slider(
        "Size",
        "How far the glow spreads out, in document pixels",
        s.size,
        1,
        SHADOW_BLUR_MAX,
        `${s.size} px`,
        (v) => update({ size: v }),
      )}
      {@render slider(
        "Spread",
        "How far it stays solid before it fades",
        s.spread,
        0,
        100,
        `${s.spread}%`,
        (v) => update({ spread: v }),
      )}
      <p class="text-[11px] text-text-muted">
        Drawn behind the paint, so it shows round the shape — not on a filled Background.
      </p>
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
      {@render choice("Edges", edges, s.smooth ? "smooth" : "hard", (v) =>
        update({ smooth: v === "smooth" }),
      )}
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
