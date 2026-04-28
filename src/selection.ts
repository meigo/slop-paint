/**
 * Selection & Transform system.
 *
 * Two-stage flow:
 *   1. Select: drag rect or lasso path → marching ants on the actual shape (no lift, no handles).
 *   2. Transform: drag inside the selection → pixels are lifted into a floating canvas;
 *      bounding-box handles appear (corners=non-uniform scale, sides=skew, rotate handle, drag inside=move).
 *
 * Transform is a 6-parameter affine matrix applied around the rect's local coordinates.
 * Press Enter to commit, Escape to cancel.
 */

export interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 2D affine matrix [[a, c, e], [b, d, f], [0, 0, 1]]. */
export interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export type SelectionMode = "rect" | "lasso";
export type SelectionState = "idle" | "selected" | "transforming" | "warping";

type Handle = "tl" | "tr" | "bl" | "br" | "t" | "b" | "l" | "r" | "rotate" | "move" | null;

/** Corner indices for warpCorners[]: TL, TR, BR, BL. */
type CornerIdx = 0 | 1 | 2 | 3;

const HANDLE_SIZE = 8;
const ROTATE_OFFSET = 20;

const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function identity(): Mat {
  return { ...IDENTITY };
}

function multiply(a: Mat, b: Mat): Mat {
  return {
    a: a.a * b.a + a.c * b.b,
    b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d,
    d: a.b * b.c + a.d * b.d,
    e: a.a * b.e + a.c * b.f + a.e,
    f: a.b * b.e + a.d * b.f + a.f,
  };
}

