import { describe, it, expect } from "vitest";
import { parseTags, buildName, toggleTag, tagConflictReason, GROUP_TAGS, LAYER_TAGS } from "../spine-tags";

describe("parseTags", () => {
  it("returns empty tags and full name when there are no brackets", () => {
    expect(parseTags("plain layer")).toEqual({ tags: [], baseName: "plain layer" });
  });

  it("parses a single known tag", () => {
    expect(parseTags("[slot]head")).toEqual({ tags: ["slot"], baseName: "head" });
  });

  it("parses multiple known tags in order", () => {
    expect(parseTags("[bone][skin]Hand")).toEqual({ tags: ["bone", "skin"], baseName: "Hand" });
  });

  it("stops at the first unknown tag and keeps the rest as base name", () => {
    expect(parseTags("[bone][unknown]Hand")).toEqual({
      tags: ["bone"],
      baseName: "[unknown]Hand",
    });
  });

  it("treats malformed brackets as part of the name", () => {
    expect(parseTags("[notatag")).toEqual({ tags: [], baseName: "[notatag" });
  });

  it("is case-insensitive on tag names", () => {
    expect(parseTags("[SLOT]head")).toEqual({ tags: ["slot"], baseName: "head" });
  });

  it("does not double-list a repeated tag", () => {
    expect(parseTags("[slot][slot]head")).toEqual({ tags: ["slot"], baseName: "head" });
  });
});

describe("buildName", () => {
  it("returns the base name when no tags", () => {
    expect(buildName("head", [])).toBe("head");
  });

  it("prepends a single tag", () => {
    expect(buildName("head", ["slot"])).toBe("[slot]head");
  });

  it("emits tags in canonical order regardless of input order", () => {
    expect(buildName("Hand", ["skin", "bone"])).toBe("[bone][skin]Hand");
  });

  it("dedupes repeated tags", () => {
    expect(buildName("head", ["slot", "slot"])).toBe("[slot]head");
  });
});

describe("toggleTag", () => {
  it("adds a tag when not present", () => {
    expect(toggleTag("head", "slot")).toBe("[slot]head");
  });

  it("removes a tag when present", () => {
    expect(toggleTag("[slot]head", "slot")).toBe("head");
  });

  it("keeps other tags intact when toggling one off", () => {
    expect(toggleTag("[bone][slot]Hand", "slot")).toBe("[bone]Hand");
  });

  it("preserves base name with unknown bracket prefix", () => {
    expect(toggleTag("[unknown]Foo", "slot")).toBe("[slot][unknown]Foo");
  });
});

describe("round-trip", () => {
  it("parseTags and buildName round-trip a normalized name", () => {
    for (const name of ["head", "[slot]head", "[bone][skin]Hand", "[ignore][mesh]eye"]) {
      const { tags, baseName } = parseTags(name);
      expect(buildName(baseName, tags)).toBe(name);
    }
  });
});

describe("tagConflictReason", () => {
  it("returns null when adding to an empty set", () => {
    expect(tagConflictReason("slot", [])).toBeNull();
  });

  it("returns null for a tag that's already on (so it can be toggled off)", () => {
    expect(tagConflictReason("slot", ["slot"])).toBeNull();
    expect(tagConflictReason("ignore", ["ignore"])).toBeNull();
  });

  it("blocks adding any tag when ignore is set", () => {
    expect(tagConflictReason("slot", ["ignore"])).toMatch(/ignore/i);
    expect(tagConflictReason("mesh", ["ignore"])).toMatch(/ignore/i);
  });

  it("blocks adding ignore when other tags are set", () => {
    expect(tagConflictReason("ignore", ["slot"])).toMatch(/exclusive/i);
    expect(tagConflictReason("ignore", ["bone", "slot"])).toMatch(/exclusive/i);
  });

  it("blocks slot+skin and skin+slot", () => {
    expect(tagConflictReason("slot", ["skin"])).toMatch(/nest/i);
    expect(tagConflictReason("skin", ["slot"])).toMatch(/nest/i);
  });

  it("allows bone + slot", () => {
    expect(tagConflictReason("bone", ["slot"])).toBeNull();
    expect(tagConflictReason("slot", ["bone"])).toBeNull();
  });

  it("allows merge with non-ignore tags", () => {
    expect(tagConflictReason("merge", ["slot"])).toBeNull();
    expect(tagConflictReason("merge", ["bone", "slot"])).toBeNull();
    expect(tagConflictReason("slot", ["merge"])).toBeNull();
  });
});

describe("tag categorization", () => {
  it("groups can use slot/skin/bone/merge/ignore", () => {
    expect([...GROUP_TAGS].sort()).toEqual(["bone", "ignore", "merge", "skin", "slot"]);
  });

  it("layers can use mesh/ignore", () => {
    expect([...LAYER_TAGS].sort()).toEqual(["ignore", "mesh"]);
  });
});
