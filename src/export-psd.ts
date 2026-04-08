import { writePsd, readPsd, type Psd, type Layer as PsdLayer } from "ag-psd";
import type { LayerNode, LayerManager, Layer, LayerGroup } from "./layers";
import { History } from "./history";

let importIdCounter = 1000;

/**
 * Export layer tree as a PSD file with group folders.
 */
export function exportPsd(manager: LayerManager, dpr: number) {
  const w = manager.docWidth;
  const h = manager.docHeight;

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

/**
 * Save the current project as a PSD file (same as export but named "save").
 */
export function savePsd(manager: LayerManager, dpr: number, filename: string = "project.psd") {
  const w = manager.docWidth;
  const h = manager.docHeight;

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
    trimImageData: false, // keep full canvas for save (no trim so positions are preserved)
  });

  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Load a PSD file and rebuild the layer tree.
 * Returns the PSD dimensions so the caller can resize the canvas if needed.
 */
export function loadPsd(
  buffer: ArrayBuffer,
  manager: LayerManager,
  dpr: number
): { width: number; height: number } {
  const psd = readPsd(buffer);
  const w = psd.width;
  const h = psd.height;

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
        history: new History(),
      };
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

  return { width: w, height: h };
}
