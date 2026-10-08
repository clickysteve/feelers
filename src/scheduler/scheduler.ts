/**
 * Lookahead scheduler: turns engine notes into timestamped MIDI.
 *
 * A ticker calls `pump()` every ~25 ms. Each pump asks the engine for all
 * notes whose onset falls before now + lookahead, converts their tick
 * positions to absolute milliseconds through the tempo anchor, and hands them
 * to the MIDI output with timestamps. Note-offs wait in a queue and are only
 * handed over once they too fall inside the window, so they can still be
 * moved (monophonic cut, pause) or dropped (stop).
 *
 * Transport semantics:
 *  - start():   reset the engine to its defined starting state and play.
 *  - pause():   suspend at the end of the current window, keeping all state.
 *  - resume():  carry on from exactly where pause left off.
 *  - stop():    silence immediately, reset to the beginning.
 */
import type { Engine, NoteEvent } from '../engine/engine';
import { PPQ } from '../engine/types';
import { CLOCK, CONTINUE, START, STOP, programChange, songPosition } from '../midi/messages';
import type { MidiOutput } from '../midi/output';

export interface Ticker {
  start(fn: () => void, intervalMs: number): void;
  stop(): void;
}

export class IntervalTicker implements Ticker {
  private h: ReturnType<typeof setInterval> | null = null;
  start(fn: () => void, intervalMs: number): void {
    this.stop();
    this.h = setInterval(fn, intervalMs);
  }
  stop(): void {
    if (this.h !== null) clearInterval(this.h);
    this.h = null;
  }
}

/**
 * Ticker driven from a dedicated worker, which browsers throttle far less
 * than main-thread timers when the tab is in the background.
 */
export class WorkerTicker implements Ticker {
  private worker: Worker | null = null;
  private fallback = new IntervalTicker();
  start(fn: () => void, intervalMs: number): void {
    this.stop();
    try {
      const src = `let h=null;onmessage=(e)=>{if(h)clearInterval(h);h=null;if(e.data>0)h=setInterval(()=>postMessage(0),e.data)}`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = () => fn();
      this.worker.postMessage(intervalMs);
    } catch {
      this.worker = null;
      this.fallback.start(fn, intervalMs);
    }
  }
  stop(): void {
    if (this.worker) {
      this.worker.postMessage(0);
      this.worker.terminate();
      this.worker = null;
    }
    this.fallback.stop();
  }
}

export type TransportState = 'stopped' | 'playing' | 'paused';

export type SchedulerEvent =
  | { type: 'transport'; state: TransportState }
  | { type: 'note'; note: NoteEvent; ms: number; offMs: number }
  | { type: 'tempo'; bpm: number };

interface PendingOff {
  tick: number;
  id: number;
  channel: number;
  pitch: number;
  line: number;
}

export interface SchedulerOptions {
  lookaheadMs: number;
  intervalMs: number;
  /** Delay between pressing Start/Continue and the first event. */
  startLatencyMs: number;
}

export const DEFAULT_SCHEDULER_OPTIONS: SchedulerOptions = { lookaheadMs: 100, intervalMs: 25, startLatencyMs: 40 };

export class Scheduler {
  state: TransportState = 'stopped';
  bpm: number;
  opts: SchedulerOptions;
  private anchorTick = 0;
  private anchorMs = 0;
  private pauseTick = 0;
  private clockTick = 0;
  private pending: PendingOff[] = [];
  private lineHeld: (PendingOff | null)[] = [null, null, null, null];
  private listeners = new Set<(e: SchedulerEvent) => void>();

  constructor(
    public engine: Engine,
    public out: MidiOutput,
    private now: () => number,
    private ticker: Ticker,
    opts: Partial<SchedulerOptions> = {},
  ) {
    this.bpm = engine.project.tempo;
    this.opts = { ...DEFAULT_SCHEDULER_OPTIONS, ...opts };
  }

