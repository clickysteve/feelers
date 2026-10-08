/**
 * The Feelers engine.
 *
 * Pure musical logic: no clocks, no MIDI, no DOM. Time is measured in ticks
 * (24 per quarter note) from the moment of Start. The scheduler asks the
 * engine for every note whose onset falls before a horizon; the engine walks
 * each line's heads to assemble those notes, in onset order.
 *
 * Note assembly follows the Fingers manual:
 *  - A note's Time value is the wait *before* that note. Its length is the
 *    *next* Time value (after time adjust) times its S/L value / 16.
 *  - A Rest (R) silences the note; only the Time head and the head that read
 *    the Rest advance. A rest (r) silences the note; every head advances.
 * Scale Mode (a modern facility) constrains the final pitch without touching
 * the stored series; see engine/scale.ts for the order of pitch processing.
 *
 * Interventions (reverse, next, reset, pause, edits) are applied directly to
 * the engine state. Notes are only assembled when they fall inside the
 * scheduler's short lookahead window, so interventions are heard within that
 * window and never require precomputed note lists to be rebuilt.
 */
import { DEFAULT_CHOICES, type EngineChoices } from './choices';
import { Rng } from './rng';
import { constrain, effectiveScale } from './scale';
import { NOTHING, Score, newHead, peekHead, pitchRanges, rawNext, readHead, samePos, seriesKey, step, type HeadState, type Read, type ReadContext } from './series';
import type { Column, Direction, GlobalScale, Kind, LineConfig, Overlap, Pos, Project, RandomSettings, RestMark, Snapshot } from './types';
import { KINDS, LINE_COUNT } from './types';

export interface HeadRead {
  pos: Pos | null;
  value: number | null;
  rest: RestMark | null;
  randomised: boolean;
  /** The head did not move for this note (held by a Rest elsewhere). */
  held: boolean;
}

export interface NoteEvent {
  line: number;
  /** Onset in ticks since Start. */
  tick: number;
  /** Time to this line's next note, in ticks (the next Time value after time adjust). */
  time: number;
  /** Sounding length in ticks: time x S/L / 16. */
  duration: number;
  /** Emitted MIDI pitch (after transposition and Scale Mode). */
  pitch: number;
  /** Pitch after transposition, before Scale Mode. */
  prePitch: number;
  /** Change made by Scale Mode (pitch - prePitch). */
  scaleDelta: number;
  velocity: number;
  channel: number;
  /** True when silent (rest, velocity 0, or muted line). */
  silent: boolean;
  rest: boolean;
  muted: boolean;
  overlap: Overlap;
  /** Kept for the scheduler's legato handling. */
  legato: boolean;
  /** One read per kind. `time` is this note's own Time value (the wait before it). */
  reads: Record<Kind, HeadRead>;
  /** The following Time value: sets the gap after this note and its length. */
  nextTime: HeadRead;
}

export interface LineRuntime {
  heads: Record<Kind, HeadState>;
  /** Tick of the next onset. Infinity while paused. */
  nextTick: number;
  paused: boolean;
  /** Ticks remaining to the next onset at the moment of pausing. */
  remaining: number;
  /** Number of notes assembled since Start (for display). */
  count: number;
  last: NoteEvent | null;
  /** The Time value already read for the next note, if any. */
  pending: Read | null;
}

export type EngineListener = (e: EngineChange) => void;
export type EngineChange =
  | { type: 'cell'; pos: Pos }
  | { type: 'line'; line: number }
  | { type: 'reset' }
  | { type: 'restore' };

/** Everything Restore Last Start puts back. */
export interface StartState {
  tempo: number;
  columns: Column[];
  lines: LineConfig[];
  random: Record<Kind, RandomSettings>;
  minTime: number;
  pitchLimit: number;
  scale: GlobalScale;
}

