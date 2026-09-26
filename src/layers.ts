import { matrixFromCorners, type Corners } from "./ref-placement";

/** A reference's ORIGINAL image: the file as imported (kept whole for the PSD's embedded Smart
 *  Object) and a decoded copy for drawing (capped to what an iPad canvas allows). */
export interface RefSource {
  /** Matches the placed layer to its embedded file in the PSD. */
  id: string;
  name: string;
  bytes: Uint8Array;
  /** The original's own pixel size (the file's, not the capped decode's). */
  width: number;
  height: number;
  /** Decoded copy, or null while an opened file is still decoding. */
  image: HTMLCanvasElement | null;
}

/** A reference layer: drawn from its original at `corners`, so moving and scaling never resample
 *  the layer's own pixels. Painting on it is refused; Bake drops this and keeps the pixels. */
export interface RefPlacement {
  src: RefSource;
  corners: Corners;
}

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
  /** Set on a reference layer (a Smart Object in the PSD); absent on every ordinary layer. */
  ref?: RefPlacement;
}

export interface LayerGroup {
  type: "group";
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  children: LayerNode[];
  collapsed: boolean;
  /** Locks every member while set; the members keep their own locks (as slop-animator). */
  locked: boolean;
}

export type LayerNode = Layer | LayerGroup;

/** A structural undo point: the tree's shape, with layers held by reference. */
export interface StructSnapshot {
  tree: LayerNode[];
  activeId: number;
}

/** Copy the arrays and group nodes; keep Layer objects (and their canvases) shared. */
/** Whether node `id` refuses edits: its own lock, or any enclosing group's. */
export function lockedInTree(tree: LayerNode[], id: number): boolean {
  const walk = (nodes: LayerNode[], inherited: boolean): boolean | null => {
    for (const n of nodes) {
      const locked = inherited || n.locked;
      if (n.id === id) return locked;
      if (n.type === "group") {
        const found = walk(n.children, locked);
        if (found !== null) return found;
      }
    }
    return null;
  };
  return walk(tree, false) ?? false;
}

/** The row above or below `id` as the layer panel lists them — top first, a group before its
 *  members, a collapsed group's members skipped — or null at either end (↑/↓, as slop-animator). */
export function adjacentRow(tree: LayerNode[], id: number, dir: "up" | "down"): number | null {
  const rows: number[] = [];
  const list = (nodes: LayerNode[]) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      rows.push(n.id);
      if (n.type === "group" && !n.collapsed) list(n.children);
    }
  };
  list(tree);
  const i = rows.indexOf(id);
  if (i < 0) return null;
  const j = dir === "up" ? i - 1 : i + 1;
  return j >= 0 && j < rows.length ? rows[j] : null;
}

