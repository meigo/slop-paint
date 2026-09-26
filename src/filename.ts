/** A project name made safe to use as a file name (as slop-animator): characters no file system
 *  accepts are dropped, and an empty result falls back to "untitled". */
export function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const cleaned = name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, "").trim();
  return cleaned || "untitled";
}

/** The project name an opened file implies: its name without the extension. */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim() || "untitled";
}
