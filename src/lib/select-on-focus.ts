/**
 * Svelte action: select a text field's whole value when it gains focus, so typing replaces it and
 * one more tap places the caret (layer rename, the brush size box, the project name).
 *
 * A click that focuses the field would collapse the selection again on its mouseup (Chrome and
 * Safari), so that one mouseup is cancelled. `setSelectionRange` rather than `select()`: iOS
 * ignores `select()` in some cases. A field already focused when the action runs (`autofocus`) is
 * selected at once.
 */
export function selectOnFocus(node: HTMLInputElement) {
  let focusedByPointer = false;
  const selectAll = () => node.setSelectionRange(0, node.value.length);
  const onFocus = () => {
    selectAll();
    focusedByPointer = true;
    // A keyboard focus has no mouseup to swallow: forget it after this turn.
    setTimeout(() => (focusedByPointer = false), 500);
  };
  const onMouseUp = (e: MouseEvent) => {
    if (!focusedByPointer) return;
    focusedByPointer = false;
    e.preventDefault();
  };
  node.addEventListener("focus", onFocus);
  node.addEventListener("mouseup", onMouseUp);
  if (document.activeElement === node) selectAll();
  return {
    destroy() {
      node.removeEventListener("focus", onFocus);
      node.removeEventListener("mouseup", onMouseUp);
    },
  };
}
