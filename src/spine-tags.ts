/**
 * Spine tag parsing & manipulation. Tags live as bracket prefixes in the
 * layer/group name (e.g. "[slot]head"), matching what Spine's PSD importer
 * reads. We keep the name as the canonical store so PSDs round-trip cleanly
 * through Photoshop and Spine; this module is just safe edits over names.
 *
 * Reference: https://esotericsoftware.com/spine-import-psd
 */

export type SpineTag = "slot" | "skin" | "bone" | "mesh" | "merge" | "ignore";

export const GROUP_TAGS = ["slot", "skin", "bone", "merge", "ignore"] as const satisfies readonly SpineTag[];
export const LAYER_TAGS = ["mesh", "ignore"] as const satisfies readonly SpineTag[];

const KNOWN_TAGS = new Set<string>([...GROUP_TAGS, ...LAYER_TAGS]);
const TAG_PATTERN = /^\[([a-zA-Z]+)\]/;

/** Canonical emit order — kept stable so toggling tags doesn't churn names. */
const ORDER: Record<SpineTag, number> = {
  ignore: 0,
  merge: 1,
  bone: 2,
  slot: 3,
  skin: 4,
  mesh: 5,
};

export function parseTags(name: string): { tags: SpineTag[]; baseName: string } {
  const tags: SpineTag[] = [];
  let rest = name;
  while (true) {
    const m = TAG_PATTERN.exec(rest);
    if (!m) break;
    const t = m[1].toLowerCase();
    if (!KNOWN_TAGS.has(t)) break;
    if (!tags.includes(t as SpineTag)) tags.push(t as SpineTag);
    rest = rest.slice(m[0].length);
  }
  return { tags, baseName: rest };
}

export function buildName(baseName: string, tags: SpineTag[]): string {
  const sorted = [...new Set(tags)].sort((a, b) => ORDER[a] - ORDER[b]);
  return sorted.map((t) => `[${t}]`).join("") + baseName;
}

export function toggleTag(name: string, tag: SpineTag): string {
  const { tags, baseName } = parseTags(name);
  const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
  return buildName(baseName, next);
}

export function tagsForNodeType(type: "group" | "layer"): readonly SpineTag[] {
  return type === "group" ? GROUP_TAGS : LAYER_TAGS;
}

export const TAG_DESCRIPTIONS: Record<SpineTag, string> = {
  slot: "Make this group a slot",
  skin: "Make this group a skin",
  bone: "Make this group a bone hierarchy",
  mesh: "Mark this layer as a mesh attachment",
  merge: "Flatten group children on import",
  ignore: "Exclude from Spine import",
};

/**
 * Returns a reason string if turning `tag` on (when it isn't already) would
 * conflict with the currently-applied tags. Currently-on tags are never
 * "blocked" — the user must always be able to remove them.
 *
 * Rules:
 *   - [ignore] is exclusive: can't combine with anything else.
 *   - [slot] and [skin] don't stack on the same node (they nest in Spine).
 *   - [bone] + [slot] is allowed (Spine documents this combo).
 *   - [merge] composes with anything else (other than [ignore]).
 */
export function tagConflictReason(tag: SpineTag, currentTags: readonly SpineTag[]): string | null {
  if (currentTags.includes(tag)) return null; // already on — toggle off is always allowed
  if (currentTags.includes("ignore")) return "Conflicts with [ignore]";
  if (tag === "ignore" && currentTags.length > 0) return "Remove other tags first — [ignore] is exclusive";
  if (tag === "slot" && currentTags.includes("skin")) return "Conflicts with [skin] — nest, don't stack";
  if (tag === "skin" && currentTags.includes("slot")) return "Conflicts with [slot] — nest, don't stack";
  return null;
}
