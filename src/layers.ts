import { matrixFromCorners, type Corners } from "./ref-placement";
import { drawTextLayout, type TextLayout, type TextSpec } from "./text-layout";
import { canvasOp } from "./blend";
import { halvingSteps } from "./resize";

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
  /** Set on a text reference: `image` is only its raster copy (for the handles and the PSD); the
   *  layer is drawn from this, sharp at any scale. `bytes` is a PNG carrying `spec` (text-ref.ts). */
  text?: {
    /** The settings as saved — the font by name, even when this device lacks it. */
    spec: TextSpec;
    /** What it's drawn with: `spec`, or `spec` with a stand-in font when its own is missing. */
    drawSpec: TextSpec;
    layout: TextLayout;
    /** `spec.font` isn't on this device (not bundled, in the library or installed). */
    fontMissing?: boolean;
    /** Opened without its font and not edited since: drawn from its saved picture (`image`), as
     *  its layout was measured in a font this device can't draw. */
    savedOnly?: boolean;
  };
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
  /** Blend mode by its Photoshop name ("multiply", "linear dodge"…; see blend.ts); absent = normal. */
  blend?: string;
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

/** A lifted selection, as the screen draws it into its layer (`LayerManager.floatPreview`). */
export interface FloatPreview {
  layerId: number;
  /** Draw the float onto `ctx`, whose transform maps document units to the layer's pixels. */
  render: (ctx: CanvasRenderingContext2D) => void;
}

/** A structural undo point: the tree's shape, with layers held by reference. */
export interface StructSnapshot {
  tree: LayerNode[];
  activeId: number;
}

/** Copy the arrays and group nodes; keep Layer objects (and their canvases) shared. */
/** Put node `id` into `group` (emptied first), in the node's place in its parent — as Photoshop's
 *  Group Layers. False when `id` isn't in the tree. */
export function wrapInGroup(tree: LayerNode[], id: number, group: LayerGroup): boolean {
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i];
    if (node.id === id) {
      group.children = [node];
      tree[i] = group;
      return true;
    }
    if (node.type === "group" && wrapInGroup(node.children, id, group)) return true;
  }
  return false;
}

/** Where node `id` sits: the array holding it (the root `tree` or a group's `children`), its index,
 *  and the enclosing group (null at the root). */
export function locateNode(
  tree: LayerNode[],
  id: number,
): { siblings: LayerNode[]; index: number; group: LayerGroup | null } | null {
  const walk = (nodes: LayerNode[], group: LayerGroup | null): ReturnType<typeof locateNode> => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.id === id) return { siblings: nodes, index: i, group };
      if (n.type === "group") {
        const found = walk(n.children, n);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(tree, null);
}

/** Whether `id` is `ancestorId` itself or somewhere inside it. */
export function isWithin(tree: LayerNode[], id: number, ancestorId: number): boolean {
  const anc = locateNode(tree, ancestorId);
  if (!anc) return false;
  const node = anc.siblings[anc.index];
  const has = (n: LayerNode): boolean =>
    n.id === id || (n.type === "group" && n.children.some(has));
  return has(node);
}

/** Whether `moveNode(tree, id, parentId, index)` would move anything (it changes nothing here):
 *  false when either id is missing, the parent isn't a group, a group would go inside itself, the
 *  index is out of range, or the node would land where it is. */
export function moveAllowed(
  tree: LayerNode[],
  id: number,
  parentId: number | null,
  index: number,
): boolean {
  const from = locateNode(tree, id);
  if (!from) return false;
  const to = childrenOf(tree, parentId);
  if (!to || (parentId !== null && isWithin(tree, parentId, id))) return false;
  if (index < 0 || index > to.length) return false;
  return !(to === from.siblings && (index === from.index || index === from.index + 1));
}

/** Move node `id` into `parentId`'s children (null = the root) at `index`, counted in that array
 *  AS IT IS NOW (bottom-first, 0 = the bottom; `length` = the top), so the caller needn't allow for
 *  the node leaving it. The layer panel's drag commits through this (2026-10-01; it used to read
 *  the order back from SortableJS's DOM). False, and the tree untouched, when `moveAllowed` is. */
export function moveNode(
  tree: LayerNode[],
  id: number,
  parentId: number | null,
  index: number,
): boolean {
  if (!moveAllowed(tree, id, parentId, index)) return false;
  const from = locateNode(tree, id)!;
  const to = childrenOf(tree, parentId)!;
  const [node] = from.siblings.splice(from.index, 1);
  to.splice(to === from.siblings && index > from.index ? index - 1 : index, 0, node);
  return true;
}

/** The array a node dropped into `parentId` joins: the root, or that group's children; null when
 *  it isn't a group. */
