import { idbDo, KV_STORE } from "./db";
import { bumpPersistGeneration, persistGeneration } from "./generation";

const KEY = "autosave";

/** Store the project (a PSD buffer) as the single autosave slot. */
export async function saveAutosave(buffer: ArrayBuffer): Promise<void> {
  bumpPersistGeneration();
  const started = persistGeneration();
  // A newer save (or a New / Open replacing the document) started while this one was encoding.
  if (started !== persistGeneration()) return;
  await idbDo(KV_STORE, "readwrite", (s) => s.put(buffer, KEY));
}

/** The autosaved project, or null if there is none. */
export async function loadAutosave(): Promise<ArrayBuffer | null> {
  const buf = await idbDo<ArrayBuffer | undefined>(KV_STORE, "readonly", (s) => s.get(KEY));
  return buf ?? null;
}

/** Forget the autosave (New document). */
export async function clearAutosave(): Promise<void> {
  bumpPersistGeneration(); // drop any in-flight save of the outgoing document
  await idbDo(KV_STORE, "readwrite", (s) => s.delete(KEY));
}
