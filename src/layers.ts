import { History } from "./history";

export interface Layer {
  type: "layer";
  id: number;
  name: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  visible: boolean;
  opacity: number;
  locked: boolean;
  alphaLock: boolean;
  history: History;
}

export interface LayerGroup {
  type: "group";
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  children: LayerNode[];
  collapsed: boolean;
}

export type LayerNode = Layer | LayerGroup;

let nextId = 1;

export class LayerManager {
  /** Root-level nodes (bottom to top draw order) */
  tree: LayerNode[] = [];
  activeId = -1;
  private dpr = 1;
  /** Document (canvas) dimensions in CSS pixels */
  docWidth = 1920;
  docHeight = 1080;

  displayCtx: CanvasRenderingContext2D;
  onChange: () => void;

  constructor(
    _displayCanvas: HTMLCanvasElement,
    displayCtx: CanvasRenderingContext2D,
    onChange: () => void
  ) {
    this.displayCtx = displayCtx;
    this.onChange = onChange;
  }

  /** Get the active layer (drawable leaf) */
  get active(): Layer {
    const layer = this.findLayer(this.activeId);
    if (layer) return layer;
    // Fallback to first leaf
    const all = this.flatLayers();
    return all[0];
  }

  /** All drawable layers in draw order (bottom to top) */
  flatLayers(): Layer[] {
    const result: Layer[] = [];
    function walk(nodes: LayerNode[]) {
      for (const node of nodes) {
        if (node.type === "layer") {
          result.push(node);
        } else {
          walk(node.children);
        }
      }
    }
    walk(this.tree);
    return result;
  }

  /** All nodes flattened (for iteration) */
  flatAll(): LayerNode[] {
    const result: LayerNode[] = [];
    function walk(nodes: LayerNode[]) {
      for (const node of nodes) {
        result.push(node);
        if (node.type === "group") walk(node.children);
      }
    }
    walk(this.tree);
    return result;
  }

  findLayer(id: number): Layer | null {
    for (const node of this.flatAll()) {
      if (node.type === "layer" && node.id === id) return node;
    }
    return null;
  }

  findNode(id: number): LayerNode | null {
    for (const node of this.flatAll()) {
      if (node.id === id) return node;
    }
    return null;
  }