  on(fn: (e: SchedulerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: SchedulerEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  get msPerTick(): number {
    return 60000 / (this.bpm * PPQ);
  }

  tickToMs(t: number): number {
    return this.anchorMs + (t - this.anchorTick) * this.msPerTick;
  }

  msToTick(ms: number): number {
    return this.anchorTick + (ms - this.anchorMs) / this.msPerTick;
  }

  /** The transport position in ticks as heard now. */
  positionTick(): number {
    if (this.state === 'playing') return Math.max(0, Math.min(this.engine.horizon, this.msToTick(this.now())));
    if (this.state === 'paused') return this.pauseTick;
    return 0;
  }

  /**
   * The tick from which performance interventions apply: the end of what has
   * already been handed to MIDI. Within one lookahead window of now.
   */
  at(): number {
    if (this.state === 'playing') return this.engine.horizon;
    if (this.state === 'paused') return this.pauseTick;
    return 0;
  }

  private get clockOut(): boolean {
    return this.engine.project.options.clockOut;
  }

  start(): void {
    if (this.state !== 'stopped') this.stop();
    this.engine.reset();
    this.pending = [];
    this.lineHeld = [null, null, null, null];
    this.anchorTick = 0;
    this.anchorMs = this.now() + this.opts.startLatencyMs;
    this.clockTick = 0;
    const t0 = this.anchorMs;
    if (this.engine.project.options.programOnStart) {
      for (const l of this.engine.project.lines) {
        if (l.program !== null) this.out.send(programChange(l.channel, l.program), t0 - 1);
      }
    }
    if (this.clockOut) this.out.send([START], t0);
    this.state = 'playing';
    this.emit({ type: 'transport', state: this.state });
    this.ticker.start(() => this.pump(), this.opts.intervalMs);
    this.pump();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.pauseTick = this.engine.horizon;
    const pms = this.tickToMs(this.pauseTick);
    this.flushPending(this.pauseTick);
    for (const p of this.pending) this.out.noteOff(p.channel, p.pitch, p.id, pms);
    this.pending = [];
    this.lineHeld = [null, null, null, null];
    if (this.clockOut) this.out.send([STOP], pms);
    this.ticker.stop();
    this.state = 'paused';
    this.emit({ type: 'transport', state: this.state });
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.anchorTick = this.pauseTick;
    this.anchorMs = this.now() + this.opts.startLatencyMs;
    if (this.clockOut) this.out.send([CONTINUE], this.anchorMs);
    this.state = 'playing';
    this.emit({ type: 'transport', state: this.state });
    this.ticker.start(() => this.pump(), this.opts.intervalMs);
    this.pump();
  }

  stop(): void {
    this.ticker.stop();
    this.out.releaseAll(true);
    this.pending = [];
    this.lineHeld = [null, null, null, null];
    if (this.clockOut && this.state !== 'stopped') {
      const t = this.now();
      if (this.state === 'playing') this.out.send([STOP], t);
      this.out.send(songPosition(0), t);
    }
    this.state = 'stopped';
    this.pauseTick = 0;
    this.engine.reset();
    this.emit({ type: 'transport', state: this.state });
  }

  setTempo(bpm: number): void {
    const b = Math.min(400, Math.max(10, bpm));
    if (this.state === 'playing') {
      const h = this.engine.horizon;
      this.anchorMs = this.tickToMs(h);
      this.anchorTick = h;
    }
    this.bpm = b;
    this.engine.project.tempo = b;
    this.emit({ type: 'tempo', bpm: b });
  }

  /** Called by the ticker. Schedules everything up to now + lookahead. */
  pump(): void {
    if (this.state !== 'playing') return;
    const horizonTick = this.msToTick(this.now() + this.opts.lookaheadMs);
    if (horizonTick <= this.engine.horizon) return;
    const notes = this.engine.generate(horizonTick);
    for (const ev of notes) {
      this.flushClock(ev.tick, true);
      this.flushPending(ev.tick, true);
      this.handleNote(ev);
    }
    this.flushClock(horizonTick, false);
    this.flushPending(horizonTick, false);
  }

  private flushClock(until: number, inclusive: boolean): void {
    while (inclusive ? this.clockTick <= until : this.clockTick < until) {
      if (this.clockOut) this.out.send([CLOCK], this.tickToMs(this.clockTick));
      this.clockTick++;
    }
  }

  private flushPending(until: number, inclusive = false): void {
    while (this.pending.length) {
      const p = this.pending[0]!;
      if (inclusive ? p.tick > until : p.tick >= until) break;
      this.pending.shift();
      this.out.noteOff(p.channel, p.pitch, p.id, this.tickToMs(p.tick));
      if (this.lineHeld[p.line] === p) this.lineHeld[p.line] = null;
    }
  }

  private removePending(p: PendingOff): void {
    const i = this.pending.indexOf(p);
    if (i !== -1) this.pending.splice(i, 1);
  }

  private insertPending(p: PendingOff): void {
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1]!.tick > p.tick) i--;
    this.pending.splice(i, 0, p);
  }