function childrenOf(tree: LayerNode[], parentId: number | null): LayerNode[] | null {
  if (parentId === null) return tree;
  const p = locateNode(tree, parentId);
  const parent = p?.siblings[p.index];
  return parent?.type === "group" ? parent.children : null;
}

/** Every node's id in the order the layer panel lists them: top first, a group before its members
 *  (collapsed or not). */
export function rowOrder(tree: LayerNode[]): number[] {
  const ids: number[] = [];
  const list = (nodes: LayerNode[]) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      ids.push(nodes[i].id);
      const n = nodes[i];
      if (n.type === "group") list(n.children);
    }
  };
  list(tree);
  return ids;
}

/** The selected nodes that aren't inside another selected group (a selected group already takes
 *  its members along), top first as the panel lists them. Ids not in the tree are dropped. */
export function topSelection(tree: LayerNode[], ids: Iterable<number>): number[] {
  const set = new Set(ids);
  const out: number[] = [];
  const walk = (nodes: LayerNode[], inside: boolean) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const picked = !inside && set.has(n.id);
      if (picked) out.push(n.id);
      if (n.type === "group") walk(n.children, inside || picked);
    }
  };
  walk(tree, false);
  return out;
}

/** How many drawing layers would be left after removing `ids` (with everything inside them). */
export function layersLeftAfter(tree: LayerNode[], ids: Iterable<number>): number {
  const gone = new Set(topSelection(tree, ids));
  const count = (nodes: LayerNode[]): number =>
    nodes.reduce(
      (sum, n) => (gone.has(n.id) ? sum : sum + (n.type === "layer" ? 1 : count(n.children))),
      0,
    );
  return count(tree);
}

/** Remove the selected nodes (with their members). Returns how many top-level nodes went. */
export function removeNodes(tree: LayerNode[], ids: Iterable<number>): number {
  const top = topSelection(tree, ids);
  for (const id of top) {
    const at = locateNode(tree, id);
    if (at) at.siblings.splice(at.index, 1);
  }
  return top.length;
}

/**
 * Put the selected nodes into `group` (emptied first), in the place of the TOPMOST one, keeping
 * their stacking order even when they came from different groups — as Photoshop's Group Layers
 * with several layers selected (2026-10-02). A selected group comes along whole. False when
 * nothing selected is in the tree.
 */
export function groupNodes(tree: LayerNode[], ids: Iterable<number>, group: LayerGroup): boolean {
  const top = topSelection(tree, ids);
  if (top.length === 0) return false;
  const nodes = top.map((id) => {
    const at = locateNode(tree, id)!;
    return at.siblings[at.index];
  });
  // The group takes the topmost node's place first, so removing the others can't shift it.
  const first = locateNode(tree, top[0])!;
  first.siblings[first.index] = group;
  for (const id of top.slice(1)) {
    const at = locateNode(tree, id);
    if (at) at.siblings.splice(at.index, 1);
  }
  group.children = nodes.reverse(); // bottom first, as every array in the tree
  return true;
}

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

