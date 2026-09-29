import {
  PAUSE_MS,
  ROPE_MAX_PX,
  STILL_PX,
  TRAIL_SPAN,
  catchUpPath,
  trailTimeAt,
  ropeLength,
  ropeStep,
  type TrailPt,
} from "./stroke-smoothing";

export interface InputPoint {
  x: number;
  y: number;
  pressure: number;
  timestamp: number;
  /** False for mouse input, which has no pressure sensor — those strokes draw at a constant width. */
  hasPressure?: boolean;
}

export type StrokeHandler = (points: InputPoint[], done: boolean) => void;
export type CoordTransform = (screenX: number, screenY: number) => { x: number; y: number };

export interface InputOptions {
  onStroke: StrokeHandler;
  transformCoords?: CoordTransform;
  /** Stream 0-1, or a getter for dynamic values: the line trails the pen on a string of
   *  `ropeLength(v)` screen px (0 = follows the pen exactly). See stroke-smoothing.ts. */
  streamline?: number | (() => number);
}

/** Max distance (canvas px) between consecutive points before we interpolate */
const INTERPOLATION_THRESHOLD = 4;

export function setupInput(
  canvas: HTMLElement,
  onStroke: StrokeHandler,
  transformCoords?: CoordTransform,
  options?: Omit<InputOptions, "onStroke" | "transformCoords">,
) {
  let isDrawing = false;
  let drawPointer = -1;
  let currentPoints: InputPoint[] = [];

  // Stream: the brush end of the rope, in screen (client) px — screen space, so the string is
  // the same length on screen at any zoom or rotation.
  const streamlineOpt = options?.streamline;
  function getRopeLength(): number {
    const v = typeof streamlineOpt === "function" ? streamlineOpt() : (streamlineOpt ?? 0);
    return ropeLength(v);
  }
  let rope: { x: number; y: number } | null = null;
  // The pen's recent path (client px), a point each time it has moved STILL_PX from the last —
  // so a held pen's tremble adds nothing. When the rope has to catch up (a pause, a lift) the line
  // follows THIS to the pen instead of a straight chord across the curve it just drew.
  let trail: TrailPt[] = [];
  let trailLen = 0;
  // Corners: where the pen last moved more than STILL_PX (the trail's last point), and when. Held
  // still for PAUSE_MS, the rope catches up (a frame loop — a still pen sends no events), so the
  // line reaches the corner before the pen sets off in the new direction.
  let penEvent: PointerEvent | null = null;
  let stillAt = { x: 0, y: 0 };
  let stillSince = 0;
  let catchUpFrame = 0;

  function trailPush(p: TrailPt) {
    const last = trail[trail.length - 1];
    if (last) trailLen += Math.hypot(p.x - last.x, p.y - last.y);
    trail.push(p);
    // Keep only what the rope could still be lagging along (and some): TRAIL_SPAN strings.
    while (trail.length > 2 && trailLen > TRAIL_SPAN * ROPE_MAX_PX) {
      trailLen -= Math.hypot(trail[1].x - trail[0].x, trail[1].y - trail[0].y);
      trail.shift();
    }
  }

  const pressureOf = (e: PointerEvent) => (e.pointerType === "mouse" ? 0 : e.pressure);

  /** Bring the lagging line up to the pen along the pen's own path, each point stamped with the
   *  time the pen was there (never earlier than the line's last point): the line keeps the pen's
   *  own pace, which is what Ink's Pool reads. (One shared timestamp read the hop from the lagging
   *  end as a long linger — a pool from there to the tip.) */
  function catchUpAlongTrail() {
    // Stream 0 (and every tool but brush/eraser) has nothing to catch up: the line IS the pen. Kept
    // explicit so a held handle can't be nudged to a trail point (as slop-animator found).
    if (!rope || !penEvent || getRopeLength() === 0) return;
    const { path } = catchUpPath(trail, rope, 2 * getRopeLength() + 2 * STILL_PX);
    if (!path.length) return;
    let t = currentPoints[currentPoints.length - 1]?.timestamp ?? path[0].t;
    for (const p of path) {
      t = Math.max(t, p.t);
      addPoint({ ...getPoint(penEvent, p.x, p.y), pressure: p.pressure, timestamp: t });
    }
    const end = path[path.length - 1];
    rope = { x: end.x, y: end.y };
  }

  /** The event as a stroke point, at client position (`cx`, `cy`) — the pen's own unless the rope
   *  holds the brush elsewhere. */
  function getPoint(e: PointerEvent, cx = e.clientX, cy = e.clientY): InputPoint {
    let x: number, y: number;
    if (transformCoords) {
      const p = transformCoords(cx, cy);
      x = p.x;
      y = p.y;
    } else {
      const rect = canvas.getBoundingClientRect();
      x = cx - rect.left;
      y = cy - rect.top;
    }
    return {
      x,
      y,
      // Mouse has no pressure. The stroke handler draws that case at sizeRange 1, so the
      // size slider is the stroke width. A pen uses Press: light thins below size, full widens above.
      pressure: e.pointerType === "mouse" ? 0 : e.pressure,
      hasPressure: e.pointerType !== "mouse",
      timestamp: e.timeStamp,
    };
  }

  // On touch devices, only pen (Apple Pencil) and mouse draw.
  // Finger touches are handled by touch-gestures.ts for pan/zoom/undo.
  function shouldDraw(e: PointerEvent): boolean {
    return e.pointerType === "mouse" || e.pointerType === "pen";
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !shouldDraw(e)) return;
    // A second pen or mouse contact must not restart the stroke the first one owns.
    if (isDrawing) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    isDrawing = true;
    drawPointer = e.pointerId;
    const first = getPoint(e);
    rope = { x: e.clientX, y: e.clientY };
    penEvent = e;
    stillAt = { ...rope };
    stillSince = e.timeStamp;
    trail = [];
    trailLen = 0;
    trailPush({ ...rope, pressure: pressureOf(e), t: e.timeStamp });
    catchUpFrame = requestAnimationFrame(catchUp);
    currentPoints = [first];
    onStroke(currentPoints, false);
  }

  function onPointerMove(e: PointerEvent) {
    // Finger contacts share this element with the Pencil. Only the pointer that started the
    // stroke may extend it — a resting finger otherwise spikes the stroke and ends it.
    if (!isDrawing || e.pointerId !== drawPointer) return;
    e.preventDefault();

    // Collect coalesced events (Safari may return empty array — fall back to event itself)
    const coalesced = e.getCoalescedEvents?.();
    const events = coalesced && coalesced.length > 0 ? coalesced : [e];
    const countBefore = currentPoints.length;
    for (const ce of events) {
      // Stream: the brush moves only once the string is taut; while it's slack there is no new
      // point (the pen's pressure then is dropped with it).
      const now = { x: ce.clientX, y: ce.clientY };
      if (Math.hypot(now.x - stillAt.x, now.y - stillAt.y) > STILL_PX) {
        // Setting off after a pause: if the frame loop hasn't caught up (frames late or not
        // running), finish it now — to where the pen came to rest, before this new point joins the
        // trail — so the corner is kept regardless. The catch-up ends stamped with when the pen got
        // there (the pause's start), so Smooth sees the pause too.
        if (ce.timeStamp - stillSince >= PAUSE_MS) catchUpAlongTrail();
        stillAt = now;
        stillSince = ce.timeStamp;
        trailPush({ ...now, pressure: pressureOf(ce), t: ce.timeStamp });
      }
      penEvent = ce;
      const length = getRopeLength();
      const next = rope ? ropeStep(rope, now, length) : now;
      if (next === rope) {
        // A resting pen still keeps time: Ink's Pool reads the points' timestamps to swell where
        // the nib lingers, and pressure can change in place. So while the line sits at the pen —
        // Stream 0, or caught up to where it came to rest — its events add points there (as they
        // did before the rope, and as slop-animator does). Smooth collapses the runs this makes.
        if (rope && (length === 0 || (rope.x === stillAt.x && rope.y === stillAt.y))) {
          addPoint(getPoint(ce, rope.x, rope.y));
        }
        continue;
      }
      rope = next;
      // Stamped with when the PEN was here (see `trailTimeAt`), not now: the line runs up to a
      // string's length behind, and "now" put the pen's slowdown into it that far early — Ink's Pool
      // swelled a knot before the real end. Never earlier than the point before.
      const pt = getPoint(ce, next.x, next.y);
      if (length > 0) {
        const when = trailTimeAt(trail, next, 2 * length + 2 * STILL_PX);
        const prevT = currentPoints[currentPoints.length - 1]?.timestamp ?? pt.timestamp;
        pt.timestamp = Math.max(prevT, Math.min(pt.timestamp, when ?? pt.timestamp));
      }
      addPoint(pt);
    }
    // Only when a point was added. A slack rope adds none, and a repeat call with the first point
    // alone reads to the stroke handler as a NEW stroke: it re-took its undo snapshot with the
    // opening dot already drawn, so undo left the dot behind (at Stream ≳ 50, the string long
    // enough to stay slack past the first frame).
    if (currentPoints.length !== countBefore) onStroke(currentPoints, false);
  }

  /** While the pen pauses, bring the line up to where it came to rest, along its path. Checked
   *  once per frame; after the first catch-up there is nothing left to add until it moves again. */
  function catchUp(now: number) {
    if (!isDrawing || !rope || !penEvent) return;
    catchUpFrame = requestAnimationFrame(catchUp);
    if (now - stillSince < PAUSE_MS) return;
    const before = currentPoints.length;
    catchUpAlongTrail();
    if (currentPoints.length !== before) onStroke(currentPoints, false);
  }

  function addPoint(pt: InputPoint) {
    // Interpolate if gap between consecutive points is too large (iPad sparse events)
    if (currentPoints.length > 0) {
      const prev = currentPoints[currentPoints.length - 1];
      const dx = pt.x - prev.x;
      const dy = pt.y - prev.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > INTERPOLATION_THRESHOLD) {
        const steps = Math.ceil(dist / INTERPOLATION_THRESHOLD);
        for (let i = 1; i < steps; i++) {
          const t = i / steps;
          currentPoints.push({
            x: prev.x + dx * t,
            y: prev.y + dy * t,
            pressure: prev.pressure + (pt.pressure - prev.pressure) * t,
            timestamp: prev.timestamp + (pt.timestamp - prev.timestamp) * t,
          });
        }
      }
    }
    currentPoints.push(pt);
  }

  function onPointerUp(e: PointerEvent) {
    if (!isDrawing || e.pointerId !== drawPointer) return;
    e.preventDefault();
    isDrawing = false;
    drawPointer = -1;
    cancelAnimationFrame(catchUpFrame);
    // The stroke ends at the pen, not where the rope held the brush: the line catches up along the
    // pen's path (not a straight chord), so a short hatch still reaches the lift point.
    catchUpAlongTrail();
    rope = null;
    penEvent = null;
    // Pen pointerup reports pressure 0; keep the last move's pressure so the stroke doesn't taper
    const up = getPoint(e);
    const last = currentPoints[currentPoints.length - 1];
    if (last) up.pressure = last.pressure;
    currentPoints.push(up);
    onStroke(currentPoints, true);
    currentPoints = [];
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerUp);
  // iPad palm rejection cancels the stream with no pointerup; end the stroke instead of leaving it open
  canvas.addEventListener("pointercancel", onPointerUp);
  // Capture lost without an up (the element or capture went away) must still end the stroke, or
  // the `isDrawing` guard in onPointerDown refuses every later press. After a normal up it no-ops.
  canvas.addEventListener("lostpointercapture", onPointerUp);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("lostpointercapture", onPointerUp);
  };
}