  /**
   * Monophonic handling: a line holds at most one note. A new note cuts the
   * previous one at its onset (strict), or just after its onset (legato), so
   * mono synths can glide. Re-striking the same pitch always cuts first.
   * Silent events (rests) leave a sounding note to finish naturally.
   */
  private handleNote(ev: NoteEvent): void {
    const ms = this.tickToMs(ev.tick);
    const held = this.lineHeld[ev.line];
    let legatoRelease: PendingOff | null = null;
    if (held && !ev.silent) {
      this.removePending(held);
      this.lineHeld[ev.line] = null;
      const same = held.channel === ev.channel && held.pitch === ev.pitch;
      if (ev.legato && !same) legatoRelease = held;
      else this.out.noteOff(held.channel, held.pitch, held.id, ms);
    }
    const offTick = ev.tick + ev.duration;
    if (!ev.silent) {
      const id = this.out.noteOn(ev.channel, ev.pitch, ev.velocity, ms);
      const p: PendingOff = { tick: offTick, id, channel: ev.channel, pitch: ev.pitch, line: ev.line };
      this.insertPending(p);
      this.lineHeld[ev.line] = p;
    }
    if (legatoRelease) this.out.noteOff(legatoRelease.channel, legatoRelease.pitch, legatoRelease.id, ms);
    this.emit({ type: 'note', note: ev, ms, offMs: this.tickToMs(offTick) });
  }

  /**
   * Manual step of one line. While playing (line paused) the note lands at the
   * scheduling horizon; otherwise it is auditioned immediately.
   */
  stepLine(line: number): void {
    if (this.state === 'playing') {
      const ev = this.engine.step(line, this.engine.horizon);
      if (ev) this.handleNote(ev);
      return;
    }
    const at = this.state === 'paused' ? this.pauseTick : 0;
    const wasPaused = this.engine.lines[line]!.paused;
    if (!wasPaused) this.engine.setPaused(line, true, at);
    const ev = this.engine.step(line, at);
    if (!wasPaused) this.engine.setPaused(line, false, at);
    if (!ev) return;
    const ms = this.now() + 5;
    const offMs = ms + ev.duration * this.msPerTick;
    if (!ev.silent) {
      const id = this.out.noteOn(ev.channel, ev.pitch, ev.velocity, ms);
      this.out.noteOff(ev.channel, ev.pitch, id, offMs);
    }
    this.emit({ type: 'note', note: ev, ms, offMs });
  }

  /** Program change sent immediately (live). */
  sendProgram(line: number): void {
    const l = this.engine.project.lines[line];
    if (l && l.program !== null) this.out.send(programChange(l.channel, l.program), this.now());
  }

  /** Release a line's sounding note now (used when muting). */
  releaseLine(line: number): void {
    const held = this.lineHeld[line];
    if (!held) return;
    this.removePending(held);
    this.lineHeld[line] = null;
    this.out.noteOff(held.channel, held.pitch, held.id, Math.max(this.now(), this.state === 'playing' ? this.tickToMs(this.engine.horizon) : 0));
  }

  dispose(): void {
    this.ticker.stop();
  }
}
