import { describe, it, expect } from "vitest";
import { History } from "../history";
import {
  carryPendingLayer,
  formatBytes,
  layerMemoryBytes,
  looksBlanked,
  planCheckpoint,
  type AutosaveEntry,
} from "../persist/autosave-plan";

const meta = (savedAt: number) => ({ savedAt, projectName: "p", layerCount: 2, inkedCount: 2 });
const MIN = 60_000;

describe("planCheckpoint", () => {
  it("makes the first save a checkpoint", () => {
    const p = planCheckpoint([], meta(0), 5 * MIN, 3);
    expect(p.write).toBe("autosave-cp-0");
    expect(p.list.map((e) => e.key)).toEqual(["autosave-cp-0"]);
  });

  it("skips saves closer than the interval to the newest", () => {
    const list: AutosaveEntry[] = [{ ...meta(0), key: "autosave-cp-0" }];
    expect(planCheckpoint(list, meta(4 * MIN), 5 * MIN, 3).write).toBeNull();
    expect(planCheckpoint(list, meta(5 * MIN), 5 * MIN, 3).write).toBe("autosave-cp-1");
  });

  it("reuses the oldest's key once all are taken", () => {
    const list: AutosaveEntry[] = [
      { ...meta(10 * MIN), key: "autosave-cp-2" },
      { ...meta(0), key: "autosave-cp-0" },
      { ...meta(5 * MIN), key: "autosave-cp-1" },
    ];
    const p = planCheckpoint(list, meta(15 * MIN), 5 * MIN, 3);
    expect(p.write).toBe("autosave-cp-0");
    expect(p.list.map((e) => [e.key, e.savedAt / MIN])).toEqual([
      ["autosave-cp-1", 5],
      ["autosave-cp-2", 10],
      ["autosave-cp-0", 15],
    ]);
  });
});

describe("planCheckpoint, forced (the document is being replaced)", () => {
  it("makes a checkpoint however new the newest is, on the oldest's key", () => {
    const list: AutosaveEntry[] = [
      { ...meta(10 * MIN), key: "autosave-cp-2" },
      { ...meta(0), key: "autosave-cp-0" },
      { ...meta(5 * MIN), key: "autosave-cp-1" },
    ];
    const p = planCheckpoint(list, meta(10 * MIN + 1), -Infinity, 3);
    expect(p.write).toBe("autosave-cp-0");
    expect(p.list.map((e) => e.key)).toEqual(["autosave-cp-1", "autosave-cp-2", "autosave-cp-0"]);
    // A latest saved before metas existed (time 0) still gets one.
    expect(planCheckpoint(list.slice(0, 1), meta(0), -Infinity, 3).write).toBe("autosave-cp-0");
  });
});

describe("carryPendingLayer (a float is lifted while the guard probes)", () => {
  const ids = (...n: number[]) => new Set(n);

  it("changes nothing with no float", () => {
    expect(carryPendingLayer(ids(1, 2), ids(1), null)).toEqual(ids(1, 2));
  });

  it("a paste floating on an empty layer doesn't make it inked: Esc is no blanking", () => {
    const all = ids(1, 2);
    const saved = carryPendingLayer(ids(1, 2), ids(1), 2); // probed with the float drawn in
    expect(saved).toEqual(ids(1));
    expect(looksBlanked(saved, ids(1), all, 0)).toBe(false); // cancelled: layer 2 empty again
  });

  it("a layer's content floating off the page doesn't read as emptied", () => {
    const all = ids(1, 2);
    const now = carryPendingLayer(ids(1), ids(1, 2), 2);
    expect(now).toEqual(ids(1, 2));
    expect(looksBlanked(ids(1, 2), now, all, 0)).toBe(false);
  });

  it("the other layers going blank is still caught", () => {
    const now = carryPendingLayer(ids(), ids(1, 2, 3), 2);
    expect(looksBlanked(ids(1, 2, 3), now, ids(1, 2, 3), 0)).toBe(true);
  });
});

describe("looksBlanked", () => {
  const ids = (...n: number[]) => new Set(n);

  it("flags layers emptied with no undo step to explain it", () => {
    expect(looksBlanked(ids(1, 2, 3), ids(), ids(1, 2, 3), 0)).toBe(true);
    // Even one, when nothing was done (a one-layer document blanked in the background).
    expect(looksBlanked(ids(1), ids(), ids(1), 0)).toBe(true);
  });

  it("allows one emptied layer per undo step (clear, erase, undo)", () => {
    expect(looksBlanked(ids(1, 2), ids(2), ids(1, 2), 1)).toBe(false);
    expect(looksBlanked(ids(1, 2, 3), ids(), ids(1, 2, 3), 1)).toBe(true);
  });

  it("ignores deleted layers and layers that gained pixels", () => {
    expect(looksBlanked(ids(1, 2), ids(2, 5), ids(2, 5), 0)).toBe(false);
  });
});

describe("layer memory", () => {
  it("counts 4 bytes a device pixel", () => {
    expect(layerMemoryBytes(40, 1920, 1080, 2)).toBe(40 * 3840 * 2160 * 4);
    expect(formatBytes(layerMemoryBytes(40, 1920, 1080, 2))).toBe("1.2 GB");
    expect(formatBytes(300 * 1024 * 1024)).toBe("300 MB");
  });
});

describe("looksBlanked with a step that changes several layers", () => {
  it("a Move that pushes two layers off the page is no blanking once counted by its layers", () => {
    const h = new History();
    const before = h.layerChanges;
    h.push({ undo: () => {}, redo: () => {}, layers: 2 });
    const emptied = { before: new Set([1, 11, 12]), now: new Set([1]), all: new Set([1, 11, 12]) };
    expect(looksBlanked(emptied.before, emptied.now, emptied.all, 1)).toBe(true); // by steps
    expect(looksBlanked(emptied.before, emptied.now, emptied.all, h.layerChanges - before)).toBe(
      false,
    );
  });
});
