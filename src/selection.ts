/**
 * Selection & Transform system.
 * - Rectangle select: drag to create
 * - Lasso select: freehand path
 * - Move: drag inside selection
 * - Scale: drag corner handles
 * - Rotate: drag rotation handle
 * - Enter to commit, Escape to cancel
 */

export interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Transform {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  rotation: number;
}

export type SelectionMode = "rect" | "lasso";

type Handle = "tl" | "tr" | "bl" | "br" | "rotate" | "move" | null;

const HANDLE_SIZE = 8;
const ROTATE_OFFSET = 20;

export class Selection {
  rect: SelectionRect | null = null;
  transform: Transform = { tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0 };
  floatingPixels: HTMLCanvasElement | null = null;
  mode: SelectionMode = "rect";

  /** Lasso path points (CSS coords) */
  private lassoPoints: { x: number; y: number }[] = [];
  /** Closed lasso path for clipping */
  private lassoPath: Path2D | null = null;

  private dragging: Handle = null;
  private dragStart = { x: 0, y: 0 };
  private transformStart: Transform = { tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0 };
  private isCreating = false;
  private createStart = { x: 0, y: 0 };
  private marchOffset = 0;
  private animFrame = 0;

  private overlayCanvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;

  onCommit: ((pixels: HTMLCanvasElement, rect: SelectionRect, transform: Transform) => void) | null = null;
  onCancel: (() => void) | null = null;
  onChange: (() => void) | null = null;

  constructor(overlayCanvas: HTMLCanvasElement) {
    this.overlayCanvas = overlayCanvas;
    this.overlayCtx = overlayCanvas.getContext("2d")!;
  }

  get active(): boolean {
    return this.rect !== null;
  }

  get hasFloating(): boolean {
    return this.floatingPixels !== null;
  }

  startCreate(x: number, y: number) {
    this.cancel();
    this.isCreating = true;
    this.createStart = { x, y };
    this.rect = { x, y, w: 0, h: 0 };
    this.lassoPoints = [{ x, y }];
    this.lassoPath = null;
  }

