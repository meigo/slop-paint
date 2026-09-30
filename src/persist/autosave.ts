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

const put = (key: string, value: unknown) => idbDo(KV_STORE, "readwrite", (s) => s.put(value, key));
const get = <T>(key: string) => idbDo<T | undefined>(KV_STORE, "readonly", (s) => s.get(key));
const del = (key: string) => idbDo(KV_STORE, "readwrite", (s) => s.delete(key));

/** Store the project (a PSD buffer) as the latest autosave, and as a checkpoint when the newest
 *  one is old enough. */
export async function saveAutosave(buffer: ArrayBuffer, meta: AutosaveMeta): Promise<void> {
  bumpPersistGeneration();
  const started = persistGeneration();
  await put(LATEST_KEY, buffer);
  await put(META_KEY, meta);
  // A newer save (or a New / Open replacing the document) started while this one was writing.
  if (started !== persistGeneration()) return;
  const list = (await get<AutosaveEntry[]>(CHECKPOINTS_KEY)) ?? [];
  const plan = planCheckpoint(list, meta, CHECKPOINT_INTERVAL_MS, CHECKPOINTS_KEPT);
  if (!plan.write) return;
  await put(plan.write, buffer);
  await put(CHECKPOINTS_KEY, plan.list);
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
    out.push({ key: LATEST_KEY, savedAt: 0, projectName: "", layerCount: 0, inkedCount: 0 });
  const kept = await get<AutosaveMeta>(KEPT_META_KEY);
  if (kept) out.push({ ...kept, key: KEPT_KEY });
  out.push(...((await get<AutosaveEntry[]>(CHECKPOINTS_KEY)) ?? []));
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** Set the latest copy aside as the kept one (the layers went blank and the user carries on). */
export async function keepLatestAutosave(): Promise<void> {
  const buffer = await get<ArrayBuffer>(LATEST_KEY);
  const meta = await get<AutosaveMeta>(META_KEY);
  if (!buffer || !meta) return;
  await put(KEPT_KEY, buffer);
  await put(KEPT_META_KEY, meta);
}

/** Forget the latest autosave (New document). The kept copy and the checkpoints stay, so a New
 *  tapped by mistake can still be undone from File ▸ Restore autosave…. */
export async function clearAutosave(): Promise<void> {
  bumpPersistGeneration(); // drop any in-flight save of the outgoing document
  await del(LATEST_KEY);
  await del(META_KEY);
}
