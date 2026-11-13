import { describe, it, expect } from "vitest";
import { thumbStamp, thumbState, touchAllThumbs, touchThumb } from "../lib/thumb-stamp";

describe("thumbnail stamps", () => {
  it("a thumbnail never drawn is stale", () => {
    expect(thumbState(undefined, thumbStamp(1))).toBe("stale");
  });

  it("stays current until its own layer is touched", () => {
    const kept = thumbStamp(1);
    touchThumb(2);
    expect(thumbState(kept, thumbStamp(1))).toBe("current");
    touchThumb(1);
    expect(thumbState(kept, thumbStamp(1))).not.toBe("current");
  });

  it("one edit since may be redrawn in part, two not", () => {
    const kept = thumbStamp(3);
    touchThumb(3);
    expect(thumbState(kept, thumbStamp(3))).toBe("part");
    touchThumb(3);
    expect(thumbState(kept, thumbStamp(3))).toBe("stale");
  });

  it("touching all makes every thumbnail stale, even one edit later", () => {
    const a = thumbStamp(4);
    const b = thumbStamp(5);
    touchAllThumbs();
    expect(thumbState(a, thumbStamp(4))).toBe("stale");
    expect(thumbState(b, thumbStamp(5))).toBe("stale");
    // A stamp from before can't pass for "one edit ago".
    touchThumb(4);
    expect(thumbState(a, thumbStamp(4))).toBe("stale");
  });
});
