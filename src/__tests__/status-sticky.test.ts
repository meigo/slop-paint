import { describe, it, expect } from "vitest";
import { app, clearSticky, flashStatus } from "../appState.svelte";

describe("lasting status messages", () => {
  it("a later one shows beside an earlier one instead of replacing it", () => {
    clearSticky();
    flashStatus("Couldn't load your autosaved work. Autosave is off", 0);
    flashStatus("Error — TypeError: x", 0);
    expect(app.statusSticky).toBe(
      "Couldn't load your autosaved work. Autosave is off · Error — TypeError: x",
    );
    clearSticky("Error —");
    expect(app.statusSticky).toBe("Couldn't load your autosaved work. Autosave is off");
  });

  it("the same message twice shows once, and clearing all empties it", () => {
    clearSticky();
    flashStatus("Paused", 0);
    flashStatus("Paused", 0);
    expect(app.statusSticky).toBe("Paused");
    clearSticky();
    expect(app.statusSticky).toBe("");
  });
});