export function cloneProject(p: Project): Project {
  return JSON.parse(JSON.stringify(p)) as Project;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function toHeadRead(r: Read, held = false): HeadRead {
  return { pos: r.pos, value: r.value, rest: r.rest, randomised: r.randomised, held };
}

const HELD: HeadRead = { pos: null, value: null, rest: null, randomised: false, held: true };

export class Engine {
  project: Project;
  lines: LineRuntime[] = [];
  rng: Rng;
  /** Ticks up to which notes have been assembled. */
  horizon = 0;
  readonly choices: EngineChoices;
  private listeners = new Set<EngineListener>();
  private ranges = new Map<string, { lo: number; hi: number }>();
  private startState: StartState | null = null;
  private undoState: StartState | null = null;

  constructor(project: Project, choices: Partial<EngineChoices> = {}) {
    this.project = project;
    this.choices = { ...DEFAULT_CHOICES, ...choices };
    this.rng = new Rng(project.seed);
    this.reset();
  }

  on(fn: EngineListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: EngineChange): void {
    for (const fn of this.listeners) fn(e);
  }

  get score(): Score {
    return new Score(this.project.columns);
  }

  column(id: string): Column | undefined {
    return this.project.columns.find((c) => c.id === id);
  }

  /** Replace the whole project (load). Resets runtime state. */
  load(project: Project): void {
    this.project = project;
    this.startState = null;
    this.undoState = null;
    this.reset();
  }

  /**
   * Return to the defined beginning: heads to their start elements and
   * directions, loop counters cleared, random generator reseeded, Pit series
   * ranges taken (for Pitch Limit), each line waiting for its delay.
   */
  reset(): void {
    this.rng = new Rng(this.project.seed);
    this.horizon = 0;
    this.ranges = pitchRanges(this.score);
    this.lines = [];
    for (let i = 0; i < LINE_COUNT; i++) this.lines.push(this.freshLine(i, 0));
    this.emit({ type: 'reset' });
  }

  private freshLine(i: number, at: number, withDelay = true): LineRuntime {
    const cfg = this.project.lines[i]!;
    const heads = {} as Record<Kind, HeadState>;
    for (const k of KINDS) {
      const h = cfg.heads[k];
      heads[k] = newHead(k, h.col, h.start, h.startDir);
    }
    const rt: LineRuntime = { heads, nextTick: at + (withDelay ? Math.max(0, cfg.delay) : 0), paused: false, remaining: 0, count: 0, last: null, pending: null };
    if (this.choices.firstNoteWaits) {
      rt.pending = readHead(heads.time, this.ctx());
      rt.nextTick += this.gap(cfg, rt.pending);
    }
    return rt;
  }

  cfg(line: number): LineConfig {
    return this.project.lines[line]!;
  }

  ctx(): ReadContext {
    const score = this.score;
    return {
      score,
      rng: this.rng,
      choices: this.choices,
      random: this.project.random,
      minTime: this.project.minTime,
      pitchLimit: this.project.pitchLimit,
      pitchRange: (p) => this.ranges.get(seriesKey(score, p)) ?? null,
      onChange: (pos) => this.emit({ type: 'cell', pos }),
    };
  }

  private gap(cfg: LineConfig, t: Read | null): number {
    const v = t && t.value !== null ? t.value : 24;
    return Math.max(0.05, v * Math.max(0.01, cfg.timeScale));
  }

  /**
   * Assemble every note with onset strictly before `until`, in onset order
   * (ties broken by line number). Advances the horizon.
   */
  generate(until: number): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let guard = 0; guard < 100000; guard++) {
      let best = -1;
      let bestTick = Infinity;
      for (let i = 0; i < this.lines.length; i++) {
        const l = this.lines[i]!;
        if (!l.paused && l.nextTick < bestTick) {
          bestTick = l.nextTick;
          best = i;
        }
      }
      if (best === -1 || bestTick >= until) break;
      out.push(this.assemble(best, bestTick));
    }
    this.horizon = Math.max(this.horizon, until);
    return out;
  }

  /** Build the line's next note at `tick`. */
  private assemble(line: number, tick: number): NoteEvent {
    const cfg = this.cfg(line);
    const rt = this.lines[line]!;
    const ctx = this.ctx();
    // This note's own Time value: read with the previous note, or now.
    const own = rt.pending ?? readHead(rt.heads.time, ctx);
    rt.pending = null;
    // Find the rests before moving any head: a Rest holds the other heads.
    const others = ['pitch', 'velocity', 'artic'] as const;
    const peeks = {} as Record<(typeof others)[number], Read>;
    for (const k of others) peeks[k] = peekHead(rt.heads[k], ctx);
    const marks = [own.rest, ...others.map((k) => peeks[k].rest)];
    const allAdvance = marks.includes('r') || !marks.includes('R');
    const reads = { time: toHeadRead(own) } as Record<Kind, HeadRead>;
    for (const k of others) {
      if (allAdvance || peeks[k].rest === 'R') reads[k] = toHeadRead(readHead(rt.heads[k], ctx));
      else reads[k] = HELD;
    }
    // The next Time value: the gap after this note and the basis of its length.
    const next = readHead(rt.heads.time, ctx);
    rt.pending = next;
    const time = this.gap(cfg, next);
    const sl = reads.artic.value ?? 16;
    const duration = Math.max(0.05, (time * sl) / 16);

    let prePitch = (reads.pitch.value ?? 60) + cfg.transpose;
    while (prePitch > 127) prePitch -= 12;
    while (prePitch < 0) prePitch += 12;
    const scaled = constrain(prePitch, effectiveScale(this.project.scale, cfg));
    const velocity = Math.min(127, Math.max(0, (reads.velocity.value ?? 0) + cfg.velOffset));
    const rest = marks.some((m) => m !== null);
    const silent = rest || velocity === 0 || cfg.mute;
    const ev: NoteEvent = {
      line,
      tick,
      time,
      duration,
      pitch: scaled.pitch,
      prePitch,
      scaleDelta: scaled.delta,
      velocity: Math.max(1, velocity),
      channel: cfg.channel,
      silent,
      rest,
      muted: cfg.mute,
      overlap: cfg.overlap,
      legato: cfg.overlap === 'legato',
      reads,
      nextTime: toHeadRead(next),
    };
    rt.nextTick = tick + time;
    rt.count++;
    rt.last = ev;
    return ev;
  }

  // ---------------------------------------------------------------------
  // Performance interventions. `at` is the tick from which they apply,
  // normally the scheduler's horizon so that already-scheduled notes are
  // left alone.

  /** Reverse (or set) the direction of one head. */
  setDirection(line: number, kind: Kind, dir: Direction): void {
    const h = this.lines[line]!.heads[kind];
    if (h.dir === dir) return;
    h.dir = dir;
    // Turn around at the element just read: the next read is its neighbour
    // in the new direction (a Feelers choice; Fingers does not say).
    if (h.last) h.pos = step(this.score, h.last, dir);
    this.emit({ type: 'line', line });
  }

  toggleDirection(line: number, kind: Kind): void {
    const h = this.lines[line]!.heads[kind];
    this.setDirection(line, kind, h.dir === 1 ? -1 : 1);
  }

  /** Reverse all four heads of a line. */
  reverseLine(line: number): void {
    for (const k of KINDS) this.toggleDirection(line, k);
  }

  /** Point a head at a column (keeps direction; starts at element `at`, default the top). */
  setHeadColumn(line: number, kind: Kind, colId: string, at = 0): void {
    const c = this.column(colId);
    if (!c || c.kind !== kind) return;
    const h = this.lines[line]!.heads[kind];
    h.pos = { col: colId, i: at };
    h.loops = {};
    this.cfg(line).heads[kind].col = colId;
    this.emit({ type: 'line', line });
  }

  /** Move a head to an element (manual redirection). */
  setHeadPos(line: number, kind: Kind, index: number): void {
    const h = this.lines[line]!.heads[kind];
    h.pos = { col: h.pos.col, i: index };
    h.loops = {};
    this.emit({ type: 'line', line });
  }

  /** Play the line's next note at `at` instead of waiting (escape a long time value). */
  nextNow(line: number, at: number): void {
    const rt = this.lines[line]!;
    if (rt.paused) return;
    rt.nextTick = Math.max(at, Math.min(rt.nextTick, at));
    this.emit({ type: 'line', line });
  }

  /** Return one line to its starting state and start it again at `at`. */
  resetLine(line: number, at: number): void {
    const old = this.lines[line]!;
    const fresh = this.freshLine(line, at, false);
    fresh.paused = old.paused;
    if (old.paused) {
      fresh.remaining = fresh.nextTick - at;
      fresh.nextTick = Infinity;
    }
    this.lines[line] = fresh;
    this.emit({ type: 'line', line });
  }

  /** Suspend or resume a single line, preserving its remaining wait. */
  setPaused(line: number, paused: boolean, at: number): void {
    const rt = this.lines[line]!;
    if (rt.paused === paused) return;
    if (paused) {
      rt.remaining = Math.max(0, rt.nextTick - at);
      rt.nextTick = Infinity;
      rt.paused = true;
    } else {
      rt.paused = false;
      rt.nextTick = at + rt.remaining;
      rt.remaining = 0;
    }
    this.emit({ type: 'line', line });
  }

  /**
   * Manual step: assemble one note from a paused line at `at`. The line
   * stays paused. Returns the event so the caller can schedule it.
   */
  step(line: number, at: number): NoteEvent | null {
    const rt = this.lines[line]!;
    if (!rt.paused) return null;
    const ev = this.assemble(line, at);
    rt.nextTick = Infinity;
    this.emit({ type: 'line', line });
    return ev;
  }

  /**
   * Advance (negative) or delay (positive) a running line by `delta` ticks.
   * The next onset never moves earlier than `at`.
   */
  nudge(line: number, delta: number, at: number): void {
    const rt = this.lines[line]!;
    if (rt.paused) {
      rt.remaining = Math.max(0, rt.remaining + delta);
    } else {
      rt.nextTick = Math.max(at, rt.nextTick + delta);
    }
    this.emit({ type: 'line', line });
  }

  /** Set an element's value; with shift-edit the next Time value of the series compensates. */
  setValue(p: Pos, value: number, shift = false): void {
    const c = this.column(p.col);
    const e = c?.els[p.i];
    if (!c || !e || e.loop !== undefined) return;
    const old = e.v;
    e.v = value;
    this.emit({ type: 'cell', pos: p });
    if (shift && c.kind === 'time' && old !== null) {
      const sc = this.score;
      let q = rawNext(sc, p);
      for (let g = 0; q && g < 64 && !samePos(q, p); g++) {
        const n = sc.el(q);
        if (n && n.v !== null && n.loop === undefined) {
          n.v = Math.max(1, n.v + old - value);
          this.emit({ type: 'cell', pos: q });
          break;
        }
        q = rawNext(sc, q);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Restore Last Start (Fingers manual, chapter 5)

  private captureState(): StartState {
    const p = this.project;
    return clone({ tempo: p.tempo, columns: p.columns, lines: p.lines, random: p.random, minTime: p.minTime, pitchLimit: p.pitchLimit, scale: p.scale });
  }

  private applyState(s: StartState): void {
    const p = this.project;
    const c = clone(s);
    p.tempo = c.tempo;
    p.columns = c.columns;
    p.lines = c.lines;
    p.random = c.random;
    p.minTime = c.minTime;
    p.pitchLimit = c.pitchLimit;
    p.scale = c.scale;
  }

  /** Called when the performance starts: remember everything for Restore Last Start. */
  captureStart(): void {
    this.startState = this.captureState();
    this.undoState = null;
  }

  get canRestore(): boolean {
    return this.startState !== null;
  }

  get restored(): boolean {
    return this.undoState !== null;
  }

  /**
   * Return every series value and line setting to how it was when Start was
   * last pressed, undoing edits and auto-randomisation. A second call undoes
   * the restore. Heads keep moving from where they are.
   */
  toggleRestore(): 'restored' | 'undone' | null {
    if (!this.startState) return null;
    let result: 'restored' | 'undone';
    if (this.undoState) {
      this.applyState(this.undoState);
      this.undoState = null;
      result = 'undone';
    } else {
      this.undoState = this.captureState();
      this.applyState(this.startState);
      result = 'restored';
    }
    this.emit({ type: 'restore' });
    return result;
  }
}

// -------------------------------------------------------------------------
// Snapshots (performance memories)

/** Capture the live performance state of all lines. */
export function takeSnapshot(e: Engine, tempo: number): Snapshot {
  return {
    tempo,
    lines: e.lines.map((rt, i) => {
      const cfg = e.cfg(i);
      const heads = {} as Snapshot['lines'][number]['heads'];
      for (const k of KINDS) {
        const h = rt.heads[k];
        // Store the element of the note last assembled, so recall replays from it.
        const at = (k === 'time' ? rt.last?.reads.time.pos : h.last) ?? h.pos;
        heads[k] = { col: at.col, pos: at.i, dir: h.dir };
      }
      return { heads, paused: rt.paused, mute: cfg.mute, transpose: cfg.transpose, velOffset: cfg.velOffset, timeScale: cfg.timeScale };
    }),
  };
}

/** Apply a snapshot from tick `at`. Line timing (next onsets) is kept. */
export function recallSnapshot(e: Engine, snap: Snapshot, at: number): void {
  snap.lines.forEach((sl, i) => {
    if (i >= e.lines.length) return;
    const cfg = e.cfg(i);
    cfg.mute = sl.mute;
    cfg.transpose = sl.transpose;
    cfg.velOffset = sl.velOffset;
    cfg.timeScale = sl.timeScale;
    const rt = e.lines[i]!;
    for (const k of KINDS) {
      const s = sl.heads[k];
      const c = e.column(s.col);
      if (!c || c.kind !== k) continue;
      const h = rt.heads[k];
      h.pos = { col: s.col, i: s.pos };
      h.dir = s.dir;
      h.loops = {};
      h.last = null;
      cfg.heads[k].col = s.col;
    }
    rt.pending = null;
    e.setPaused(i, sl.paused, at);
  });
}

export { NOTHING };
