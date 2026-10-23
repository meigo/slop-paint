/** The colour palette, shared by the brush/fill swatch and the layer tint. Three rows of eight:
 *  neutrals, hues, then skin/earth tones and tints. `#1a1a1a` stays the ink black (the default
 *  brush colour), so an existing selection keeps its marker. */
export const SWATCHES: readonly { color: string; name: string }[] = [
  { color: "#000000", name: "Black" },
  { color: "#1a1a1a", name: "Ink" },
  { color: "#4b4b4b", name: "Dark grey" },
  { color: "#808080", name: "Grey" },
  { color: "#b3b3b3", name: "Light grey" },
  { color: "#d9d9d9", name: "Pale grey" },
  { color: "#f5f0e6", name: "Paper" },
  { color: "#ffffff", name: "White" },
  { color: "#e53935", name: "Red" },
  { color: "#fb8c00", name: "Orange" },
  { color: "#fdd835", name: "Yellow" },
  { color: "#43a047", name: "Green" },
  { color: "#00897b", name: "Teal" },
  { color: "#1e88e5", name: "Blue" },
  { color: "#3949ab", name: "Indigo" },
  { color: "#8e24aa", name: "Purple" },
  { color: "#d81b60", name: "Pink" },
  { color: "#6d4c41", name: "Brown" },
  { color: "#a1887f", name: "Tan" },
  { color: "#f1c8a9", name: "Light skin" },
  { color: "#d7a17d", name: "Medium skin" },
  { color: "#8d5a3b", name: "Dark skin" },
  { color: "#90caf9", name: "Light blue" },
  { color: "#a5d6a7", name: "Light green" },
];
