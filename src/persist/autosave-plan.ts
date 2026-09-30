/** Pure parts of the autosave: checkpoint rotation and the blank-layers guard. */

/** What is stored beside each autosaved copy, to list it in File ▸ Restore autosave…. */
export interface AutosaveMeta {
  savedAt: number;
  projectName: string;
  layerCount: number;
  /** Layers that had pixels when it was saved. */
  inkedCount: number;
}

export interface AutosaveEntry extends AutosaveMeta {
  /** The IndexedDB key its PSD buffer is stored under. */
  key: string;
}

/**
 * Whether this save also becomes a checkpoint: yes when there is none yet, or the newest is at
 * least `intervalMs` old. Checkpoints take the keys `autosave-cp-0 … -(keep-1)`; once all are
 * used, the oldest's key is reused, so its copy is overwritten and nothing needs deleting.
 */
export function planCheckpoint(
  list: AutosaveEntry[],
  meta: AutosaveMeta,
  intervalMs: number,
  keep: number,
): { write: string | null; list: AutosaveEntry[] } {
  const byAge = [...list].sort((a, b) => a.savedAt - b.savedAt);
  const newest = byAge[byAge.length - 1];
  if (newest && meta.savedAt - newest.savedAt < intervalMs) return { write: null, list };
  const used = new Set(list.map((e) => e.key));
  const free = Array.from({ length: keep }, (_, i) => `autosave-cp-${i}`).find((k) => !used.has(k));
  const key = free ?? byAge[0].key;
  return { write: key, list: [...byAge.filter((e) => e.key !== key), { ...meta, key }] };
}

/**
 * The blank-layers guard. `before` holds the ids of layers that had pixels at the last save (or
 * the last check), `now` those that have pixels now, `existing` every layer id now. A layer that
 * still exists but lost ALL its pixels counts as emptied. Every way the user empties a layer (a
 * clear, an erase, an undo) is an undo step, so more layers emptied than undo steps taken since
 * (`historySteps`) means something else emptied them: iPad dropping the page's image memory in the
 * background, which kept the layers and blanked their pixels.
 */
export function looksBlanked(
  before: ReadonlySet<number>,
  now: ReadonlySet<number>,
  existing: ReadonlySet<number>,
  historySteps: number,
): boolean {
  let emptied = 0;
  for (const id of before) if (existing.has(id) && !now.has(id)) emptied++;
  return emptied > 0 && emptied > historySteps;
}

/** Image memory the layers take: 4 bytes a pixel, at the canvas's device resolution. */
export function layerMemoryBytes(layers: number, w: number, h: number, dpr: number): number {
  return layers * Math.round(w * dpr) * Math.round(h * dpr) * 4;
}

/** Above this, an iPad may drop the layers' pixels while the app is in the background (a 40-layer
 *  1920×1080 document at dpr 2 — 1.2 GB — lost them all). A guess on the safe side: the real limit
 *  depends on the device and what else is running. */
export const IPAD_MEMORY_WARN_BYTES = 600 * 1024 * 1024;

/** "1.3 GB", "420 MB". */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
