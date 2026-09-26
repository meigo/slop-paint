import { writePsd, readPsd, type Psd, type Layer as PsdLayer, type LinkedFile } from "ag-psd";
import { downloadBlob } from "./download";
import type { LayerNode, LayerManager, Layer, LayerGroup, RefSource } from "./layers";
import { refFromPlaced, smartObjectFor } from "./ref-placement";
import { decodeRefSource } from "./ref-image";

let importIdCounter = 1000;

/**
 * Build a PSD blob from the layer tree and trigger a browser download.
 * `trim` controls whether layer canvases are trimmed to their non-transparent
 * bounds — false for "save" (round-trip fidelity), true for "export" (smaller files).
 */
function writePsdFile(manager: LayerManager, opts: { trim: boolean; filename: string }) {
  const buffer = psdBuffer(manager, opts.trim);
  downloadBlob(new Blob([buffer], { type: "application/octet-stream" }), opts.filename);
}

/** The project as a PSD buffer (used by the file writer above and by autosave). */
export function psdBuffer(manager: LayerManager, trim: boolean): ArrayBuffer {
  const w = manager.docWidth;
  const h = manager.docHeight;
  // A reference is written as a Smart Object — its placement plus its original file, so it can be
  // moved and scaled again after reopening. Project saves only (`!trim`): the trimmed export is for
  // Spine, which wants plain pixels. Duplicates share one original, embedded once.
  const linkedFiles: LinkedFile[] = [];

  function buildChildren(nodes: LayerNode[]): PsdLayer[] {
    return nodes.map((node) => {
      if (node.type === "group") {
        return {
          name: node.name,
          opened: !node.collapsed,
          hidden: !node.visible,
          opacity: node.opacity / 100,
          children: buildChildren(node.children),
        };
      }
      const cvs = document.createElement("canvas");
      cvs.width = w;
      cvs.height = h;
      // node.canvas is dpr-scaled (physical pixels); scale down to CSS-sized PSD canvas.
      cvs.getContext("2d")!.drawImage(node.canvas, 0, 0, w, h);
      const out: PsdLayer = {
        name: node.name,
        canvas: cvs,
        opacity: node.opacity / 100,
        hidden: !node.visible,
        left: 0,
        top: 0,
      };
      if (node.ref && !trim) {
        const so = smartObjectFor(node.ref);
        out.placedLayer = so.placedLayer;
        if (!linkedFiles.some((f) => f.id === so.linkedFile.id)) linkedFiles.push(so.linkedFile);
      }
      return out;
    });
  }

  const composite = document.createElement("canvas");
  composite.width = w;
  composite.height = h;
  const compCtx = composite.getContext("2d")!;
  for (const layer of manager.flatLayers()) {
    if (!layer.visible) continue;
    compCtx.globalAlpha = layer.opacity / 100;
    compCtx.drawImage(layer.canvas, 0, 0, w, h);
  }
  compCtx.globalAlpha = 1;

  const children = buildChildren(manager.tree);
  const psd: Psd = {
    width: w,
    height: h,
    canvas: composite,
    children,
    ...(linkedFiles.length ? { linkedFiles } : {}),
  };

  return writePsd(psd, {
    generateThumbnail: true,
    trimImageData: trim,
  });
}

/** Export layer tree as a PSD with trimmed layer bounds (smaller file, Photoshop/Spine-friendly). */
export function exportPsd(manager: LayerManager, filename = "drawing.psd") {
  writePsdFile(manager, { trim: true, filename });
}

/** Save the project as a PSD with full-size layers (preserves positions on round-trip). */
export function savePsd(manager: LayerManager, filename: string = "project.psd") {
  writePsdFile(manager, { trim: false, filename });
}

/**
 * Load a PSD file and rebuild the layer tree.
 * Returns the PSD dimensions so the caller can resize the canvas if needed.
 */
export function loadPsd(
  buffer: ArrayBuffer,
  manager: LayerManager,
  dpr: number,
  /** Called as each reference's original finishes decoding (it can be transformed from then on). */
  onRefDecoded?: () => void,
): { width: number; height: number } {
  const psd = readPsd(buffer);
  const w = psd.width;
  const h = psd.height;
  // Smart Objects become references again. Their originals decode in the background, one decode
  // per embedded file however many layers share it; the layer's saved pixels show meanwhile.
  const refSources = new Map<string, RefSource>();

  // Clear existing tree
  manager.tree.length = 0;

  function buildNode(psdLayer: PsdLayer): LayerNode | null {
    if (psdLayer.children) {
      // It's a group
      const group: LayerGroup = {
        type: "group",
        id: importIdCounter++,
        name: psdLayer.name || "Group",
        visible: !psdLayer.hidden,
        opacity: Math.round((psdLayer.opacity ?? 1) * 100),
        children: [],
        collapsed: !(psdLayer.opened ?? true),
        locked: false,
      };
      for (const child of psdLayer.children) {
        const node = buildNode(child);
        if (node) group.children.push(node);
      }
      return group;
    } else {
      // It's a layer
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

      // Draw the PSD layer's canvas scaled up by dpr to fill the internal canvas
      if (psdLayer.canvas) {
        const left = psdLayer.left ?? 0;
        const top = psdLayer.top ?? 0;
        ctx.scale(dpr, dpr);
        ctx.drawImage(psdLayer.canvas, left, top);
        ctx.resetTransform();
      }
      // Set dpr transform for future CSS-coord operations
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const layer: Layer = {
        type: "layer",
        id: importIdCounter++,
        name: psdLayer.name || "Layer",
        canvas,
        ctx,
        visible: !psdLayer.hidden,
        opacity: Math.round((psdLayer.opacity ?? 1) * 100),
        locked: false,
        alphaLock: false,
      };
      const ref = refFromPlaced(psdLayer.placedLayer, psd.linkedFiles);
      if (ref) {
        const shared = refSources.get(ref.src.id) ?? ref.src;
        refSources.set(shared.id, shared);
        layer.ref = { src: shared, corners: ref.corners };
      }
      return layer;
    }
  }

  if (psd.children) {
    for (const child of psd.children) {
      const node = buildNode(child);
      if (node) manager.tree.push(node);
    }
  } else if (psd.canvas) {
    // No layers, just a flat image
    const layer = manager.createLayer("Background");
    layer.ctx.drawImage(psd.canvas, 0, 0);
    manager.tree.push(layer);
  }

  // Set active to the topmost layer
  const flat = manager.flatLayers();
  if (flat.length > 0) {
    manager.activeId = flat[flat.length - 1].id;
  }

  decodeOpenedRefs(refSources.values(), onRefDecoded);
  return { width: w, height: h };
}

/** Decode the originals of the references an opened PSD brought back, filling in each shared
 *  source's drawing copy. Until then a reference shows its saved pixels and can't be transformed. */
function decodeOpenedRefs(sources: Iterable<RefSource>, onDecoded?: () => void) {
  for (const src of sources) {
    decodeRefSource(src.bytes, src.name, src.id).then(
      (decoded) => {
        src.image = decoded.image;
        if (!src.width) src.width = decoded.width;
        if (!src.height) src.height = decoded.height;
        onDecoded?.();
      },
      (e) => console.error(`reference "${src.name}" could not be decoded`, e),
    );
  }
}
