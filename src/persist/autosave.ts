import { idbDo, KV_STORE } from "./db";
import { bumpPersistGeneration, persistGeneration } from "./generation";
import { planCheckpoint, type AutosaveEntry, type AutosaveMeta } from "./autosave-plan";

export type { AutosaveEntry, AutosaveMeta } from "./autosave-plan";

/** The latest save: the one restored on startup. */
export const LATEST_KEY = "autosave";
/** A copy set aside when the layers went blank and the user chose to keep working, so the save of
 *  the blank document that follows can't replace it. Replaced only by the next such event. */
export const KEPT_KEY = "autosave-kept";
const META_KEY = "autosave-meta";
const KEPT_META_KEY = "autosave-kept-meta";
const CHECKPOINTS_KEY = "autosave-checkpoints";

/** Older copies, at least this far apart: if a blank or broken document ever got saved, the work
 *  from a few minutes earlier is still there. */
export const CHECKPOINT_INTERVAL_MS = 5 * 60_000;
export const CHECKPOINTS_KEPT = 3;

/** A copy and its meta go in ONE transaction: written apart, a tab killed between the two left a
 *  copy listed with another save's time, name and layer counts. */
const putPair = (key: string, value: unknown, metaKey: string, meta: unknown) =>
  idbDo(KV_STORE, "readwrite", (s) => {
    s.put(value, key);
    return s.put(meta, metaKey);
  });
const get = <T>(key: string) => idbDo<T | undefined>(KV_STORE, "readonly", (s) => s.get(key));

/** What a latest copy saved before the listing existed is listed (and set aside) with. */
const NO_META: AutosaveMeta = { savedAt: 0, projectName: "", layerCount: 0, inkedCount: 0 };

// Writes run one at a time, in the order they were asked for: a save still writing when New set
// the latest aside and cleared it, or the new document's first save, could land in either order.
let tail: Promise<unknown> = Promise.resolve();
function queued<T>(op: () => Promise<T>): Promise<T> {
  const run = tail.then(op);
  tail = run.catch(() => {});
  return run;
}

/** Store the project (a PSD buffer) as the latest autosave, and as a checkpoint when the newest
 *  one is old enough. */
export function saveAutosave(buffer: ArrayBuffer, meta: AutosaveMeta): Promise<void> {
  bumpPersistGeneration();
  const started = persistGeneration();
  return queued(async () => {
    await putPair(LATEST_KEY, buffer, META_KEY, meta);
    // A newer save (or a New replacing the document) was asked for while this one waited.
    if (started !== persistGeneration()) return;
    const list = (await get<AutosaveEntry[]>(CHECKPOINTS_KEY)) ?? [];
    const plan = planCheckpoint(list, meta, CHECKPOINT_INTERVAL_MS, CHECKPOINTS_KEPT);
    if (plan.write) await putPair(plan.write, buffer, CHECKPOINTS_KEY, plan.list);
  });
}

/** An autosaved project, or null if there is none. */
export async function loadAutosave(key: string = LATEST_KEY): Promise<ArrayBuffer | null> {
  return (await get<ArrayBuffer>(key)) ?? null;
}

/** Every stored copy, newest first: the latest, the kept one, then the checkpoints. */
export async function listAutosaves(): Promise<AutosaveEntry[]> {
  const out: AutosaveEntry[] = [];
  const latest = await get<AutosaveMeta>(META_KEY);
  if (latest) out.push({ ...latest, key: LATEST_KEY });
  // Saved by a version before the listing existed: still restorable, just without its details.
  else if (await idbDo(KV_STORE, "readonly", (s) => s.count(LATEST_KEY)))
    out.push({ ...NO_META, key: LATEST_KEY });
  const kept = await get<AutosaveMeta>(KEPT_META_KEY);
  if (kept) out.push({ ...kept, key: KEPT_KEY });
  out.push(...((await get<AutosaveEntry[]>(CHECKPOINTS_KEY)) ?? []));
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** The latest copy into the kept slot. One saved before the listing existed has no meta: it is
 *  kept all the same (it was skipped, while the caller resumed autosave over it). */
async function keepLatest(): Promise<void> {
  const buffer = await get<ArrayBuffer>(LATEST_KEY);
  if (!buffer) return;
  const meta = (await get<AutosaveMeta>(META_KEY)) ?? NO_META;
  await putPair(KEPT_KEY, buffer, KEPT_META_KEY, meta);
}

/** The latest copy as a checkpoint now, whatever the newest one's age (the oldest's key is reused
 *  as ever) — unless it already is one. */
async function checkpointLatest(): Promise<void> {
  const buffer = await get<ArrayBuffer>(LATEST_KEY);
  if (!buffer) return;
  const meta = (await get<AutosaveMeta>(META_KEY)) ?? NO_META;
  const list = (await get<AutosaveEntry[]>(CHECKPOINTS_KEY)) ?? [];
  if (list.some((e) => e.savedAt === meta.savedAt)) return;
  const plan = planCheckpoint(list, meta, -Infinity, CHECKPOINTS_KEPT);
  if (plan.write) await putPair(plan.write, buffer, CHECKPOINTS_KEY, plan.list);
}

/** Set the latest copy aside as the kept one (the layers went blank and the user carries on). */
export function keepLatestAutosave(): Promise<void> {
  return queued(keepLatest);
}

/**
 * The document is being replaced (New, Open, an older copy restored): set its latest autosave
 * aside, so it stays in File ▸ Restore autosave… once the next document's saves take the latest
 * slot. `how`: "checkpoint" makes it a checkpoint; "kept" (autosave paused over blank layers: the
 * latest is the copy the pause protects) puts it in the kept slot, which a checkpoint never
 * replaces. With `clear` (New) the latest is then forgotten, so a reload doesn't bring the old
 * document back — only once it was set aside: on a failure it stays.
 */
export function setLatestAside(how: "checkpoint" | "kept", clear = false): Promise<void> {
  if (clear) bumpPersistGeneration(); // a save of the outgoing document makes no checkpoint of its own
  return queued(async () => {
    await (how === "kept" ? keepLatest() : checkpointLatest());
    if (!clear) return;
    await idbDo(KV_STORE, "readwrite", (s) => {
      s.delete(LATEST_KEY);
      return s.delete(META_KEY);
    });
  });
}
