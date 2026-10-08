/**
 * Core data model for Feelers (project format v2).
 *
 * The score is a row of typed *columns*. A column holds up to 16 *elements*
 * of one parameter kind (Time, Pitch, Velocity or S/L). Series control
 * elements are attributes of the element they sit beside, as in Fingers:
 * a Skip, a rest or an auto-randomise mark never occupies a step of its own.
 * Only a Loop takes up an element slot.
 *
 * A *series* is what a head walks: End of Series flags split a column into
 * several independent series, and a column's Link flag joins its bottom to
 * the top of the next column of the same kind to the right (wrapping), so
 * several columns can act as one long series. See engine/series.ts.
 *
 * Each of the four lines owns four *heads*, one per kind. A note is assembled
 * from one element under each head. Everything here is plain JSON data;
 * runtime state (loop counters, pending time, next onset) lives in
 * engine/engine.ts.
 */

/** The four parameter kinds. Order matters for display. */
export const KINDS = ['time', 'pitch', 'velocity', 'artic'] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  time: 'Time',
  pitch: 'Pitch',
  velocity: 'Velocity',
  artic: 'S/L',
};

export const KIND_SHORT: Record<Kind, string> = {
  time: 'TIM',
  pitch: 'PIT',
  velocity: 'VEL',
  artic: 'S/L',
};

/** Ticks per quarter note. Matches MIDI clock resolution (24 PPQN). */
export const PPQ = 24;

/**
 * Auto-randomise mark on an element.
 *  1: `?`  (Fingers) - may be randomised when read, using the kind's first probability; the change is kept.
 *  2: `¿`  (Fingers) - the same, using the second probability.
 *  3: `~`  WOBBLE (Feelers extension) - may be displaced when read; the stored value is kept.
 */
export type AutoRand = 1 | 2 | 3;

/** Rest marks: `R` advances only Tim and the series holding the Rest; `r` advances every head. */
export type RestMark = 'R' | 'r';

/** One element of a column. */
export interface El {
  /** The value, or null for a blank element (passed over unless it carries a rest). */
  v: number | null;
  /** Loop element: occupies the slot; repeat count, 0 = forever. When set, `v` is null. */
  loop?: number;
  /** End of Series: this element is the last of its series. */
  end?: true;
  /** Skip: heads pass over this element (End still applies). */
  skip?: true;
  rest?: RestMark;
  ar?: AutoRand;
}

/** Randomisation settings: Fingers keeps one set per parameter kind. */
export interface RandomSettings {
  /** Size of a random step (in the kind's own units). */
  amount: number;
  /** 0: gaussian change whose average size is about `amount`. n>0: +/- amount * k, k in 1..n. */
  type: number;
  /** Probability (0-100) for `?` elements. */
  p1: number;
  /** Probability (0-100) for `¿` elements. */
  p2: number;
  /** Probability (0-100) for WOBBLE elements (Feelers extension). */
  pw: number;
}

/**
 * Per-column randomisation (Feelers extension): replaces the kind's settings
 * for this column, with optional bounds that apply to randomised values only.
 */
export interface ColumnRandom extends RandomSettings {
  lo?: number;
  hi?: number;
}

export interface Column {
  id: string;
  kind: Kind;
  name: string;
  /** Column Link: the bottom continues at the top of the next column of this kind (wrapping). */
  link: boolean;
  els: El[];
  rand?: ColumnRandom;
}

export type Direction = 1 | -1;

/** A position in the score. */
export interface Pos {
  col: string;
  i: number;
}

export interface HeadConfig {
  /** Column the head starts in. Must be of the head's kind. */
  col: string;
  /** Element index the head starts from on Start / Reset. */
  start: number;
  /** Direction on Start / Reset. */
  startDir: Direction;
}

/**
 * How a line's notes may overlap.
 *  written: every note keeps its computed length (Fingers: S/L 16 and above overlap).
 *  legato:  the previous note is released just after the next one starts (glide on mono synths).
 *  mono:    strict monophony, each note ends before the next.
 * In every mode a repeated pitch is released before it is struck again.
 */
export type Overlap = 'written' | 'legato' | 'mono';

export type QuantDir = 'nearest' | 'down' | 'up';

export interface ScaleSpec {
  /** Pitch class of the root, 0 = C. */
  root: number;
  scale: string;
  dir: QuantDir;
}

/** Project-wide Scale Mode (a modern Feelers facility, not part of Fingers). */
export interface GlobalScale extends ScaleSpec {
  on: boolean;
}

/** A line follows the global scale, uses its own, or ignores Scale Mode. */
export interface LineScale extends ScaleSpec {
  mode: 'global' | 'own' | 'off';
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
   * Time adjust: multiplier applied to every time value (Fingers' Tm / 16).
   * 2 = half speed, 0.5 = double speed, 1.02 = drifts slowly behind.
   */
  timeScale: number;
  /** Delay before the line's first note on Start, in ticks. */
  delay: number;
  overlap: Overlap;
  mute: boolean;
  scale: LineScale;
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

/** A stored performance state: where every head is and how each line is set. */
export interface SnapshotLine {
  heads: Record<Kind, { col: string; pos: number; dir: Direction }>;
  paused: boolean;
  mute: boolean;
  transpose: number;
  velOffset: number;
  timeScale: number;
}

export interface Snapshot {
  tempo: number;
  lines: SnapshotLine[];
}

export const SNAPSHOT_SLOTS = 9;

export interface Project {
  name: string;
  notes: string;
  tempo: number;
  seed: number;
  options: ProjectOptions;
  columns: Column[];
  /** Randomisation settings per kind (Fingers' Options screen). */
  random: Record<Kind, RandomSettings>;
  /** Randomised Tim values never go below this. */
  minTime: number;
  /** Randomised Pit values stay within this many semitones of the series' range at Start. */
  pitchLimit: number;
  scale: GlobalScale;
  lines: LineConfig[];
  /** Performance memories 1-9 (null = empty). */
  snapshots: (Snapshot | null)[];
}

/** Value range per kind. S/L is in sixteenths of the next Time value. */
export const KIND_RANGE: Record<Kind, { min: number; max: number }> = {
  time: { min: 1, max: 999 },
  pitch: { min: 0, max: 127 },
  velocity: { min: 0, max: 127 },
  artic: { min: 1, max: 64 },
};

/** Elements per column (Fingers). */
export const MAX_ELS = 16;
/** Columns in a score. Fingers had 13 or 16; migrated projects may need more. */
export const MAX_COLUMNS = 32;
export const LINE_COUNT = 4;
/** Loop counts 0-999; 0 repeats forever. */
export const MAX_LOOP = 999;
