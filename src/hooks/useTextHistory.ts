import { useCallback, useRef, useState } from 'react';

/**
 * Undo/redo for a text field that has no Save button.
 *
 * The diary and the notes writer both save on their own, so a deletion is on
 * disk within a second of being made and there is nothing to cancel out of.
 * This keeps the recent shape of the text in memory instead, so the person can
 * walk back to what was there before.
 *
 * History lives only while the page or note is open: opening another day, or
 * another note, starts again from that text.
 */

/** Typing that carries on inside this window folds into a single step. */
const COALESCE_MS = 800;
/** Deep enough to undo a mistake, shallow enough not to hold a session of text. */
const MAX_STEPS = 60;

export function useTextHistory(apply: (text: string) => void) {
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const value = useRef('');
  const lastEditAt = useRef(0);
  // Only the two counts drive a render; the text itself stays in refs so
  // typing does not re-render the editor twice per keystroke.
  const [depth, setDepth] = useState({ undo: 0, redo: 0 });

  // Only the counts matter, and they rarely change, so a keystroke usually
  // costs nothing beyond the render the editor was doing anyway.
  const sync = () => setDepth(prev => (
    prev.undo === past.current.length && prev.redo === future.current.length
      ? prev
      : { undo: past.current.length, redo: future.current.length }
  ));

  /** Starts a fresh history: another note, or another day's page. */
  const reset = useCallback((text: string) => {
    past.current = [];
    future.current = [];
    value.current = text ?? '';
    lastEditAt.current = 0;
    sync();
  }, []);

  /**
   * Call this with every edit the person makes.
   *
   * Consecutive typing folds into one step, but anything that removes a run of
   * text — a selection replaced, a cut, a long press and clear — is kept as a
   * step of its own, so one undo brings all of it back at once.
   */
  const record = useCallback((next: string) => {
    const previous = value.current;
    if (next === previous) return;

    const now = Date.now();
    const removedRun = previous.length - next.length > 1;

    if (removedRun || now - lastEditAt.current > COALESCE_MS) {
      past.current.push(previous);
      if (past.current.length > MAX_STEPS) past.current.shift();
    }

    // A removal closes the step, so the next keystroke is not folded into it
    lastEditAt.current = removedRun ? 0 : now;
    future.current = [];
    value.current = next;
    sync();
  }, []);

  const step = useCallback((from: { current: string[] }, to: { current: string[] }) => {
    if (from.current.length === 0) return;
    to.current.push(value.current);
    const text = from.current.pop() as string;
    value.current = text;
    lastEditAt.current = 0;
    sync();
    apply(text);
  }, [apply]);

  const undo = useCallback(() => step(past, future), [step]);
  const redo = useCallback(() => step(future, past), [step]);

  return {
    record,
    reset,
    undo,
    redo,
    canUndo: depth.undo > 0,
    canRedo: depth.redo > 0,
  };
}
