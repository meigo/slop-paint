/**
 * Viewport: zoom and pan.
 * Uses CSS transform: matrix() for predictable coordinate mapping.
 * Transform origin is top-left (0,0) to simplify the math.
 */

export class Viewport {
  zoom = 1;
  // Pan in screen pixels (how far the canvas origin has moved on screen)
  panX = 0;
  panY = 0;

  private target: HTMLElement;
  private parent: HTMLElement;
  private minZoom = 0.1;
  private maxZoom = 20;

  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panStartPanX = 0;
  private panStartPanY = 0;

  onChange: (() => void) | null = null;

  constructor(target: HTMLElement) {
    this.target = target;
    this.parent = target.parentElement!;
    this.applyTransform();
  }

  /** Convert screen (client) coords to canvas (logical) coords */
  screenToCanvas(sx: number, sy: number): { x: number; y: number } {
    const rect = this.parent.getBoundingClientRect();
    // Point relative to the parent's top-left
    const rx = sx - rect.left;
    const ry = sy - rect.top;
    // The CSS transform is: translate(panX, panY) then scale(zoom) from top-left origin.
    // So screen point = pan + canvasPoint * zoom
    // Therefore canvasPoint = (screenPoint - pan) / zoom
    const x = (rx - this.panX) / this.zoom;
    const y = (ry - this.panY) / this.zoom;
    return { x, y };
  }

  /** Zoom toward a screen point, keeping that point fixed */
  zoomAt(screenX: number, screenY: number, delta: number) {
    const rect = this.parent.getBoundingClientRect();
    const rx = screenX - rect.left;
    const ry = screenY - rect.top;

    // Canvas point under cursor before zoom
    const cx = (rx - this.panX) / this.zoom;
    const cy = (ry - this.panY) / this.zoom;

    const oldZoom = this.zoom;
    const factor = delta > 0 ? 0.9 : 1.1;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, oldZoom * factor));

    // Adjust pan so the same canvas point stays under cursor
    this.panX = rx - cx * this.zoom;
    this.panY = ry - cy * this.zoom;

    this.applyTransform();
    this.onChange?.();
  }

  setZoom(z: number) {
    // Zoom toward center of viewport
    const rect = this.parent.getBoundingClientRect();
    const rx = rect.width / 2;
    const ry = rect.height / 2;
    const cx = (rx - this.panX) / this.zoom;
    const cy = (ry - this.panY) / this.zoom;

    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, z));

    this.panX = rx - cx * this.zoom;
    this.panY = ry - cy * this.zoom;

    this.applyTransform();
    this.onChange?.();
  }

  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
    this.onChange?.();
  }

  startPan(screenX: number, screenY: number) {
    this.isPanning = true;
    this.panStartX = screenX;
    this.panStartY = screenY;
    this.panStartPanX = this.panX;
    this.panStartPanY = this.panY;
  }

  updatePan(screenX: number, screenY: number) {
    if (!this.isPanning) return;
    this.panX = this.panStartPanX + (screenX - this.panStartX);
    this.panY = this.panStartPanY + (screenY - this.panStartY);
    this.applyTransform();
    this.onChange?.();
  }

  endPan() {
    this.isPanning = false;
  }

  get panning(): boolean {
    return this.isPanning;
  }

  private applyTransform() {
    this.target.style.transformOrigin = "0 0";
    this.target.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }
}
