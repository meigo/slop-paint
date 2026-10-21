<script lang="ts">
  // A number box that also drags: a press that travels 3 px sideways changes the value (`scrub.ts`:
  // `pxPerStep` per step, Shift 4× finer, snapped to `step`, measured from the press so dragging
  // back restores it); a tap focuses it for typing. A typed value is sent as it is typed when it is
  // in range (on iPad, tapping a dialog's button doesn't blur the field, so a commit on blur alone
  // confirmed the old value), and clamped on Enter or blur. From
  // slop-vector-editor's `NumberField` (2026-10-21), without its label column, mixed value and
  // undo bracket: here it only sits in dialogs, whose OK is the one undo step.
  import { SCRUB_THRESHOLD_PX, scrubbedValue } from "./scrub";

  let {
    value,
    min = -Infinity,
    max = Infinity,
    step = 1,
    pxPerStep = 4,
    clamp = true,
    title,
    class: cls = "",
    onchange,
  }: {
    value: number;
    min?: number;
    max?: number;
    /** The grid a drag snaps to. Typed values are kept as typed. */
    step?: number;
    /** Horizontal travel worth one step; Shift makes it four times finer. */
    pxPerStep?: number;
    /** Clamp a TYPED value to min…max. Off where the caller refuses an out-of-range value with a
     *  reason instead (a document side: clamped, an emptied Width once made a 1-px document). A
     *  drag always stays inside. */
    clamp?: boolean;
    title: string;
    /** Width and other layout classes for the input. */
    class?: string;
    onchange: (v: number) => void;
  } = $props();

  let editing = $state(false);
  let draft = $state("");
  let initial = "";
  /** The value shown while dragging — the field owns its text then, as it does while typing. */
  let dragging = $state<number | null>(null);
  const fmt = (v: number) => String(Math.round(v * 100) / 100);
  const shown = $derived(dragging !== null ? fmt(dragging) : editing ? draft : fmt(value));

  /** The typed number, unclamped; null when nothing new (or nothing numeric) was typed. */
  function typedRaw(): number | null {
    if (draft === initial) return null;
    const v = Number(draft);
    return draft.trim() === "" || !Number.isFinite(v) ? null : v;
  }

  /** The typed value as committed: clamped unless `clamp` is off. */
  function typedValue(): number | null {
    const v = typedRaw();
    return v === null || !clamp ? v : Math.min(max, Math.max(min, v));
  }

  function send(v: number | null) {
    if (v !== null && v !== value) onchange(v);
  }

  function onTyped(e: Event & { currentTarget: HTMLInputElement }) {
    draft = e.currentTarget.value;
    const v = typedRaw();
    // Out of range with `clamp` on: wait for Enter or blur, so typing 120 doesn't pass through 4.
    if (v !== null && (!clamp || (v >= min && v <= max))) send(v);
  }

  function commit() {
    editing = false;
    send(typedValue());
  }

  let input: HTMLInputElement | undefined;
  // Non-reactive on purpose: nothing renders from it.
  let scrub: {
    id: number;
    startX: number;
    startValue: number;
    moved: boolean;
    last: number;
  } | null = null;

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0 || scrub) return;
    // A value outside the range (typed with `clamp` off) drags from the nearest end.
    const start = Math.min(max, Math.max(min, value));
    scrub = { id: e.pointerId, startX: e.clientX, startValue: start, moved: false, last: value };
    // No preventDefault: a press that never travels still focuses the field for typing.
    window.addEventListener("pointermove", onpointermove);
    window.addEventListener("pointerup", end);
    // A browser-taken pan (touch-action: pan-y) or palm rejection cancels the stream; that must END
    // the drag, not leave it armed.
    window.addEventListener("pointercancel", end);
  }

  function onpointermove(e: PointerEvent) {
    if (!scrub || e.pointerId !== scrub.id) return;
    const dx = e.clientX - scrub.startX;
    if (!scrub.moved) {
      if (Math.abs(dx) < SCRUB_THRESHOLD_PX) return;
      scrub.moved = true;
      // A value typed but not yet committed is committed first, and the drag starts from it: the
      // blur below skips the commit while dragging, which would throw the typing away.
      if (editing) {
        const typed = typedValue();
        editing = false;
        if (typed !== null) {
          send(typed);
          scrub.startValue = Math.min(max, Math.max(min, typed));
          scrub.last = typed;
        }
      }
      dragging = scrub.startValue;
      input?.blur(); // a caret blinking in a field being dragged is a lie; `dragging` skips commit
    }
    const next = scrubbedValue({
      startValue: scrub.startValue,
      dx,
      step,
      pxPerStep,
      fine: e.shiftKey,
      min,
      max,
    });
    dragging = next;
    if (next !== scrub.last) {
      scrub.last = next;
      onchange(next);
    }
  }

  function end(e?: PointerEvent) {
    if (!scrub || (e && e.pointerId !== scrub.id)) return;
    window.removeEventListener("pointermove", onpointermove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    const moved = scrub.moved;
    scrub = null;
    dragging = null;
    if (moved) swallowNextClick(); // a tap: the field is focused for typing, nothing written
  }

  // The dialog closing mid-drag removes the field; its window listeners must go with it.
  $effect(() => () => end());

  /** A drag released over a dialog backdrop makes the browser fire a `click` there, which would
   *  close the dialog (slop-animator's finding). Swallow exactly that one click, in the capture
   *  phase, bounded by the first click seen and by a timeout. */
  function swallowNextClick() {
    const timer = setTimeout(() => window.removeEventListener("click", swallow, true), 400);
    function swallow(e: MouseEvent) {
      e.stopPropagation();
      e.preventDefault();
      clearTimeout(timer);
      window.removeEventListener("click", swallow, true);
    }
    window.addEventListener("click", swallow, true);
  }
</script>

<!-- `touch-pan-y`, never `touch-none`: a vertical finger-scroll of a scrolling dialog must still
     scroll, and the browser taking the pan cancels the pointer stream, which ends the drag. -->
<input
  bind:this={input}
  class="h-7 cursor-ew-resize touch-pan-y rounded-md border border-border bg-surface-raised px-2 text-xs text-text tabular-nums focus:border-accent {cls}"
  type="text"
  inputmode="decimal"
  value={shown}
  title="{title} — drag sideways or type"
  onfocus={(e) => {
    // WebKit focuses the field again during a drag, after the drag blurred it: taken as typing,
    // the drag's start value was left showing as the draft once it ended.
    if (dragging !== null) return e.currentTarget.blur();
    draft = e.currentTarget.value;
    initial = draft;
    editing = true;
  }}
  oninput={onTyped}
  onkeydown={(e) => {
    // Enter commits here, before the dialog's own Enter (on window) confirms with the new value.
    if (e.key === "Enter") e.currentTarget.blur();
    else if (e.key === "Escape") {
      editing = false;
      e.currentTarget.blur();
    } else e.stopPropagation();
  }}
  {onpointerdown}
  onblur={() => {
    // The blur the drag itself fires must not commit: the drag has already written live.
    if (dragging !== null) editing = false;
    else if (editing) commit();
  }}
/>
