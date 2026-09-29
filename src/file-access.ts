/**
 * Real Save / Save As / Open for the project file, through the File System Access API — Chrome and
 * Edge on desktop only. Safari (Mac and iPad) and Firefox don't have it: there Save downloads, as
 * it always did. `fileAccessAvailable()` is the switch.
 *
 * The pickers aren't in TypeScript's DOM library yet, so the few pieces used are declared here.
 */

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
interface PickerOptions {
  /** Chrome remembers the last folder per id, so every project dialog starts where the last one was. */
  id?: string;
  types?: PickerType[];
}
interface SaveOptions extends PickerOptions {
  suggestedName?: string;
}
type PickerWindow = Window & {
  showSaveFilePicker?: (o: SaveOptions) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (o: PickerOptions) => Promise<FileSystemFileHandle[]>;
};
type PermissionHandle = FileSystemFileHandle & {
  queryPermission?: (d: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: "readwrite" }) => Promise<PermissionState>;
};

const PSD: PickerOptions = {
  id: "slop-paint-project",
  types: [{ description: "Photoshop document", accept: { "image/vnd.adobe.photoshop": [".psd"] } }],
};

const win = () => window as PickerWindow;

export function fileAccessAvailable(): boolean {
  return typeof window !== "undefined" && typeof win().showSaveFilePicker === "function";
}

/** The user closed the picker (or a permission prompt) without choosing: not an error to report. */
export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/** Ask where to save the project; null if the dialog was dismissed. */
export async function pickSaveFile(suggestedName: string): Promise<FileSystemFileHandle | null> {
  try {
    return await win().showSaveFilePicker!({ ...PSD, suggestedName });
  } catch (e) {
    if (isAbort(e)) return null;
    throw e;
  }
}

/** Ask which project to open; null if the dialog was dismissed. */
export async function pickOpenFile(): Promise<FileSystemFileHandle | null> {
  try {
    const [handle] = await win().showOpenFilePicker!(PSD);
    return handle ?? null;
  } catch (e) {
    if (isAbort(e)) return null;
    throw e;
  }
}

/** Write `data` over the file. A file that was OPENED was granted reading only, so the first save
 *  to it asks for write permission (the save's key press or click is the gesture Chrome needs). */
export async function writeFile(handle: FileSystemFileHandle, data: ArrayBuffer): Promise<void> {
  const h = handle as PermissionHandle;
  if (h.queryPermission && (await h.queryPermission({ mode: "readwrite" })) !== "granted") {
    if ((await h.requestPermission?.({ mode: "readwrite" })) !== "granted") {
      throw new Error("permission to write the file was refused");
    }
  }
  const out = await handle.createWritable();
  try {
    await out.write(data);
  } catch (e) {
    await out.abort().catch(() => {}); // leave the file as it was, not half-written
    throw e;
  }
  await out.close();
}