/** Whether node `id` is out of sight: hidden itself, or inside a hidden group. */
export function hiddenInTree(tree: LayerNode[], id: number): boolean {
  const walk = (nodes: LayerNode[], inherited: boolean): boolean | null => {
    for (const n of nodes) {
      const hidden = inherited || !n.visible;
      if (n.id === id) return hidden;
      if (n.type === "group") {
        const found = walk(n.children, hidden);
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

/** Whether two structure snapshots are the same tree: layers by identity, groups by their fields
 *  (groups are cloned per snapshot) and members, and the same active node. An action that changed
 *  nothing (merge down with nothing below, deleting the last layer) must push no undo step: an
 *  empty one wiped the redo stack and made the next Undo look dead. */
export function sameStructure(a: StructSnapshot, b: StructSnapshot): boolean {
  const same = (x: LayerNode[], y: LayerNode[]): boolean =>
    x.length === y.length &&
    x.every((n, i) => {
      const m = y[i];
      if (n.type === "layer" || m.type === "layer") return n === m;
      const { children: nc, ...nf } = n;
      const { children: mc, ...mf } = m;
      const keys = Object.keys(nf) as (keyof typeof nf)[];
      return (
        keys.length === Object.keys(mf).length && keys.every((k) => nf[k] === mf[k]) && same(nc, mc)
      );
    });
  return a.activeId === b.activeId && same(a.tree, b.tree);
}

/** Pixel bytes of the layers `a` holds and `b` doesn't (deleted or merged away): only the undo
 *  step keeps each alive, canvas and all, while it's in history, so it counts toward the budget
 *  (it counted nothing, and 50 deletions could hold 50 whole canvases). An ADDED layer isn't
 *  counted — it lives in the document anyway. */
export function detachedLayerBytes(a: StructSnapshot, b: StructSnapshot): number {
  const layersOf = (nodes: LayerNode[], out = new Set<Layer>()): Set<Layer> => {
    for (const n of nodes) {
      if (n.type === "layer") out.add(n);
      else layersOf(n.children, out);
    }
    return out;
  };
  const x = layersOf(a.tree);
  const y = layersOf(b.tree);
  let bytes = 0;
  for (const l of x) if (!y.has(l)) bytes += l.canvas.width * l.canvas.height * 4;
  return bytes;
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
  /** While a selection is lifted: which layer it belongs to and how to draw it (App wires it to
   *  the Selection). The screen composites that layer WITH the float, so the moving pixels sit in
   *  the layer's place in the stack with its opacity and blend mode. Screen only: exports draw a
   *  float into its layer first (`withFloatApplied`). */
  floatPreview: (() => FloatPreview | null) | null = null;
  /** The float's layer, combined with the float each frame (reused, resized as needed). */
  private floatScratch: HTMLCanvasElement | null = null;

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

  /** Whether `node` is out of sight: hidden, or inside a hidden group. */
  isHidden(node: LayerNode): boolean {
    return hiddenInTree(this.tree, node.id);
  }

  /** A GROUP row is selected. `active` then falls back to the bottom layer, which no pixel action
   *  must take for the target (a stroke landed on Background). */
  get activeIsGroup(): boolean {
    return this.findNode(this.activeId)?.type === "group";
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
    const text = ref.src.text;
    if (text && !text.savedOnly) {
      // `m` maps the raster copy's pixels; the text is drawn in its layout units.
      ctx.scale(img.width / text.layout.width, img.height / text.layout.height);
      drawTextLayout(ctx, text.drawSpec, text.layout);
    } else {
      ctx.imageSmoothingQuality = fast ? "low" : "high";
      ctx.drawImage(img, 0, 0);
    }
    ctx.restore();
  }

  /** Pixels per document unit that the layers are kept at (the layer resolution). */
  get pixelRatio(): number {
    return this.dpr;
  }

  /** Keep the layers at `dpr` pixels per document unit from now on, resampling what's there (a
   *  reference is re-drawn from its original instead, so it loses nothing). */
  setPixelRatio(dpr: number) {
    if (dpr === this.dpr) return;
    this.dpr = dpr;
    const pxW = Math.round(this.docWidth * dpr);
    const pxH = Math.round(this.docHeight * dpr);
    for (const layer of this.flatLayers()) {
      const old = document.createElement("canvas");
      old.width = layer.canvas.width;
      old.height = layer.canvas.height;
      old.getContext("2d")!.drawImage(layer.canvas, 0, 0);
      layer.canvas.width = pxW;
      layer.canvas.height = pxH;
      layer.ctx.resetTransform();
      layer.ctx.imageSmoothingQuality = "high";
      layer.ctx.drawImage(old, 0, 0, pxW, pxH);
      layer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (layer.ref) this.renderRef(layer);
    }
    this.floatScratch = null;
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
    const pxW = Math.round(docW * dpr);
    const pxH = Math.round(docH * dpr);
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

  /**
   * Scale the whole document to `docW`×`docH` (2026-10-02, Document ▸ Resize… in Scale mode):
   * every layer's pixels are resampled to the new size — through halving steps for a large shrink
   * (`halvingSteps`), so it doesn't alias — and every reference keeps its place, its corners scaled
   * with the page and re-drawn from its original, so it stays sharp. `setDocumentSize` is the other
   * mode: it crops or extends around an anchor and moves nothing.
   */
  scaleDocument(docW: number, docH: number) {
    const sx = docW / this.docWidth;
    const sy = docH / this.docHeight;
    this.docWidth = docW;
    this.docHeight = docH;
    const dpr = this.dpr;
    const pxW = Math.round(docW * dpr);
    const pxH = Math.round(docH * dpr);

    for (const layer of this.flatLayers()) {
      let src: HTMLCanvasElement = document.createElement("canvas");
      src.width = layer.canvas.width;
      src.height = layer.canvas.height;
      src.getContext("2d")!.drawImage(layer.canvas, 0, 0);
      const steps = halvingSteps(src.width, src.height, pxW, pxH);
      for (const step of steps.slice(0, -1)) {
        const next = document.createElement("canvas");
        next.width = step.w;
        next.height = step.h;
        const nctx = next.getContext("2d")!;
        nctx.imageSmoothingQuality = "high";
        nctx.drawImage(src, 0, 0, step.w, step.h);
        src = next;
      }
      layer.canvas.width = pxW;
      layer.canvas.height = pxH;
      layer.ctx.resetTransform();
      layer.ctx.imageSmoothingQuality = "high";
      layer.ctx.drawImage(src, 0, 0, pxW, pxH);
      layer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (layer.ref) {
        layer.ref = {
          src: layer.ref.src,
          corners: layer.ref.corners.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Corners,
        };
        this.renderRef(layer);
      }
    }
  }

  createLayer(name?: string): Layer {
    const canvas = document.createElement("canvas");
    const pxW = Math.round(this.docWidth * this.dpr);
    const pxH = Math.round(this.docHeight * this.dpr);
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

  /** Put the active layer or group into a new group in its place (slop-animator's New group). The
   *  active node stays active, so a layer being drawn on still is. Null when nothing is active. */
  groupActive(): LayerGroup | null {
    const group = this.newGroup();
    if (!wrapInGroup(this.tree, this.activeId, group)) return null;
    this.onChange();
    return group;
  }

  private newGroup(name?: string): LayerGroup {
    return {
      type: "group",
      id: nextId++,
      name: name ?? `Group ${this.flatAll().filter((n) => n.type === "group").length + 1}`,
      visible: true,
      opacity: 100,
      children: [],
      collapsed: false,
      locked: false,
    };
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

  /** Delete several rows at once (a selected group with its members), keeping at least one
   *  drawing layer: 0 and nothing removed when none would be left. */
  removeSelected(ids: Iterable<number>): number {
    if (layersLeftAfter(this.tree, ids) < 1) return 0;
    const removed = removeNodes(this.tree, ids);
    if (!this.findNode(this.activeId)) {
      const remaining = this.flatLayers();
      if (remaining.length > 0) this.activeId = remaining[remaining.length - 1].id;
    }
    this.onChange();
    return removed;
  }

  /** Put several rows into a new group in the topmost one's place (`groupNodes`). */
  groupSelected(ids: Iterable<number>): LayerGroup | null {
    const group = this.newGroup();
    if (!groupNodes(this.tree, ids, group)) return null;
    this.onChange();
    return group;
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
    dup.blend = src.blend;
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
    // In its blend mode, so the merge looks as the two layers did (a multiply layer multiplies in).
    below.ctx.globalCompositeOperation = canvasOp(src.blend);
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
    const docPxW = Math.round(this.docWidth * dpr);
    const docPxH = Math.round(this.docHeight * dpr);
    ctx.resetTransform();
    ctx.clearRect(0, 0, docPxW, docPxH);
    this.drawTree(ctx, docPxW, docPxH, this.floatPreview?.() ?? null);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** `layer` with the float drawn onto it, on the reused scratch canvas. */
  private withFloat(layer: Layer, float: FloatPreview): HTMLCanvasElement {
    let s = this.floatScratch;
    if (!s) s = this.floatScratch = document.createElement("canvas");
    if (s.width !== layer.canvas.width || s.height !== layer.canvas.height) {
      s.width = layer.canvas.width;
      s.height = layer.canvas.height;
    }
    const c = s.getContext("2d")!;
    c.resetTransform();
    c.clearRect(0, 0, s.width, s.height);
    c.drawImage(layer.canvas, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); // the float draws in document units
    float.render(c);
    return s;
  }

  /**
   * Draw the whole document onto `ctx` at `w` × `h` pixels — the ONE way layers are combined: the
   * screen (at the canvas's own size), the PNG export and a PSD's flattened preview (at document
   * size) all use it. Hidden layers and groups are skipped, a group's opacity multiplies its
   * members', and each layer draws in its blend mode; a group has none of its own ("pass through":
   * its members blend straight into what's below). The export paths used to loop the layers alone
   * and missed group visibility and opacity — a hidden group still showed in the PNG.
   */
  drawTree(ctx: CanvasRenderingContext2D, w: number, h: number, float: FloatPreview | null = null) {
    ctx.save();
    ctx.resetTransform();
    const drawNodes = (nodes: LayerNode[], parentAlpha: number) => {
      for (const node of nodes) {
        if (!node.visible) continue;
        const alpha = parentAlpha * (node.opacity / 100);
        if (node.type === "layer") {
          if (node.canvas.width === 0 || node.canvas.height === 0) continue;
          ctx.globalAlpha = alpha;
          ctx.globalCompositeOperation = canvasOp(node.blend);
          const source = float?.layerId === node.id ? this.withFloat(node, float) : node.canvas;
          ctx.drawImage(source, 0, 0, w, h);
        } else {
          drawNodes(node.children, alpha);
        }
      }
    };
    drawNodes(this.tree, 1);
    ctx.restore();
  }

  /** Pixels of one layer (not just the active one), for undo. */
  snapshotOf(layer: Layer): ImageData {
    return layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  }

  /** Put pixels back on one layer, at (`x`, `y`) in canvas pixels for a partial snapshot.
   *  putImageData ignores the ctx transform. */
  restoreTo(layer: Layer, data: ImageData, x = 0, y = 0) {
    layer.ctx.putImageData(data, x, y);
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
