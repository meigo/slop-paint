# Browser AI models — ideas and constraints

Not implemented. Notes from a 2026-09-26 discussion (after slop-image-upscaler got in-browser AI):
which small models could run in the browser here and add real value, and how to ship them.

Sizes and quality notes below are rough, from memory. **Before picking a model, verify its current
browser-ready ONNX export and its licence** — several SAM / BiRefNet variants and many anime
line-art models are non-commercial or unclear, which matters if slop-paint is used for paid work.

## Ground rules

- **The artist draws; AI prepares and tidies.** Models work on references, selections and
  clean-up — never generating or restyling the artwork. Diffusion-style generation stays out, even
  on desktop: it competes with the artist and is a different product.
- **Non-destructive output.** A result lands on a NEW layer, or as a new version of a reference (the
  Smart Object original is kept). A bad result costs one undo or one layer delete.
- **Two tiers.** Light models everywhere, iPad included. Heavier ones only where the device can take
  them (typically desktop with a WebGPU GPU). An iPad is not the only target: an option may be
  desktop-only.
- **Never a silent no-op.** Where a feature isn't available it is dimmed with a reason
  (`aria-disabled` + `title`, read by the status bar): e.g. "Needs a WebGPU-capable GPU — available
  on desktop Chrome/Edge/Safari".

## Candidates

| Feature | iPad | Desktop (capable GPU) | Model class (approx. size) |
|---|---|---|---|
| Photo → line art, on a reference | ✓ | ✓ | informative-drawings / anime2sketch (~20 MB) |
| Background removal, on a reference | ✓ light | ✓ higher quality (hair, edges) | MODNet / RMBG (~40–180 MB); BiRefNet on desktop |
| Smart select: tap / box → selection | ✓ | ✓ better masks, also on drawn art | SlimSAM / MobileSAM (tens of MB); SAM 2 small/base on desktop |
| Pose on a reference (Spine bone hint) | ✓ | ✓ | MediaPipe Pose / MoveNet (a few MB) |
| Sketch clean-up: rough pencil → clean lines | ✗ | ✓ | sketch-simplification class |
| Colour flats on line art (region per colour, from a palette) | ✗ | ✓ | segmentation-based |
| Inpainting on a reference (remove a person/object) | ✗ | ✓ | LaMa class |
| Depth map (lighting guide) | ✗ | ✓ | Depth Anything small/base |

Notes:

- **Smart select** gives the most everyday value (it feeds Free transform, fill, copy, Outline) but
  touches the selection code, so it is the most work. Small SAM variants are weaker on thin line art;
  a flood-fill "select enclosed area" may do as well there without a model.
- **Background removal** and **photo → line art** fit the Smart Object references: a button on the
  reference, result stored as a new version or beside the original.
- **Sketch clean-up** is the biggest NEW value on desktop: it works on the artist's own drawing, and
  nothing in the app does it now.
- **Pose → Spine bones** (suggest `[bone]` groups) is interesting but a larger feature and more
  slop-animator's territory.
- **Not worth it:** neural stroke smoothing (the brush engines' smoothing/streamline cover it),
  upscaling (slop-image-upscaler does it), diffusion colourisation or generation (too heavy on iPad,
  competes with the artist; Fill enclosed already does flats).

## Suggested order

1. **Photo → line art** — small, works everywhere; the pilot for the shared model-loading setup.
2. **Background removal** — two quality tiers; exercises the capability gating.
3. **Sketch clean-up** — desktop; biggest new value.
4. **Smart select** — the most integration work (selection code).

## Implementation notes

- **Runtime:** ONNX Runtime Web or transformers.js, WebGPU with a WASM fallback (several times
  slower). If slop-image-upscaler already uses onnxruntime-web, share its loading / caching /
  fallback code.
- **Capability gating at runtime, not by device:** request a WebGPU adapter and check its limits
  (`maxBufferSize`, `maxStorageBufferBindingSize`) against the model's needs; a short benchmark on
  first use can catch weak integrated GPUs. `navigator.deviceMemory` exists only in Chromium.
- **iPad memory:** Safari kills tabs that use too much memory. Keep iPad-tier models to about 100 MB
  or less, and check them on a real iPad — WebGPU availability and speed there decide the choice.
- **Loading:** only on first use, never at startup. Cache the model (Cache API or IndexedDB) so it
  downloads once. Show the size before the download ("Downloading model, 45 MB…"); ask first for
  desktop models (100–400 MB).
- **Canvas limits:** decoded images are already capped for iPad (`fitDecodedSize` in
  `ref-placement.ts`); model inputs will usually need their own resize/tiling to the model's input
  size.
