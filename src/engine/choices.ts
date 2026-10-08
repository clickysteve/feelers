/**
 * Behaviours the historical sources leave open (see docs/UNCERTAINTIES.md).
 *
 * Each is a deliberate, documented choice, isolated here so that it can be
 * changed in one place and tested both ways. None of them has been verified
 * against a running copy of Fingers.
 */
export interface EngineChoices {
  /**
   * Whether a line's first Time value is waited before its first note.
   * false (default): the first note sounds at Start plus the line's delay;
   * the Time value read with it is consumed, and every later note waits its
   * own Time value. true: the first note also waits its Time value.
   */
  firstNoteWaits: boolean;
  /**
   * Meaning of a Loop count n (n > 0).
   * 'repeats' (default): the looped section is repeated n more times (n + 1 passes).
   * 'passes': the section plays n times in total.
   */
  loopCount: 'repeats' | 'passes';
}

export const DEFAULT_CHOICES: EngineChoices = {
  firstNoteWaits: false,
  loopCount: 'repeats',
};
