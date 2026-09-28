import { PAUSE_MS, STILL_PX, ropeCatchUp, ropeLength, ropeStep } from "./stroke-smoothing";

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
  /** Called when a pencil double-tap is detected (two quick taps with minimal movement) */
  onPencilDoubleTap?: () => void;
}

const DOUBLE_TAP_INTERVAL = 300; // ms between taps
const TAP_MAX_DURATION = 200; // ms — a tap must be shorter than this
const TAP_MAX_DISTANCE = 8; // px — must not move more than this
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
  // Corners: where the pen last moved more than STILL_PX, and when. Held still for PAUSE_MS, the
  // rope pulls in (a frame loop — a still pen sends no events), so the line reaches the corner
  // before the pen sets off in the new direction instead of cutting across it.
  let penEvent: PointerEvent | null = null;
  let stillAt = { x: 0, y: 0 };
  let stillSince = 0;
  let catchUpFrame = 0;
  let lastTick = 0;

  // Pencil double-tap detection
  let lastPenTapTime = 0;
  let penDownTime = 0;
  let penDownX = 0;
  let penDownY = 0;
  let penMoved = false;

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
    stillSince = lastTick = e.timeStamp;
    catchUpFrame = requestAnimationFrame(catchUp);
    currentPoints = [first];
    onStroke(currentPoints, false);

    // Track pen tap start
    if (e.pointerType === "pen") {
      penDownTime = e.timeStamp;
      penDownX = e.clientX;
      penDownY = e.clientY;
      penMoved = false;
    }
  }

  function onPointerMove(e: PointerEvent) {
    // Finger contacts share this element with the Pencil. Only the pointer that started the
    // stroke may extend it — a resting finger otherwise spikes the stroke and ends it.
    if (!isDrawing || e.pointerId !== drawPointer) return;
    e.preventDefault();

    // Track pen movement for tap detection
    if (e.pointerType === "pen" && !penMoved) {
      const dx = e.clientX - penDownX;
      const dy = e.clientY - penDownY;
      if (Math.abs(dx) > TAP_MAX_DISTANCE || Math.abs(dy) > TAP_MAX_DISTANCE) {
        penMoved = true;
      }
    }

    // Collect coalesced events (Safari may return empty array — fall back to event itself)
    const coalesced = e.getCoalescedEvents?.();
    const events = coalesced && coalesced.length > 0 ? coalesced : [e];
    const countBefore = currentPoints.length;
    for (const ce of events) {
      // Stream: the brush moves only once the string is taut; while it's slack there is no new
      // point (the pen's pressure then is dropped with it).
      const now = { x: ce.clientX, y: ce.clientY };
      if (Math.hypot(now.x - stillAt.x, now.y - stillAt.y) > STILL_PX) {
        // Setting off after a pause: if the frame loop hasn't pulled the rope all the way in
        // (frames late or not running), finish it now, so the corner is kept regardless. Stamped
        // with the pause's start, so Smooth sees the pause too.
        // Aimed at where the pen came to rest (the corner), not its latest position, which is
        // already up to STILL_PX along the new leg.
        if (rope && penEvent && ce.timeStamp - stillSince >= PAUSE_MS) {
          if (rope.x !== stillAt.x || rope.y !== stillAt.y) {
            rope = { ...stillAt };
            addPoint({ ...getPoint(penEvent, stillAt.x, stillAt.y), timestamp: stillSince });
          }
        }
        stillAt = now;
        stillSince = ce.timeStamp;
      }
      penEvent = ce;
      const next = rope ? ropeStep(rope, now, getRopeLength()) : now;
      if (next === rope) continue;
      rope = next;
      addPoint(getPoint(ce, next.x, next.y));
    }
    // Only when a point was added. A slack rope adds none, and a repeat call with the first point
    // alone reads to the stroke handler as a NEW stroke: it re-took its undo snapshot with the
    // opening dot already drawn, so undo left the dot behind (at Stream ≳ 50, the string long
    // enough to stay slack past the first frame).
    if (currentPoints.length !== countBefore) onStroke(currentPoints, false);
  }

  /** While the pen pauses, glide the rope's end to where it came to rest — once per frame. */
  function catchUp(now: number) {
    if (!isDrawing || !rope || !penEvent) return;
    catchUpFrame = requestAnimationFrame(catchUp);
    const dt = now - lastTick;
    lastTick = now;
    if (now - stillSince < PAUSE_MS) return;
    // To where the pen came to rest, so its tremble while held doesn't wiggle the corner.
    const next = ropeCatchUp(rope, stillAt, dt);
    if (next === rope) return;
    rope = next;
    addPoint({ ...getPoint(penEvent, next.x, next.y), timestamp: now });
    onStroke(currentPoints, false);
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
    rope = null;
    penEvent = null;
    cancelAnimationFrame(catchUpFrame);
    // The stroke ends at the pen, not where the rope held the brush: the line catches up, so a
    // short hatch still reaches the lift point.
    // Pen pointerup reports pressure 0; keep the last move's pressure so the stroke doesn't taper
    const up = getPoint(e);
    const last = currentPoints[currentPoints.length - 1];
    if (last) up.pressure = last.pressure;
    currentPoints.push(up);
    onStroke(currentPoints, true);
    currentPoints = [];

    // Detect pencil double-tap
    if (e.pointerType === "pen" && !penMoved && options?.onPencilDoubleTap) {
      const duration = e.timeStamp - penDownTime;
      if (duration < TAP_MAX_DURATION) {
        // This was a quick tap — check if it's a double-tap
        if (penDownTime - lastPenTapTime < DOUBLE_TAP_INTERVAL) {
          options.onPencilDoubleTap();
          lastPenTapTime = 0; // reset so triple-tap doesn't fire again
        } else {
          lastPenTapTime = e.timeStamp;
        }
      }
    }
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