  /** Find the parent array and index of a node by id */
  findParent(id: number): { parent: LayerNode[]; index: number } | null {
    function search(nodes: LayerNode[]): { parent: LayerNode[]; index: number } | null {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) return { parent: nodes, index: i };
        if (nodes[i].type === "group") {
          const found = search((nodes[i] as LayerGroup).children);
          if (found) return found;
        }
      }
      return null;
    }
    return search(this.tree);
  }

  /** Update display pixel ratio */
  setDpr(dpr: number) {
    this.dpr = dpr;
  }

  /**
   * Set document size and resize all layer canvases to match.
   * anchorX/anchorY: 0=left/top, 0.5=center, 1=right/bottom
   */
  setDocumentSize(docW: number, docH: number, anchorX = 0, anchorY = 0) {
    const oldW = this.docWidth;
    const oldH = this.docHeight;
    this.docWidth = docW;
    this.docHeight = docH;
    const dpr = this.dpr;
    const pxW = docW * dpr;
    const pxH = docH * dpr;
    // Offset to place old content at anchor position
    const offsetX = Math.round((docW - oldW) * anchorX * dpr);
    const offsetY = Math.round((docH - oldH) * anchorY * dpr);

    for (const layer of this.flatLayers()) {
      const tmp = document.createElement("canvas");
      tmp.width = layer.canvas.width;
      tmp.height = layer.canvas.height;
      tmp.getContext("2d")!.drawImage(layer.canvas, 0, 0);

      layer.canvas.width = pxW;
      layer.canvas.height = pxH;
      layer.ctx.resetTransform();
      layer.ctx.drawImage(tmp, offsetX, offsetY);
      layer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  createLayer(name?: string): Layer {
    const canvas = document.createElement("canvas");
    const pxW = this.docWidth * this.dpr;
    const pxH = this.docHeight * this.dpr;
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.scale(this.dpr, this.dpr);

    return {
      type: "layer",
      id: nextId++,
      name: name ?? `Layer ${this.flatLayers().length + 1}`,
      canvas,
      ctx,
      visible: true,
      opacity: 100,
      locked: false,
      alphaLock: false,
      history: new History(),
    };
  }

  /** Insert a node relative to the current selection */
  private insertAtSelection(node: LayerNode) {
    const selected = this.findNode(this.activeId);
    if (selected && selected.type === "group") {
      // Selected is a group — add inside it at the top
      selected.children.push(node);
    } else if (selected) {
      // Selected is a layer — add above it in the same parent
      const loc = this.findParent(selected.id);
      if (loc) {
        loc.parent.splice(loc.index + 1, 0, node);
      } else {
        this.tree.push(node);
      }
    } else {
      this.tree.push(node);
    }
  }

  addLayer(name?: string): Layer {
    const layer = this.createLayer(name);
    this.insertAtSelection(layer);
    this.activeId = layer.id;
    this.onChange();
    return layer;
  }

  addGroup(name?: string): LayerGroup {
    const group: LayerGroup = {
      type: "group",
      id: nextId++,
      name: name ?? `Group ${this.flatAll().filter(n => n.type === "group").length + 1}`,
      visible: true,
      opacity: 100,
      children: [],
      collapsed: false,
    };
    this.insertAtSelection(group);
    this.onChange();
    return group;
  }

  removeNode(id: number) {
    const loc = this.findParent(id);
    if (!loc) return;
    const node = loc.parent[loc.index];

    // Count how many drawable layers would remain after removal
    const allLayers = this.flatLayers();
    const countLayers = (n: LayerNode): number => {
      if (n.type === "layer") return 1;
      return n.children.reduce((sum, child) => sum + countLayers(child), 0);
    };
    if (allLayers.length - countLayers(node) < 1) return;

    loc.parent.splice(loc.index, 1);

    // If active was removed, select another
    if (this.activeId === id || !this.findLayer(this.activeId)) {
      const remaining = this.flatLayers();
      if (remaining.length > 0) {
        this.activeId = remaining[remaining.length - 1].id;
      }
    }
    this.onChange();
  }

  setActive(id: number) {
    this.activeId = id;
  }

  duplicateLayer(id: number): Layer | null {
    const src = this.findLayer(id);
    if (!src) return null;
    const loc = this.findParent(id);
    if (!loc) return null;

    const dup = this.createLayer(src.name + " copy");
    dup.opacity = src.opacity;
    dup.visible = src.visible;
    dup.locked = src.locked;
    dup.alphaLock = src.alphaLock;
    dup.ctx.resetTransform();
    dup.ctx.drawImage(src.canvas, 0, 0);
    dup.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Insert above the source
    loc.parent.splice(loc.index + 1, 0, dup);
    this.activeId = dup.id;
    this.onChange();
    return dup;
  }

  /** Merge the given layer down onto the layer below it */
  mergeDown(id: number): boolean {
    const loc = this.findParent(id);
    if (!loc) return false;
    const src = loc.parent[loc.index];
    if (src.type !== "layer") return false;
    if (loc.index === 0) return false; // nothing below

    // Find the layer below (must be a layer, not a group)
    const below = loc.parent[loc.index - 1];
    if (below.type !== "layer") return false;

    // Save undo snapshot on the target
    below.history.push(
      below.ctx.getImageData(0, 0, below.canvas.width, below.canvas.height)
    );

    // Draw src onto below
    below.ctx.save();
    below.ctx.resetTransform();
    below.ctx.globalAlpha = src.opacity / 100;
    below.ctx.drawImage(src.canvas, 0, 0);
    below.ctx.restore();

    // Remove the source layer
    loc.parent.splice(loc.index, 1);
    this.activeId = below.id;
    this.onChange();
    return true;
  }

  toggleVisibility(id: number) {
    const node = this.findNode(id);
    if (node) {
      node.visible = !node.visible;
      this.composite();
      this.onChange();
    }
  }

  setOpacity(id: number, opacity: number) {
    const node = this.findNode(id);
    if (node) {
      node.opacity = opacity;
      this.composite();
    }
  }

  composite() {
    const dpr = this.dpr;
    const ctx = this.displayCtx;
    const docPxW = this.docWidth * dpr;
    const docPxH = this.docHeight * dpr;

    ctx.resetTransform();
    ctx.clearRect(0, 0, docPxW, docPxH);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Walk the tree respecting group visibility/opacity
    function drawNodes(nodes: LayerNode[], parentAlpha: number) {
      for (const node of nodes) {
        if (!node.visible) continue;
        const alpha = parentAlpha * (node.opacity / 100);
        if (node.type === "layer") {
          if (node.canvas.width === 0 || node.canvas.height === 0) continue;
          ctx.globalAlpha = alpha;
          ctx.resetTransform();
          ctx.drawImage(node.canvas, 0, 0);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        } else {
          drawNodes(node.children, alpha);
        }
      }
    }
    drawNodes(this.tree, 1);
    ctx.globalAlpha = 1;
  }

  getSnapshot(): ImageData {
    const layer = this.active;
    return layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  }

  restoreSnapshot(data: ImageData) {
    this.active.ctx.putImageData(data, 0, 0);
  }
}
