export interface InputPoint {
  x: number;
  y: number;
  pressure: number;
  timestamp: number;
}

export type StrokeHandler = (points: InputPoint[], done: boolean) => void;
export type CoordTransform = (screenX: number, screenY: number) => { x: number; y: number };

export function setupInput(
  canvas: HTMLCanvasElement,
  onStroke: StrokeHandler,
  transformCoords?: CoordTransform
) {
  let isDrawing = false;
  let currentPoints: InputPoint[] = [];

  function getPoint(e: PointerEvent): InputPoint {
    let x: number, y: number;
    if (transformCoords) {
      const p = transformCoords(e.clientX, e.clientY);
      x = p.x;
      y = p.y;
    } else {
      const rect = canvas.getBoundingClientRect();
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }
    return {
      x,
      y,
      pressure: e.pointerType === "mouse" ? 0.5 : e.pressure,
      timestamp: e.timeStamp,
    };
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    isDrawing = true;
    currentPoints = [getPoint(e)];
    onStroke(currentPoints, false);
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDrawing) return;
    e.preventDefault();

    const coalesced = e.getCoalescedEvents?.() ?? [e];
    for (const ce of coalesced) {
      currentPoints.push(getPoint(ce));
    }
    onStroke(currentPoints, false);
  }

  function onPointerUp(e: PointerEvent) {
    if (!isDrawing) return;
    e.preventDefault();
    isDrawing = false;
    currentPoints.push(getPoint(e));
    onStroke(currentPoints, true);
    currentPoints = [];
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerUp);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerUp);
  };
}
