/**
 * Whether a dialog may take this keydown as its Enter-to-confirm. Not while an input method is
 * composing (the Enter that commits Japanese input arrives as a keydown too: `isComposing`, or
 * keyCode 229 in Safari), and not on a focused button, whose own Enter must press it: the dialogs
 * took Enter on the window whatever had focus, so Enter on a focused Cancel ran Create.
 */
export function isConfirmEnter(e: {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  target: EventTarget | null;
}): boolean {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return false;
  return (e.target as { tagName?: string } | null)?.tagName !== "BUTTON";
}