function cloneTree(nodes: LayerNode[]): LayerNode[] {
  return nodes.map((n) => (n.type === "group" ? { ...n, children: cloneTree(n.children) } : n));
}

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
    onChange: () => void,
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

  /** Whether `node` refuses edits: its own lock or an enclosing group's. Use this, never `.locked`. */
  isLocked(node: LayerNode): boolean {
    return lockedInTree(this.tree, node.id);
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

  /** 0..1, a layer's opacity times its enclosing groups' — the alpha `composite()` draws it with.
   *  Ignores visibility. */
  contentAlpha(id: number): number {
    function search(nodes: LayerNode[], alpha: number): number | null {
      for (const node of nodes) {
        const a = alpha * (node.opacity / 100);
        if (node.id === id) return a;
        if (node.type === "group") {
          const found = search(node.children, a);
          if (found !== null) return found;
        }
      }
      return null;
    }
    return search(this.tree, 1) ?? 1;
  }

  /** Redraw a reference layer from its original at its placement (a no-op until it has decoded).
   *  `corners` draws it somewhere else without storing that (a drag in progress); `fast` trades
   *  resampling quality for speed while it moves. */
  renderRef(layer: Layer, corners?: Corners, fast = false) {
    const ref = layer.ref;
    if (!ref?.src.image) return;
    const img = ref.src.image;
    const m = matrixFromCorners(img.width, img.height, corners ?? ref.corners);
    const d = this.dpr;
    const ctx = layer.ctx;
    ctx.save();
    ctx.resetTransform();
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    ctx.setTransform(d * m.a, d * m.b, d * m.c, d * m.d, d * m.e, d * m.f);
    ctx.imageSmoothingQuality = fast ? "low" : "high";
    ctx.drawImage(img, 0, 0);
    ctx.restore();
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
      // A reference moves with its pixels, and is re-drawn whole (the resize may have cut it).
      if (layer.ref) {
        const dx = offsetX / dpr;
        const dy = offsetY / dpr;
        layer.ref = {
          src: layer.ref.src,
          corners: layer.ref.corners.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Corners,
        };
        this.renderRef(layer);
      }
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

  /** Add a layer directly BELOW the active node, in the same parent (the bottom of the tree if
   *  nothing is active) — where a reference goes, under the drawing that traces over it. */
  addLayerBelow(name?: string): Layer {
    const layer = this.createLayer(name);
    const loc = this.findParent(this.activeId);
    if (loc) loc.parent.splice(loc.index, 0, layer);
    else this.tree.unshift(layer);
    this.activeId = layer.id;
    this.onChange();
    return layer;
  }

  addGroup(name?: string): LayerGroup {
    const group: LayerGroup = {
      type: "group",
      id: nextId++,
      name: name ?? `Group ${this.flatAll().filter((n) => n.type === "group").length + 1}`,
      visible: true,
      opacity: 100,
      children: [],
      collapsed: false,
      locked: false,
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

    const dup = this.copyLayer(src, src.name + " copy");

    // Insert above the source
    loc.parent.splice(loc.index + 1, 0, dup);
    this.activeId = dup.id;
    this.onChange();
    return dup;
  }

  /** Duplicate a group with everything in it — layers keep their pixels and settings, every node
   *  gets a fresh id — placed right above the original and made active (as slop-animator). */
  duplicateGroup(id: number): LayerGroup | null {
    const src = this.findNode(id);
    if (!src || src.type !== "group") return null;
    const loc = this.findParent(id);
    if (!loc) return null;
    const copy = (n: LayerNode): LayerNode =>
      n.type === "group"
        ? { ...n, id: nextId++, children: n.children.map(copy) }
        : this.copyLayer(n, n.name);
    const dup = { ...(copy(src) as LayerGroup), name: src.name + " copy" };
    loc.parent.splice(loc.index + 1, 0, dup);
    this.activeId = dup.id;
    this.onChange();
    return dup;
  }

  /** A new layer with `src`'s pixels and settings (not yet in the tree). */
  private copyLayer(src: Layer, name: string): Layer {
    const dup = this.createLayer(name);
    dup.opacity = src.opacity;
    dup.visible = src.visible;
    dup.locked = src.locked;
    dup.alphaLock = src.alphaLock;
    // A copy of a reference is a reference too: same original, its own placement.
    if (src.ref) {
      dup.ref = { src: src.ref.src, corners: src.ref.corners.map((p) => ({ ...p })) as Corners };
    }
    dup.ctx.resetTransform();
    dup.ctx.drawImage(src.canvas, 0, 0);
    dup.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
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

  /** Pixels of one layer (not just the active one), for undo. */
  snapshotOf(layer: Layer): ImageData {
    return layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  }

  /** Put pixels back on one layer. putImageData ignores the ctx transform. */
  restoreTo(layer: Layer, data: ImageData) {
    layer.ctx.putImageData(data, 0, 0);
  }

  /**
   * The SHAPE of the tree — which nodes exist, their nesting and order, plus the active id.
   * Layer objects are kept by reference (their canvases must survive undo), so this records
   * structure only: a layer's own name/opacity/visibility/lock are not part of it.
   */
  captureStructure(): StructSnapshot {
    return { tree: cloneTree(this.tree), activeId: this.activeId };
  }

  restoreStructure(snap: StructSnapshot) {
    this.tree = cloneTree(snap.tree);
    this.activeId = snap.activeId;
    this.onChange();
  }

  getSnapshot(): ImageData {
    const layer = this.active;
    return layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  }

  restoreSnapshot(data: ImageData) {
    this.active.ctx.putImageData(data, 0, 0);
  }
}
