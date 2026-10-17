import { writePsd, readPsd, type Psd, type Layer as PsdLayer, type LinkedFile } from "ag-psd";
import { downloadBlob } from "./download";
import {
  layersLeftAfter,
  newNodeId,
  type LayerNode,
  type LayerManager,
  type Layer,
  type LayerGroup,
  type RefSource,
} from "./layers";
import { refFromPlaced, smartObjectFor } from "./ref-placement";
import { decodeRefSource } from "./ref-image";
import { openTextSource, textPayloadFromPng } from "./text-ref";
import { layerBlendFromPsd } from "./blend";

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
      // node.canvas is dpr-scaled (physical pixels); scale down to CSS-sized PSD canvas. At 1×
      // (iPad's default) it already is that size, and ag-psd only reads it: a copy doubled the
      // layers' memory at every autosave, the tab-hide flush included.
      let cvs = node.canvas;
      if (cvs.width !== w || cvs.height !== h) {
        cvs = document.createElement("canvas");
        cvs.width = w;
        cvs.height = h;
        cvs.getContext("2d")!.drawImage(node.canvas, 0, 0, w, h);
      }
      const out: PsdLayer = {
        name: node.name,
        canvas: cvs,
        opacity: node.opacity / 100,
        hidden: !node.visible,
        blendMode: (node.blend ?? "normal") as PsdLayer["blendMode"],
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
  // The flattened preview other apps show: the screen's own compositing, at document size.
  manager.drawTree(composite.getContext("2d")!, w, h);

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
  /** Called with a reference's name when its original can't be decoded. */
  onRefFailed?: (name: string) => void,
): { width: number; height: number } {
  // No thumbnail (unused), and no composite when the file has layers (ag-psd still reads it for a
  // flat file, which needs it): each was another decoded image held through the open.
  const psd = readPsd(buffer, { skipThumbnail: true, skipCompositeImageData: true });
  const w = psd.width;
  const h = psd.height;
  // Smart Objects become references again. Their originals decode in the background, one decode
  // per embedded file however many layers share it; the layer's saved pixels show meanwhile.
  const refSources = new Map<string, RefSource>();

  // The new tree is built aside and swapped in only once every layer exists: a load that failed
  // partway (iPad refusing canvas memory for layer N) had already emptied the open document, while
  // the error said nothing had changed.
  const tree: LayerNode[] = [];

  function buildNode(psdLayer: PsdLayer): LayerNode | null {
    if (psdLayer.children) {
      // It's a group
      const group: LayerGroup = {
        type: "group",
        id: newNodeId(),
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
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("the device ran out of canvas memory");

      // Draw the PSD layer's canvas scaled up by dpr to fill the internal canvas
      if (psdLayer.canvas) {
        const left = psdLayer.left ?? 0;
        const top = psdLayer.top ?? 0;
        ctx.scale(dpr, dpr);
        // Nearest-neighbour: saves scale each layer DOWN to document pixels, so a smoothed scale
        // back up blurred it a little more on every save and reload (Sharp layers). Duplicated
        // pixels come back down to exactly the stored ones.
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(psdLayer.canvas, left, top);
        // Back on: the layer keeps this context, and every later draw onto it (stamps, a
        // transform's Apply, a reference's re-draw) came out point-sampled and jagged.
        ctx.imageSmoothingEnabled = true;
        ctx.resetTransform();
        psdLayer.canvas = undefined; // drawn: let the decoded copy go while the rest are built
      }
      // Set dpr transform for future CSS-coord operations
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const layer: Layer = {
        type: "layer",
        id: newNodeId(),
        name: psdLayer.name || "Layer",
        canvas,
        ctx,
        visible: !psdLayer.hidden,
        opacity: Math.round((psdLayer.opacity ?? 1) * 100),
        locked: false,
        alphaLock: false,
        blend: layerBlendFromPsd(psdLayer.blendMode),
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

  /** A layer at the FILE's size: createLayer sizes it from the manager's document size, which is
   *  still the OLD one here (a flat image came in stretched to it). The caller sets it for good. */
  function fileSizedLayer(name: string): Layer {
    const [oldW, oldH] = [manager.docWidth, manager.docHeight];
    manager.docWidth = w;
    manager.docHeight = h;
    try {
      return manager.createLayer(name);
    } finally {
      manager.docWidth = oldW; // a failure leaves the open document as it was
      manager.docHeight = oldH;
    }
  }

  // `children` is [] for a file whose layer section holds no records: that one is flat too.
  if (psd.children?.length) {
    for (const child of psd.children) {
      const node = buildNode(child);
      if (node) tree.push(node);
    }
  } else if (psd.canvas) {
    // No layers, just a flat image (a Photoshop file with only a Background).
    const layer = fileSizedLayer("Background");
    layer.ctx.drawImage(psd.canvas, 0, 0);
    tree.push(layer);
  }
  // Nothing to draw on (only empty groups, e.g. a Spine template, or no image at all): the app
  // needs an active layer — without one every tool and the layer strip threw.
  if (layersLeftAfter(tree, []) === 0) tree.push(fileSizedLayer("Layer 1"));

  manager.tree = tree;
  // Set active to the topmost layer
  const flat = manager.flatLayers();
  manager.activeId = flat[flat.length - 1].id;

  decodeOpenedRefs(refSources.values(), onRefDecoded, onRefFailed);
  return { width: w, height: h };
}

/** Decode the originals of the references an opened PSD brought back, filling in each shared
 *  source's drawing copy. Until then a reference shows its saved pixels and can't be transformed. */
function decodeOpenedRefs(
  sources: Iterable<RefSource>,
  onDecoded?: () => void,
  onFailed?: (name: string) => void,
) {
  for (const src of sources) {
    // A text reference's PNG carries its settings: rebuild it as text, once its font has loaded
    // (the saved bytes stay). Same fonts, same layout, so the raster copy comes out the size it was
    // saved at and the placement still fits it; a browser that measures differently just scales
    // the text to the saved box. A font this device lacks keeps the saved picture instead
    // (`openTextSource`).
    const payload = textPayloadFromPng(src.bytes);
    const decoding = payload
      ? openTextSource(src, payload)
      : decodeRefSource(src.bytes, src.name, src.id);
    decoding.then(
      (decoded) => {
        src.image = decoded.image;
        src.text = decoded.text;
        if (!src.width) src.width = decoded.width;
        if (!src.height) src.height = decoded.height;
        onDecoded?.();
      },
      (e) => {
        console.error(`reference "${src.name}" could not be decoded`, e);
        src.decodeFailed = true; // said, instead of "still loading" for good
        onFailed?.(src.name);
      },
    );
  }
}
