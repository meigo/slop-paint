import { History } from "./history";

export interface Layer {
  type: "layer";
  id: number;
  name: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  visible: boolean;
  opacity: number;
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
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;

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

  resize(cssWidth: number, cssHeight: number, dpr: number) {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = dpr;

    const pxW = cssWidth * dpr;
    const pxH = cssHeight * dpr;

    for (const layer of this.flatLayers()) {
      const tmp = document.createElement("canvas");
      tmp.width = layer.canvas.width;
      tmp.height = layer.canvas.height;
      tmp.getContext("2d")!.drawImage(layer.canvas, 0, 0);

      layer.canvas.width = pxW;
      layer.canvas.height = pxH;
      layer.ctx.scale(dpr, dpr);
      layer.ctx.resetTransform();
      layer.ctx.drawImage(tmp, 0, 0);
      layer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  createLayer(name?: string): Layer {
    const canvas = document.createElement("canvas");
    const pxW = this.cssWidth * this.dpr;
    const pxH = this.cssHeight * this.dpr;
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
      history: new History(),
    };
  }

  addLayer(name?: string): Layer {
    const layer = this.createLayer(name);
    this.tree.push(layer);
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
    this.tree.push(group);
    this.onChange();
    return group;
  }

  removeNode(id: number) {
    const loc = this.findParent(id);
    if (!loc) return;
    // Don't remove if it's the last drawable layer
    const allLayers = this.flatLayers();
    const node = loc.parent[loc.index];
    if (node.type === "layer" && allLayers.length <= 1) return;

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
    const w = this.cssWidth;
    const dpr = this.dpr;
    const ctx = this.displayCtx;

    ctx.resetTransform();
    ctx.clearRect(0, 0, w * dpr, this.cssHeight * dpr);
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
