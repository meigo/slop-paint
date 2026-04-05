import { History } from "./history";

export interface Layer {
  id: number;
  name: string;
  group: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  visible: boolean;
  opacity: number;
  history: History;
}

let nextId = 1;

export class LayerManager {
  layers: Layer[] = [];
  activeIndex = 0;
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

  get active(): Layer {
    return this.layers[this.activeIndex];
  }

  resize(cssWidth: number, cssHeight: number, dpr: number) {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = dpr;

    const pxW = cssWidth * dpr;
    const pxH = cssHeight * dpr;

    for (const layer of this.layers) {
      // Preserve content
      const tmp = document.createElement("canvas");
      tmp.width = layer.canvas.width;
      tmp.height = layer.canvas.height;
      tmp.getContext("2d")!.drawImage(layer.canvas, 0, 0);

      layer.canvas.width = pxW;
      layer.canvas.height = pxH;
      layer.ctx.scale(dpr, dpr);
      // Restore
      layer.ctx.resetTransform();
      layer.ctx.drawImage(tmp, 0, 0);
      layer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  addLayer(name?: string): Layer {
    const canvas = document.createElement("canvas");
    const pxW = this.cssWidth * this.dpr;
    const pxH = this.cssHeight * this.dpr;
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.scale(this.dpr, this.dpr);

    const layer: Layer = {
      id: nextId++,
      name: name ?? `Layer ${this.layers.length + 1}`,
      group: "",
      canvas,
      ctx,
      visible: true,
      opacity: 100,
      history: new History(),
    };

    this.layers.push(layer);
    this.activeIndex = this.layers.length - 1;
    this.onChange();
    return layer;
  }

  removeLayer(index: number) {
    if (this.layers.length <= 1) return;
    this.layers.splice(index, 1);
    if (this.activeIndex >= this.layers.length) {
      this.activeIndex = this.layers.length - 1;
    }
    this.onChange();
  }

  moveLayer(from: number, to: number) {
    if (to < 0 || to >= this.layers.length) return;
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(to, 0, layer);
    this.activeIndex = to;
    this.onChange();
  }

  setActive(index: number) {
    this.activeIndex = index;
    this.onChange();
  }

  toggleVisibility(index: number) {
    this.layers[index].visible = !this.layers[index].visible;
    this.composite();
    this.onChange();
  }

  setLayerOpacity(index: number, opacity: number) {
    this.layers[index].opacity = opacity;
    this.composite();
    this.onChange();
  }

  /** Flatten all visible layers onto the display canvas */
  composite() {
    const w = this.cssWidth;
    const h = this.cssHeight;
    const dpr = this.dpr;
    const ctx = this.displayCtx;

    ctx.resetTransform();
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const layer of this.layers) {
      if (!layer.visible || layer.canvas.width === 0 || layer.canvas.height === 0) continue;
      ctx.globalAlpha = layer.opacity / 100;
      ctx.resetTransform();
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ctx.globalAlpha = 1;
  }

  /** Get snapshot of the active layer */
  getSnapshot(): ImageData {
    const layer = this.active;
    return layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  }

  /** Restore snapshot to the active layer */
  restoreSnapshot(data: ImageData) {
    this.active.ctx.putImageData(data, 0, 0);
  }
}