function applyPoint(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

function invert(m: Mat): Mat {
  const det = m.a * m.d - m.b * m.c;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** Transform a vector (no translation) by the linear part of m. */
function applyVec(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y, y: m.b * x + m.d * y };
}

/** Inverse of the linear (2x2) part applied to a vector. */
function invertVec(m: Mat, x: number, y: number): { x: number; y: number } {
  const det = m.a * m.d - m.b * m.c;
  return { x: (m.d * x - m.c * y) / det, y: (-m.b * x + m.a * y) / det };
}

export class Selection {
  state: SelectionState = "idle";
  rect: SelectionRect | null = null;
  mode: SelectionMode = "rect";
  matrix: Mat = identity();
  /** Warp control points in CSS coords: [TL, TR, BR, BL]. Only meaningful in 'warping' state. */
  warpCorners: { x: number; y: number }[] = [];
  floatingPixels: HTMLCanvasElement | null = null;

  /** Lasso path points (CSS coords) */
  private lassoPoints: { x: number; y: number }[] = [];
  /** Closed lasso path for clipping/hit-testing */
  private lassoPath: Path2D | null = null;

  private dragging: Handle = null;
  private dragCornerIdx: CornerIdx | null = null;
  private dragStart = { x: 0, y: 0 };
  private matrixStart: Mat = identity();
  private warpCornersStart: { x: number; y: number }[] = [];
  private isCreating = false;
  private createStart = { x: 0, y: 0 };
  private marchOffset = 0;
  private animFrame = 0;

  private overlayCanvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;

  onCommit: (() => void) | null = null;
  onCancel: (() => void) | null = null;
  onChange: (() => void) | null = null;

  constructor(overlayCanvas: HTMLCanvasElement) {
    this.overlayCanvas = overlayCanvas;
    this.overlayCtx = overlayCanvas.getContext("2d")!;
  }

  get active(): boolean {
    return this.state !== "idle";
  }

  get hasFloating(): boolean {
    return (this.state === "transforming" || this.state === "warping") && this.floatingPixels !== null;
  }

  /** Begin creating a new selection (clears any existing one). */
  startCreate(x: number, y: number) {
    this.cancel();
    this.isCreating = true;
    this.createStart = { x, y };
    this.rect = { x, y, w: 0, h: 0 };
    this.lassoPoints = [{ x, y }];
    this.lassoPath = null;
    this.state = "selected";
  }

  updateCreate(x: number, y: number) {
    if (!this.isCreating) return;

    if (this.mode === "lasso") {
      this.lassoPoints.push({ x, y });
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
    if (!this.rect || this.rect.w < 3 || this.rect.h < 3) {
      this.clear();
      return;
    }
    if (this.mode === "lasso" && this.lassoPoints.length > 2) {
      const path = new Path2D();
      path.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);
      for (let i = 1; i < this.lassoPoints.length; i++) {
        path.lineTo(this.lassoPoints[i].x, this.lassoPoints[i].y);
      }
      path.closePath();
      this.lassoPath = path;
    }
    this.matrix = identity();
    this.drawOverlay();
  }

  /**
   * Lift pixels from source canvas into a new canvas (using lasso clip if available).
   * The source canvas is cleared in the lifted region. Returns the lifted canvas.
   * Caller is responsible for passing the result to beginTransform().
   */
  liftPixels(srcCtx: CanvasRenderingContext2D, dpr: number): HTMLCanvasElement | null {
    if (!this.rect) return null;
    const r = this.rect;
    const px = Math.round(r.x * dpr);
    const py = Math.round(r.y * dpr);
    const pw = Math.round(r.w * dpr);
    const ph = Math.round(r.h * dpr);
    if (pw <= 0 || ph <= 0) return null;

    const cvs = document.createElement("canvas");
    cvs.width = pw;
    cvs.height = ph;
    const ctx = cvs.getContext("2d")!;

    if (this.lassoPath) {
      ctx.save();
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

      srcCtx.save();
      const srcClip = new Path2D();
      for (let i = 0; i < this.lassoPoints.length; i++) {
        const lx = this.lassoPoints[i].x * dpr;
        const ly = this.lassoPoints[i].y * dpr;
        if (i === 0) srcClip.moveTo(lx, ly);
        else srcClip.lineTo(lx, ly);
      }
      srcClip.closePath();
      srcCtx.resetTransform();
      srcCtx.clip(srcClip);
      srcCtx.clearRect(0, 0, srcCtx.canvas.width, srcCtx.canvas.height);
      srcCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      srcCtx.restore();
    } else {
      ctx.drawImage(srcCtx.canvas, px, py, pw, ph, 0, 0, pw, ph);
      srcCtx.clearRect(r.x, r.y, r.w, r.h);
    }

    return cvs;
  }

  /** Enter the transforming state with the lifted pixels. */
  beginTransform(pixels: HTMLCanvasElement) {
    this.floatingPixels = pixels;
    this.matrix = identity();
    this.state = "transforming";
    this.drawOverlay();
  }

  /**
   * Switch to free-corner warp (4-corner distort). Initializes warp corners
   * from the current matrix-transformed rect corners. Requires lifted pixels.
   */
  beginWarp() {
    if (!this.rect || !this.floatingPixels) return;
    const r = this.rect;
    this.warpCorners = [
      applyPoint(this.matrix, r.x, r.y),
      applyPoint(this.matrix, r.x + r.w, r.y),
      applyPoint(this.matrix, r.x + r.w, r.y + r.h),
      applyPoint(this.matrix, r.x, r.y + r.h),
    ];
    this.state = "warping";
    this.drawOverlay();
  }

  hitTest(x: number, y: number): Handle {
    if (!this.rect) return null;

    if (this.state === "selected") {
      // No handles in 'selected' state — only inside/outside the actual shape.
      if (this.mode === "lasso" && this.lassoPath) {
        return this.overlayCtx.isPointInPath(this.lassoPath, x, y) ? "move" : null;
      }
      const r = this.rect;
      return (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) ? "move" : null;
    }

    if (this.state === "warping") {
      const wc = this.warpCorners;
      const cornerHandles: { handle: Handle; p: { x: number; y: number } }[] = [
        { handle: "tl", p: wc[0] },
        { handle: "tr", p: wc[1] },
        { handle: "br", p: wc[2] },
        { handle: "bl", p: wc[3] },
      ];
      for (const c of cornerHandles) {
        if (Math.abs(x - c.p.x) < HANDLE_SIZE + 2 && Math.abs(y - c.p.y) < HANDLE_SIZE + 2) {
          return c.handle;
        }
      }
      return this.pointInsideQuad(x, y, wc) ? "move" : null;
    }

    if (this.state !== "transforming") return null;

    const corners = this.transformedCorners();
    const sides = this.transformedSides(corners);
    const rotateHandle = this.rotateHandlePos(corners);

    if ((x - rotateHandle.x) ** 2 + (y - rotateHandle.y) ** 2 < (HANDLE_SIZE + 4) ** 2) return "rotate";

    const cornerHandles: { handle: Handle; p: { x: number; y: number } }[] = [
      { handle: "tl", p: corners.tl },
      { handle: "tr", p: corners.tr },
      { handle: "bl", p: corners.bl },
      { handle: "br", p: corners.br },
    ];
    for (const c of cornerHandles) {
      if (Math.abs(x - c.p.x) < HANDLE_SIZE + 2 && Math.abs(y - c.p.y) < HANDLE_SIZE + 2) {
        return c.handle;
      }
    }

    const sideHandles: { handle: Handle; p: { x: number; y: number } }[] = [
      { handle: "t", p: sides.t },
      { handle: "b", p: sides.b },
      { handle: "l", p: sides.l },
      { handle: "r", p: sides.r },
    ];
    for (const s of sideHandles) {
      if (Math.abs(x - s.p.x) < HANDLE_SIZE + 2 && Math.abs(y - s.p.y) < HANDLE_SIZE + 2) {
        return s.handle;
      }
    }

    // Inside the transformed bounding box → move.
    return this.pointInsideTransformedBox(x, y) ? "move" : null;
  }

  startDrag(handle: Handle, x: number, y: number) {
    this.dragging = handle;
    this.dragStart = { x, y };
    this.matrixStart = { ...this.matrix };
    this.warpCornersStart = this.warpCorners.map((p) => ({ ...p }));
    this.dragCornerIdx =
      handle === "tl" ? 0 :
      handle === "tr" ? 1 :
      handle === "br" ? 2 :
      handle === "bl" ? 3 : null;
  }

  updateDrag(x: number, y: number) {
    if (!this.dragging || !this.rect) return;
    const dx = x - this.dragStart.x;
    const dy = y - this.dragStart.y;

    if (this.state === "warping") {
      if (this.dragging === "move") {
        this.warpCorners = this.warpCornersStart.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      } else if (this.dragCornerIdx !== null) {
        const idx = this.dragCornerIdx;
        this.warpCorners = this.warpCornersStart.map((p, i) =>
          i === idx ? { x: p.x + dx, y: p.y + dy } : { ...p }
        );
      }
      this.drawOverlay();
      this.onChange?.();
      return;
    }

    if (this.state !== "transforming") return;
    const r = this.rect;

    switch (this.dragging) {
      case "move": {
        this.matrix = { ...this.matrixStart, e: this.matrixStart.e + dx, f: this.matrixStart.f + dy };
        break;
      }

      case "tl": case "tr": case "bl": case "br": {
        // Non-uniform scale around the opposite corner (in local rect coords).
        const ax = this.dragging === "tl" || this.dragging === "bl" ? r.x + r.w : r.x;
        const ay = this.dragging === "tl" || this.dragging === "tr" ? r.y + r.h : r.y;
        const dragLocalX = this.dragging === "tl" || this.dragging === "bl" ? r.x : r.x + r.w;
        const dragLocalY = this.dragging === "tl" || this.dragging === "tr" ? r.y : r.y + r.h;

        const mouseLocal = applyPoint(invert(this.matrixStart), x, y);
        const denomX = dragLocalX - ax;
        const denomY = dragLocalY - ay;
        const sx = denomX !== 0 ? (mouseLocal.x - ax) / denomX : 1;
        const sy = denomY !== 0 ? (mouseLocal.y - ay) / denomY : 1;

        // S = T(ax, ay) * Scale(sx, sy) * T(-ax, -ay)
        const scale: Mat = { a: sx, b: 0, c: 0, d: sy, e: ax * (1 - sx), f: ay * (1 - sy) };
        this.matrix = multiply(this.matrixStart, scale);
        break;
      }

      case "l": case "r": {
        // Drag a vertical side; the opposite vertical side is anchored.
        // Translate the dragged side by (dx, dy) in world coords, leaving the opposite side fixed.
        const dl = invertVec(this.matrixStart, dx, dy);
        const ax = this.dragging === "r" ? r.x : r.x + r.w; // anchored x in local coords
        const sign = this.dragging === "r" ? 1 : -1;
        // T_local: a' = 1 + sign*dl.x/rw, b' = sign*dl.y/rw, c'=0, d'=1, e' = -ax*sign*dl.x/rw + (anchor offset)
        // Derivation in commit message.
        const k = sign / r.w;
        const tLocal: Mat = {
          a: 1 + dl.x * k,
          b: dl.y * k,
          c: 0,
          d: 1,
          e: -ax * dl.x * k,
          f: -ax * dl.y * k,
        };
        this.matrix = multiply(this.matrixStart, tLocal);
        break;
      }

      case "t": case "b": {
        const dl = invertVec(this.matrixStart, dx, dy);
        const ay = this.dragging === "b" ? r.y : r.y + r.h;
        const sign = this.dragging === "b" ? 1 : -1;
        const k = sign / r.h;
        const tLocal: Mat = {
          a: 1,
          b: 0,
          c: dl.x * k,
          d: 1 + dl.y * k,
          e: -ay * dl.x * k,
          f: -ay * dl.y * k,
        };
        this.matrix = multiply(this.matrixStart, tLocal);
        break;
      }

      case "rotate": {
        const center = applyPoint(this.matrixStart, r.x + r.w / 2, r.y + r.h / 2);
        const startAngle = Math.atan2(this.dragStart.y - center.y, this.dragStart.x - center.x);
        const currAngle = Math.atan2(y - center.y, x - center.x);
        const theta = currAngle - startAngle;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        // Rotate around world center: M_new = T(c) * R(theta) * T(-c) * M_start
        const tx = center.x - cos * center.x + sin * center.y;
        const ty = center.y - sin * center.x - cos * center.y;
        const rotWorld: Mat = { a: cos, b: sin, c: -sin, d: cos, e: tx, f: ty };
        this.matrix = multiply(rotWorld, this.matrixStart);
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
    if (this.hasFloating) {
      this.onCommit?.();
    }
    this.clear();
  }

  cancel() {
    if (this.hasFloating) {
      this.onCancel?.();
    }
    this.clear();
  }

  /** Render the floating pixels into the given context, applying the current transform/warp. */
  renderFloatingTo(ctx: CanvasRenderingContext2D) {
    if (!this.floatingPixels || !this.rect) return;
    if (this.state === "transforming") {
      const m = this.matrix;
      ctx.save();
      ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.drawImage(this.floatingPixels, this.rect.x, this.rect.y, this.rect.w, this.rect.h);
      ctx.restore();
    } else if (this.state === "warping") {
      drawWarpedQuad(ctx, this.floatingPixels, this.rect, this.warpCorners);
    }
  }

  private clear() {
    this.rect = null;
    this.floatingPixels = null;
    this.lassoPoints = [];
    this.lassoPath = null;
    this.matrix = identity();
    this.warpCorners = [];
    this.warpCornersStart = [];
    this.dragCornerIdx = null;
    this.isCreating = false;
    this.dragging = null;
    this.state = "idle";
    cancelAnimationFrame(this.animFrame);
    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
  }

  getCursor(handle: Handle): string {
    switch (handle) {
      case "move": return "move";
      case "rotate": return "crosshair";
      case "tl": case "br": return "nwse-resize";
      case "tr": case "bl": return "nesw-resize";
      case "l": case "r": return "ew-resize";
      case "t": case "b": return "ns-resize";
      default: return "crosshair";
    }
  }

  private transformedCorners() {
    const r = this.rect!;
    const m = this.matrix;
    return {
      tl: applyPoint(m, r.x, r.y),
      tr: applyPoint(m, r.x + r.w, r.y),
      bl: applyPoint(m, r.x, r.y + r.h),
      br: applyPoint(m, r.x + r.w, r.y + r.h),
    };
  }

  private transformedSides(c: ReturnType<Selection["transformedCorners"]>) {
    return {
      t: { x: (c.tl.x + c.tr.x) / 2, y: (c.tl.y + c.tr.y) / 2 },
      b: { x: (c.bl.x + c.br.x) / 2, y: (c.bl.y + c.br.y) / 2 },
      l: { x: (c.tl.x + c.bl.x) / 2, y: (c.tl.y + c.bl.y) / 2 },
      r: { x: (c.tr.x + c.br.x) / 2, y: (c.tr.y + c.br.y) / 2 },
    };
  }

  private rotateHandlePos(c: ReturnType<Selection["transformedCorners"]>) {
    // Outward normal at the top edge: -local_y direction transformed.
    const n = applyVec(this.matrix, 0, -1);
    const len = Math.hypot(n.x, n.y) || 1;
    const top = { x: (c.tl.x + c.tr.x) / 2, y: (c.tl.y + c.tr.y) / 2 };
    return { x: top.x + (n.x / len) * ROTATE_OFFSET, y: top.y + (n.y / len) * ROTATE_OFFSET };
  }

  private pointInsideTransformedBox(x: number, y: number): boolean {
    // Map world point back to local rect coords; check against the rect bounds.
    const r = this.rect!;
    const local = applyPoint(invert(this.matrix), x, y);
    return local.x >= r.x && local.x <= r.x + r.w && local.y >= r.y && local.y <= r.y + r.h;
  }

  private pointInsideQuad(x: number, y: number, quad: { x: number; y: number }[]): boolean {
    // Even-odd ray test against the closed polygon. Handles non-convex / self-intersecting cases gracefully.
    let inside = false;
    for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
      const xi = quad[i].x, yi = quad[i].y;
      const xj = quad[j].x, yj = quad[j].y;
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  drawOverlay() {
    const ctx = this.overlayCtx;
    const cvs = this.overlayCanvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    if (!this.rect || this.state === "idle") return;

    // Animation re-trigger
    this.marchOffset = (this.marchOffset + 0.3) % 8;
    cancelAnimationFrame(this.animFrame);
    this.animFrame = requestAnimationFrame(() => this.drawOverlay());

    // 'selected' state OR mid-creation: draw the actual selection shape with marching ants.
    if (this.state === "selected" || this.isCreating) {
      if (this.mode === "lasso" && (this.lassoPath || this.lassoPoints.length > 1)) {
        ctx.beginPath();
        ctx.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);
        for (let i = 1; i < this.lassoPoints.length; i++) {
          ctx.lineTo(this.lassoPoints[i].x, this.lassoPoints[i].y);
        }
        if (this.lassoPath) ctx.closePath();
        this.strokeMarchingAnts(ctx);
      } else {
        ctx.beginPath();
        ctx.rect(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
        this.strokeMarchingAnts(ctx);
      }
      return;
    }

    // 'warping' state: tessellated render + 4 corner handles + quad outline.
    if (this.state === "warping") {
      const wc = this.warpCorners;
      if (this.floatingPixels && wc.length === 4) {
        drawWarpedQuad(ctx, this.floatingPixels, this.rect, wc);
      }
      ctx.beginPath();
      ctx.moveTo(wc[0].x, wc[0].y);
      ctx.lineTo(wc[1].x, wc[1].y);
      ctx.lineTo(wc[2].x, wc[2].y);
      ctx.lineTo(wc[3].x, wc[3].y);
      ctx.closePath();
      this.strokeMarchingAnts(ctx);
      // Optional diagonal hint (where the triangle seam lies).
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(wc[0].x, wc[0].y);
      ctx.lineTo(wc[2].x, wc[2].y);
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.restore();
      for (const p of wc) this.drawHandle(ctx, p.x, p.y, "square");
      return;
    }

    // 'transforming' state: floating pixels + transformed bounding box + handles.
    const c = this.transformedCorners();
    const sides = this.transformedSides(c);
    const rotHandle = this.rotateHandlePos(c);

    // Draw floating pixels under the matrix.
    if (this.floatingPixels) {
      const m = this.matrix;
      ctx.save();
      ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.drawImage(this.floatingPixels, this.rect.x, this.rect.y, this.rect.w, this.rect.h);
      ctx.restore();
    }

    // Bounding-box marching ants (transformed quad).
    ctx.beginPath();
    ctx.moveTo(c.tl.x, c.tl.y);
    ctx.lineTo(c.tr.x, c.tr.y);
    ctx.lineTo(c.br.x, c.br.y);
    ctx.lineTo(c.bl.x, c.bl.y);
    ctx.closePath();
    this.strokeMarchingAnts(ctx);

    // Corner handles.
    for (const p of [c.tl, c.tr, c.bl, c.br]) {
      this.drawHandle(ctx, p.x, p.y, "square");
    }

    // Side handles (smaller squares).
    for (const p of [sides.t, sides.b, sides.l, sides.r]) {
      this.drawHandle(ctx, p.x, p.y, "square");
    }

    // Rotation tether + handle.
    const top = { x: (c.tl.x + c.tr.x) / 2, y: (c.tl.y + c.tr.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(rotHandle.x, rotHandle.y);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = "#000";
    ctx.setLineDash([2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    this.drawHandle(ctx, rotHandle.x, rotHandle.y, "circle");
  }

  private strokeMarchingAnts(ctx: CanvasRenderingContext2D) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.strokeStyle = "#000";
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -this.marchOffset;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, shape: "square" | "circle") {
    if (shape === "square") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(x - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, HANDLE_SIZE / 2, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

type Pt = { x: number; y: number };

/**
 * Draw a bitmap warped to fit a 4-corner quad by tessellating the source rect
 * into two triangles (split along the TL→BR diagonal) and applying a per-triangle
 * affine. A faint crease may show along the diagonal when corners are far from
 * coplanar — acceptable trade-off for sketching.
 *
 * `corners` order: TL, TR, BR, BL.
 */
function drawWarpedQuad(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  rect: SelectionRect,
  corners: Pt[],
) {
  const tlSrc: Pt = { x: rect.x, y: rect.y };
  const trSrc: Pt = { x: rect.x + rect.w, y: rect.y };
  const brSrc: Pt = { x: rect.x + rect.w, y: rect.y + rect.h };
  const blSrc: Pt = { x: rect.x, y: rect.y + rect.h };
  const [tl, tr, br, bl] = corners;
  drawTriangle(ctx, img, rect, [tlSrc, trSrc, brSrc], [tl, tr, br]);
  drawTriangle(ctx, img, rect, [tlSrc, brSrc, blSrc], [tl, br, bl]);
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  rect: SelectionRect,
  src: [Pt, Pt, Pt],
  dst: [Pt, Pt, Pt],
) {
  const m = triangleAffine(src, dst);
  ctx.save();
  // Clip to dest triangle in current (pre-m) coord space.
  ctx.beginPath();
  ctx.moveTo(dst[0].x, dst[0].y);
  ctx.lineTo(dst[1].x, dst[1].y);
  ctx.lineTo(dst[2].x, dst[2].y);
  ctx.closePath();
  ctx.clip();
  // Apply triangle-warp matrix on top of current transform.
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/** Affine that maps src triangle to dst triangle (3 corresponding vertices). */
function triangleAffine(src: [Pt, Pt, Pt], dst: [Pt, Pt, Pt]): Mat {
  const aSrc: Mat = {
    a: src[1].x - src[0].x, b: src[1].y - src[0].y,
    c: src[2].x - src[0].x, d: src[2].y - src[0].y,
    e: src[0].x, f: src[0].y,
  };
  const aDst: Mat = {
    a: dst[1].x - dst[0].x, b: dst[1].y - dst[0].y,
    c: dst[2].x - dst[0].x, d: dst[2].y - dst[0].y,
    e: dst[0].x, f: dst[0].y,
  };
  return multiply(aDst, invert(aSrc));
}
