import { writePsd, type Psd, type Layer as PsdLayer } from "ag-psd";
import type { LayerNode, LayerManager } from "./layers";

/**
 * Export layer tree as a PSD file with group folders.
 * Layer/group names can include Spine 2D tags: [slot], [skin], [bone], [mesh], [merge], [ignore]
 * See: https://esotericsoftware.com/spine-import-psd
 */
export function exportPsd(manager: LayerManager, dpr: number) {
  const w = Math.round(manager["cssWidth"] * dpr);
  const h = Math.round(manager["cssHeight"] * dpr);

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
      } else {
        const cvs = document.createElement("canvas");
        cvs.width = w;
        cvs.height = h;
        cvs.getContext("2d")!.drawImage(node.canvas, 0, 0);
        return {
          name: node.name,
          canvas: cvs,
          opacity: node.opacity / 100,
          hidden: !node.visible,
          left: 0,
          top: 0,
        };
      }
    });
  }

  // Composite for flattened preview
  const composite = document.createElement("canvas");
  composite.width = w;
  composite.height = h;
  const compCtx = composite.getContext("2d")!;
  for (const layer of manager.flatLayers()) {
    if (!layer.visible) continue;
    compCtx.globalAlpha = layer.opacity / 100;
    compCtx.drawImage(layer.canvas, 0, 0);
  }
  compCtx.globalAlpha = 1;

  const psd: Psd = {
    width: w,
    height: h,
    canvas: composite,
    children: buildChildren(manager.tree),
  };

  const buffer = writePsd(psd, {
    generateThumbnail: true,
    trimImageData: true,
  });

  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "drawing.psd";
  a.click();
  URL.revokeObjectURL(url);
}
