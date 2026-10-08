/**
 * The Feelers engine.
 *
 * Pure musical logic: no clocks, no MIDI, no DOM. Time is measured in ticks
 * (24 per quarter note) from the moment of Start. The scheduler asks the
 * engine for every note whose onset falls before a horizon; the engine walks
 * each line's heads to assemble those notes, in onset order.
 *
 * Interventions (reverse, next, reset, pause, edits) are applied directly to
 * the engine state. Because notes are only assembled when they fall inside
 * the scheduler's short lookahead window, interventions are heard within that
 * window and never require precomputed note lists to be rebuilt.
 */
import { Rng } from './rng';
import { newHead, readHead, type HeadState } from './series';
import type { Direction, Kind, LineConfig, Project, Series } from './types';
import { KINDS, LINE_COUNT } from './types';

export interface HeadRead {
  series: string;
  index: number | null;
  value: number | null;
  rest: boolean;
  randomised: boolean;
}

export interface NoteEvent {
  line: number;
  /** Onset in ticks since Start. */
  tick: number;
  /** Inter-onset time to this line's next note, in ticks (after time adjust). */
  time: number;
  /** Sounding length in ticks. */
  duration: number;
  pitch: number;
  velocity: number;
  channel: number;
  /** True when silent (rest element, velocity 0, or muted line). */
  silent: boolean;
  rest: boolean;
  muted: boolean;
  legato: boolean;
  reads: Record<Kind, HeadRead>;
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
}

export type EngineListener = (e: EngineChange) => void;
export type EngineChange =
  | { type: 'cell'; series: string; index: number }
  | { type: 'line'; line: number }
  | { type: 'reset' };

export function cloneProject(p: Project): Project {
  return JSON.parse(JSON.stringify(p)) as Project;
}

export class Engine {
  project: Project;
  lines: LineRuntime[] = [];
  rng: Rng;
  /** Ticks up to which notes have been assembled. */
  horizon = 0;
  private listeners = new Set<EngineListener>();

  constructor(project: Project) {
    this.project = project;
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

  series(id: string): Series | undefined {
    return this.project.series.find((s) => s.id === id);
  }

  /** Replace the whole project (load). Resets runtime state. */
  load(project: Project): void {
    this.project = project;
    this.reset();
  }

  /**
   * Return to the defined beginning: heads to their start cells and
   * directions, loop counters cleared, random generator reseeded, each line
   * waiting for its delay. Line pauses are released.
   */
  reset(): void {
    this.rng = new Rng(this.project.seed);
    this.horizon = 0;
    this.lines = [];
    for (let i = 0; i < LINE_COUNT; i++) {
      this.lines.push(this.freshLine(i));
    }
    this.emit({ type: 'reset' });
  }

  private freshLine(i: number): LineRuntime {
    const cfg = this.project.lines[i]!;
    const heads = {} as Record<Kind, HeadState>;
    for (const k of KINDS) {
      const h = cfg.heads[k];
      heads[k] = newHead(k, h.series, h.start, h.startDir);
    }
    return { heads, nextTick: Math.max(0, cfg.delay), paused: false, remaining: 0, count: 0, last: null };
  }

  cfg(line: number): LineConfig {
    return this.project.lines[line]!;
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

  /** Read one value from each head of a line and build the note. */
  private assemble(line: number, tick: number): NoteEvent {
    const cfg = this.cfg(line);
    const rt = this.lines[line]!;
    const ctx = {
      bank: this.project.series,
      rng: this.rng,
      onCellChanged: (series: string, index: number) => this.emit({ type: 'cell', series, index }),
    };
    const reads = {} as Record<Kind, HeadRead>;
    for (const k of KINDS) {
      const r = readHead(rt.heads[k], ctx);
      reads[k] = {
        series: r.series,
        index: r.index,
        value: r.value,
        rest: r.rest,
        randomised: !r.rest && r.randomised,
      };
    }
    const timeValue = reads.time.value ?? 24;
    const time = Math.max(0.05, timeValue * Math.max(0.01, cfg.timeScale));
    const artic = reads.artic.value ?? 100;
    const duration = Math.max(0.05, (time * artic) / 100);
    let pitch = (reads.pitch.value ?? 60) + cfg.transpose;
    while (pitch > 127) pitch -= 12;
    while (pitch < 0) pitch += 12;
    const velocity = Math.min(127, Math.max(0, (reads.velocity.value ?? 0) + cfg.velOffset));
    const rest = reads.time.rest || reads.pitch.rest || reads.velocity.rest || reads.artic.rest;
    const silent = rest || velocity === 0 || cfg.mute;
    const ev: NoteEvent = {
      line,
      tick,
      time,
      duration,
      pitch,
      velocity: Math.max(1, velocity),
      channel: cfg.channel,
      silent,
      rest,
      muted: cfg.mute,
      legato: cfg.legato,
      reads,
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
    // Step back over the cell just read so that reversing replays from the
    // current cell outward rather than skipping one.
    if (h.lastIndex !== null && h.lastSeries === h.series) h.pos = h.lastIndex + dir;
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

  /** Point a head at a different series (keeps direction, starts at cell 0 or the end). */
  setHeadSeries(line: number, kind: Kind, seriesId: string, at?: number): void {
    const s = this.series(seriesId);
    if (!s || s.kind !== kind) return;
    const h = this.lines[line]!.heads[kind];
    h.series = seriesId;
    h.pos = at ?? 0;
    h.loops = {};
    h.skip = false;
    this.cfg(line).heads[kind].series = seriesId;
    this.emit({ type: 'line', line });
  }

  /** Move a head to a cell (manual repositioning). */
  setHeadPos(line: number, kind: Kind, index: number): void {
    const h = this.lines[line]!.heads[kind];
    h.pos = index;
    h.loops = {};
    h.skip = false;
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
    const fresh = this.freshLine(line);
    const old = this.lines[line]!;
    fresh.paused = old.paused;
    fresh.nextTick = old.paused ? Infinity : at;
    fresh.remaining = 0;
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

  /** Set a cell value; with shift-edit the next time value compensates. */
  setValue(seriesId: string, index: number, value: number, shift = false): void {
    const s = this.series(seriesId);
    const c = s?.cells[index];
    if (!s || !c || c.t !== 'v') return;
    const old = c.v;
    c.v = value;
    this.emit({ type: 'cell', series: seriesId, index });
    if (shift && s.kind === 'time') {
      const delta = old - value;
      for (let i = index + 1; i < s.cells.length; i++) {
        const n = s.cells[i]!;
        if (n.t === 'end') break;
        if (n.t === 'v') {
          n.v = Math.max(1, n.v + delta);
          this.emit({ type: 'cell', series: seriesId, index: i });
          break;
        }
      }
    }
  }
}