  updateCreate(x: number, y: number) {
    if (!this.isCreating) return;

    if (this.mode === "lasso") {
      this.lassoPoints.push({ x, y });
      // Update bounding rect from lasso points
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of this.lassoPoints) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      this.rect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    } else {
      const sx = Math.min(this.createStart.x, x);
      const sy = Math.min(this.createStart.y, y);
      const w = Math.abs(x - this.createStart.x);
      const h = Math.abs(y - this.createStart.y);
      this.rect = { x: sx, y: sy, w, h };
    }
    this.drawOverlay();
  }

  endCreate() {
    this.isCreating = false;
    if (this.rect && (this.rect.w < 3 || this.rect.h < 3)) {
      this.rect = null;
      this.lassoPoints = [];
      this.lassoPath = null;
    }
    // Build lasso clip path
    if (this.mode === "lasso" && this.lassoPoints.length > 2) {
      const path = new Path2D();
      path.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);
      for (let i = 1; i < this.lassoPoints.length; i++) {
        path.lineTo(this.lassoPoints[i].x, this.lassoPoints[i].y);
      }
      path.closePath();
      this.lassoPath = path;
    }
    this.drawOverlay();
  }

  /** Lift pixels from source canvas, using lasso clip if available */
  liftPixels(srcCtx: CanvasRenderingContext2D, dpr: number) {
    if (!this.rect) return;
    const r = this.rect;
    const px = Math.round(r.x * dpr);
    const py = Math.round(r.y * dpr);
    const pw = Math.round(r.w * dpr);
    const ph = Math.round(r.h * dpr);
    if (pw <= 0 || ph <= 0) return;

    // Copy pixels with optional lasso clipping
    const cvs = document.createElement("canvas");
    cvs.width = pw;
    cvs.height = ph;
    const ctx = cvs.getContext("2d")!;

    if (this.lassoPath) {
      // Build a scaled/offset clip path
      ctx.save();
      ctx.beginPath();
      const clipPath = new Path2D();
      for (let i = 0; i < this.lassoPoints.length; i++) {
        const lx = (this.lassoPoints[i].x - r.x) * dpr;
        const ly = (this.lassoPoints[i].y - r.y) * dpr;
        if (i === 0) clipPath.moveTo(lx, ly);
        else clipPath.lineTo(lx, ly);
      }
      clipPath.closePath();
      ctx.clip(clipPath);
      ctx.drawImage(srcCtx.canvas, px, py, pw, ph, 0, 0, pw, ph);
      ctx.restore();

      // Clear lasso region from source using the same clip
      srcCtx.save();
      srcCtx.beginPath();
      const srcClip = new Path2D();
      for (let i = 0; i < this.lassoPoints.length; i++) {
        const lx = this.lassoPoints[i].x * dpr;
        const ly = this.lassoPoints[i].y * dpr;
        if (i === 0) srcClip.moveTo(lx, ly);
        else srcClip.lineTo(lx, ly);
      }
      srcClip.closePath();

      // Scale the clip path for DPR
      srcCtx.resetTransform();
      srcCtx.clip(srcClip);
      srcCtx.clearRect(0, 0, srcCtx.canvas.width, srcCtx.canvas.height);
      srcCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      srcCtx.restore();
    } else {
      ctx.drawImage(srcCtx.canvas, px, py, pw, ph, 0, 0, pw, ph);
      srcCtx.clearRect(r.x, r.y, r.w, r.h);
    }

    this.floatingPixels = cvs;
    this.transform = { tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0 };
  }

  hitTest(x: number, y: number): Handle {
    if (!this.rect) return null;
    const r = this.rect;
    const t = this.transform;

    const cx = r.x + r.w / 2 + t.tx;
    const cy = r.y + r.h / 2 + t.ty;
    const hw = (r.w / 2) * t.sx;
    const hh = (r.h / 2) * t.sy;
    const cos = Math.cos(t.rotation);
    const sin = Math.sin(t.rotation);

    const corners: { handle: Handle; x: number; y: number }[] = [
      { handle: "tl", x: cx + (-hw) * cos - (-hh) * sin, y: cy + (-hw) * sin + (-hh) * cos },
      { handle: "tr", x: cx + (hw) * cos - (-hh) * sin, y: cy + (hw) * sin + (-hh) * cos },
      { handle: "bl", x: cx + (-hw) * cos - (hh) * sin, y: cy + (-hw) * sin + (hh) * cos },
      { handle: "br", x: cx + (hw) * cos - (hh) * sin, y: cy + (hw) * sin + (hh) * cos },
    ];

    const rotX = cx - (-hh - ROTATE_OFFSET) * sin;
    const rotY = cy + (-hh - ROTATE_OFFSET) * cos;
    if ((x - rotX) ** 2 + (y - rotY) ** 2 < (HANDLE_SIZE + 4) ** 2) return "rotate";

    for (const c of corners) {
      if (Math.abs(x - c.x) < HANDLE_SIZE + 2 && Math.abs(y - c.y) < HANDLE_SIZE + 2) {
        return c.handle;
      }
    }

    const dx = x - cx;
    const dy = y - cy;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    if (Math.abs(localX) <= hw && Math.abs(localY) <= hh) return "move";

    return null;
  }

  startDrag(handle: Handle, x: number, y: number) {
    this.dragging = handle;
    this.dragStart = { x, y };
    this.transformStart = { ...this.transform };
  }

  updateDrag(x: number, y: number) {
    if (!this.dragging || !this.rect) return;
    const r = this.rect;
    const t = this.transformStart;

    switch (this.dragging) {
      case "move":
        this.transform.tx = t.tx + (x - this.dragStart.x);
        this.transform.ty = t.ty + (y - this.dragStart.y);
        break;

      case "tl": case "tr": case "bl": case "br": {
        const cx = r.x + r.w / 2 + t.tx;
        const cy = r.y + r.h / 2 + t.ty;
        const startDist = Math.sqrt((this.dragStart.x - cx) ** 2 + (this.dragStart.y - cy) ** 2);
        const currDist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (startDist > 0) {
          const scale = currDist / startDist;
          this.transform.sx = t.sx * scale;
          this.transform.sy = t.sy * scale;
        }
        break;
      }

      case "rotate": {
        const cx = r.x + r.w / 2 + t.tx;
        const cy = r.y + r.h / 2 + t.ty;
        const startAngle = Math.atan2(this.dragStart.y - cy, this.dragStart.x - cx);
        const currAngle = Math.atan2(y - cy, x - cx);
        this.transform.rotation = t.rotation + (currAngle - startAngle);
        break;
      }
    }

    this.drawOverlay();
    this.onChange?.();
  }

  endDrag() {
    this.dragging = null;
  }

  commit() {
    if (this.rect && this.floatingPixels) {
      this.onCommit?.(this.floatingPixels, this.rect, this.transform);
    }
    this.clear();
  }

  cancel() {
    if (this.hasFloating) {
      this.onCancel?.();
    }
    this.clear();
  }

  private clear() {
    this.rect = null;
    this.floatingPixels = null;
    this.lassoPoints = [];
    this.lassoPath = null;
    this.transform = { tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0 };
    this.isCreating = false;
    this.dragging = null;
    cancelAnimationFrame(this.animFrame);
    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
  }

  getCursor(handle: Handle): string {
    switch (handle) {
      case "move": return "move";
      case "rotate": return "crosshair";
      case "tl": case "br": return "nwse-resize";
      case "tr": case "bl": return "nesw-resize";
      default: return "crosshair";
    }
  }

  drawOverlay() {
    const ctx = this.overlayCtx;
    const cvs = this.overlayCanvas;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    if (!this.rect) return;

    const r = this.rect;
    const t = this.transform;
    const cx = r.x + r.w / 2 + t.tx;
    const cy = r.y + r.h / 2 + t.ty;
    const hw = (r.w / 2) * t.sx;
    const hh = (r.h / 2) * t.sy;

    ctx.save();

    // If still creating a lasso, draw the path being traced
    if (this.isCreating && this.mode === "lasso" && this.lassoPoints.length > 1) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);
      for (let i = 1; i < this.lassoPoints.length; i++) {
        ctx.lineTo(this.lassoPoints[i].x, this.lassoPoints[i].y);
      }
      ctx.stroke();
      ctx.strokeStyle = "#000";
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -this.marchOffset;
      ctx.beginPath();
      ctx.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);
      for (let i = 1; i < this.lassoPoints.length; i++) {
        ctx.lineTo(this.lassoPoints[i].x, this.lassoPoints[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      this.marchOffset = (this.marchOffset + 0.3) % 8;
      this.animFrame = requestAnimationFrame(() => this.drawOverlay());
      return;
    }

    ctx.translate(cx, cy);
    ctx.rotate(t.rotation);

    // Draw floating pixels preview
    if (this.floatingPixels) {
      ctx.drawImage(this.floatingPixels, -hw, -hh, hw * 2, hh * 2);
    }

    // Marching ants — use lasso path if available, else rectangle
    if (this.lassoPath && !this.floatingPixels) {
      // Draw lasso outline offset by transform
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < this.lassoPoints.length; i++) {
        const lx = this.lassoPoints[i].x + t.tx;
        const ly = this.lassoPoints[i].y + t.ty;
        if (i === 0) ctx.moveTo(lx, ly);
        else ctx.lineTo(lx, ly);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = "#000";
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -this.marchOffset;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t.rotation);
    } else {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
      ctx.strokeStyle = "#000";
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -this.marchOffset;
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
      ctx.setLineDash([]);
    }

    // Corner handles
    const corners = [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]];
    for (const [hx, hy] of corners) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.strokeRect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    }

    // Rotation handle
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.lineTo(0, -hh - ROTATE_OFFSET);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = "#000";
    ctx.setLineDash([2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(0, -hh - ROTATE_OFFSET, HANDLE_SIZE / 2, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();

    this.marchOffset = (this.marchOffset + 0.3) % 8;
    this.animFrame = requestAnimationFrame(() => this.drawOverlay());
  }
}
