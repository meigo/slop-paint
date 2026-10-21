import { beforeEach, describe, expect, it } from "vitest";
import { setupInput, type InputPoint } from "../input";

// setupInput on a stand-in element: only the listeners and the rect it reads.
type Listener = (e: object) => void;
function fakeElement() {
  const listeners: Record<string, Listener[]> = {};
  return {
    addEventListener: (type: string, f: Listener) => (listeners[type] ??= []).push(f),
    removeEventListener: () => {},
    setPointerCapture: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
    fire(type: string, e: object) {
      for (const f of listeners[type] ?? []) f({ type, ...e });
    },
  };
}
const pen = (o: object) => ({
  pointerId: 3,
  pointerType: "pen",
  button: 0,
  pressure: 0.6,
  preventDefault() {},
  getCoalescedEvents: () => [],
  ...o,
});

describe("input: a stroke cut off without a pen position", () => {
  let el: ReturnType<typeof fakeElement>;
  let ends: InputPoint[][];
  beforeEach(() => {
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    ends = [];
    el = fakeElement();
    setupInput(el as unknown as HTMLElement, (pts, done) => {
      if (done) ends.push(pts.slice());
    });
    el.fire("pointerdown", pen({ clientX: 500, clientY: 450, timeStamp: 0 }));
    for (let i = 1; i <= 10; i++) {
      el.fire("pointermove", pen({ clientX: 500 + i * 4, clientY: 450, timeStamp: i * 8 }));
    }
  });

  // Chromium's cancel and lost capture report client (0, 0): the stroke drew a line to the corner.
  for (const type of ["pointercancel", "lostpointercapture"]) {
    it(`${type} ends it where the pen last was`, () => {
      el.fire(type, pen({ clientX: 0, clientY: 0, pressure: 0, timeStamp: 100 }));
      expect(ends).toHaveLength(1);
      expect(ends[0].at(-1)).toMatchObject({ x: 540, y: 450, pressure: 0.6 });
    });
  }

  it("a pointerup ends at the release point, once", () => {
    el.fire("pointerup", pen({ clientX: 560, clientY: 450, pressure: 0, timeStamp: 100 }));
    el.fire("lostpointercapture", pen({ clientX: 0, clientY: 0, pressure: 0, timeStamp: 100 }));
    expect(ends).toHaveLength(1);
    expect(ends[0].at(-1)).toMatchObject({ x: 560, y: 450, pressure: 0.6 });
  });
});
