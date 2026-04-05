import { writePsd, type Psd, type Layer } from "ag-psd";
import type { Layer as AppLayer } from "./layers";

/**
 * Export all layers as a PSD file.
 * Layers with the same `group` are placed in a PSD group folder.
 * Group/layer names can include Spine 2D tags like [slot], [skin], [bone], [mesh], [merge].
 *
 * Spine PSD import reference: https://esotericsoftware.com/spine-import-psd
 *  - Layer order = draw order (bottom layer drawn first)
 *  - Groups with [slot] / [skin] / [bone] tags map to Spine concepts
 *  - [merge] on a group flattens it to one image
 *  - [ignore] skips the layer
 *  - Blending modes: normal, multiply, screen supported
 */
export function exportPsd(
  layers: AppLayer[],
  canvasWidth: number,
  canvasHeight: number,
  dpr: number
) {
  const w = Math.round(canvasWidth * dpr);
  const h = Math.round(canvasHeight * dpr);

  // Group layers by their group property
  // Layers without a group go at the top level
  // Layers with the same group name are placed in a PSD group folder
  const groupMap = new Map<string, AppLayer[]>();
  const ungrouped: AppLayer[] = [];

  for (const layer of layers) {
    if (layer.group) {
      if (!groupMap.has(layer.group)) {
        groupMap.set(layer.group, []);
      }
      groupMap.get(layer.group)!.push(layer);
    } else {
      ungrouped.push(layer);
    }
  }

  function makeLayerEntry(layer: AppLayer): Layer {
    const cvs = document.createElement("canvas");
    cvs.width = w;
    cvs.height = h;
    const ctx = cvs.getContext("2d")!;
    ctx.drawImage(layer.canvas, 0, 0);

    return {
      name: layer.name,
      canvas: cvs,
      opacity: layer.opacity / 100,
      hidden: !layer.visible,
      left: 0,
      top: 0,
    };
  }

  // Build children array preserving original order
  // Walk through layers in order; when we encounter a grouped layer,
  // emit the whole group (if not already emitted)
  const children: Layer[] = [];
  const emittedGroups = new Set<string>();

  for (const layer of layers) {
    if (layer.group) {
      if (!emittedGroups.has(layer.group)) {
        emittedGroups.add(layer.group);
        const groupLayers = groupMap.get(layer.group)!;
        children.push({
          name: layer.group,
          opened: true,
          children: groupLayers.map(makeLayerEntry),
        });
      }
    } else {
      children.push(makeLayerEntry(layer));
    }
  }

  // Composite canvas for the flattened preview
  const composite = document.createElement("canvas");
  composite.width = w;
  composite.height = h;
  const compCtx = composite.getContext("2d")!;

  for (const layer of layers) {
    if (!layer.visible) continue;
    compCtx.globalAlpha = layer.opacity / 100;
    compCtx.drawImage(layer.canvas, 0, 0);
  }
  compCtx.globalAlpha = 1;

  const psd: Psd = {
    width: w,
    height: h,
    canvas: composite,
    children,
  };

  const buffer = writePsd(psd, {
    generateThumbnail: true,
    trimImageData: true,
  });

  // Download
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "drawing.psd";
  a.click();
  URL.revokeObjectURL(url);
}
