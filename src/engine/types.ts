/**
 * Core data model for Feelers.
 *
 * A project holds a bank of parameter *series* and four *lines*. Each line
 * owns four *heads*, one per parameter kind. A head points into a series of
 * the matching kind and walks it independently. A note is assembled by
 * reading one value from each of the line's four heads.
 *
 * Everything here is plain JSON-serialisable data. Runtime-only state
 * (loop counters, next onset time, sounding note) lives in engine/engine.ts.
 */

/** The four parameter kinds. Order matters for display. */
export const KINDS = ['time', 'pitch', 'velocity', 'artic'] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  time: 'Time',
  pitch: 'Pitch',
  velocity: 'Velocity',
  artic: 'Articulation',
};

export const KIND_SHORT: Record<Kind, string> = {
  time: 'TIM',
  pitch: 'PIT',
  velocity: 'VEL',
  artic: 'ART',
};

/** Ticks per quarter note. Matches MIDI clock resolution (24 PPQN). */
export const PPQ = 24;

/**
 * Randomisation flag carried by a value cell.
 *  0: never randomised.
 *  1: "wobble"  - the value read may be displaced, the stored value is kept.
 *  2: "drift"   - the displacement is written back, so the series wanders.
 */
export type RandFlag = 0 | 1 | 2;

/** A cell in a series: a value, or a series control element. */
export type Cell =
  | { t: 'v'; v: number; r?: RandFlag }
  /** Skip: the head hops over the next value cell in its direction of travel. */
  | { t: 'skip' }
  /** Rest: the note assembled from this read is silent. */
  | { t: 'rest' }
  /** Loop open bracket. */
  | { t: 'open' }
  /** Loop close bracket: the bracketed section plays `n` times in total. */
  | { t: 'close'; n: number }
  /** End: the series stops here; later cells are dormant and the head wraps. */
  | { t: 'end' }
  /** Link: the head continues into the next series of the same kind. */
  | { t: 'link' };

export type CellType = Cell['t'];

export interface RandomSettings {
  /** Size of a random step (in the series' own units). */
  amount: number;
  /**
   * 0: gaussian displacement with standard deviation `amount`.
   * n>0: displacement is +/- amount * k for k uniformly in 1..n.
   */
  type: number;
  /** Probability (0-100) that a flagged cell is randomised when read. */
  prob: number;
}

export interface Series {
  id: string;
  kind: Kind;
  name: string;
  cells: Cell[];
  rand: RandomSettings;
  /** Inclusive limits applied to every value read from this series. */
  lo: number;
  hi: number;
}

export type Direction = 1 | -1;

export interface HeadConfig {
  /** Series the head reads. Must be of the head's kind. */
  series: string;
  /** Cell index the head starts from on Start / Reset. */
  start: number;
  /** Direction on Start / Reset. */
  startDir: Direction;
}

export interface LineConfig {
  name: string;
  /** MIDI channel 1-16. */
  channel: number;
  /** Program change sent on Start (and when changed), or null for none. */
  program: number | null;
  /** Semitones added to every pitch. */
  transpose: number;
  /** Added to every velocity. */
  velOffset: number;
  /**
   * Time adjust: multiplier applied to every time value.
   * 2 = half speed, 0.5 = double speed, 1.02 = drifts slowly behind.
   */
  timeScale: number;
  /** Delay before the line's first note on Start, in ticks. */
  delay: number;
  /** Legato: allow the previous note to overlap the next (else strict mono). */
  legato: boolean;
  mute: boolean;
  heads: Record<Kind, HeadConfig>;
}

export interface ProjectOptions {
  /** Send MIDI Clock and transport messages. */
  clockOut: boolean;
  /** Send each line's program change on Start. */
  programOnStart: boolean;
  /** When editing a time value, compensate with the next one (keeps total). */
  shiftEdit: boolean;
}

export interface Project {
  name: string;
  notes: string;
  tempo: number;
  seed: number;
  options: ProjectOptions;
  series: Series[];
  lines: LineConfig[];
}

/** Value range per kind. */
export const KIND_RANGE: Record<Kind, { min: number; max: number }> = {
  time: { min: 1, max: 999 },
  pitch: { min: 0, max: 127 },
  velocity: { min: 0, max: 127 },
  artic: { min: 1, max: 400 },
};

export const MAX_CELLS = 64;
export const LINE_COUNT = 4;
