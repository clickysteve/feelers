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
 *
 * Clock source. With the INTERNAL source (default) the scheduler owns time as
 * described above. With the EXTERNAL source an incoming 24 PPQN MIDI Clock
 * stream owns time instead: pulse n *is* engine tick n (the engine already
 * counts 24 ticks per quarter note). Each pulse releases exactly the events
 * whose ticks fall before the next pulse; events between two pulses (from
 * Time Adjust or articulation) are placed by the measured pulse period. FA /
 * FB / FC drive the transport. See docs/ARCHITECTURE.md, "External clock".
 */
import type { Engine, NoteEvent } from '../engine/engine';
import { PPQ } from '../engine/types';
import { CLOCK, CONTINUE, START, STOP, programChange, songPosition } from '../midi/messages';
import type { MidiOutput } from '../midi/output';
import { PulseEstimator } from './pulses';

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

export type ClockSource = 'internal' | 'external';

/**
 * External sync status, for display.
 *  internal  - INTERNAL source selected.
 *  no-input  - EXTERNAL selected but no MIDI input chosen or available.
 *  waiting   - no clock arriving, transport not running.
 *  clock     - clock arriving, transport not running (waiting for Start / Continue).
 *  running   - transport running and following the clock.
 *  stopped   - stopped by an incoming Stop (FC); Continue resumes from here.
 *  lost      - transport running but the clock stopped arriving; notes released, position held.
 */
export type SyncStatus = 'internal' | 'no-input' | 'waiting' | 'clock' | 'running' | 'stopped' | 'lost';

/** No pulse for this long while running means the external clock is lost. */
export const CLOCK_LOSS_MS = 500;

export type SchedulerEvent =
  | { type: 'transport'; state: TransportState }
  | { type: 'note'; note: NoteEvent; ms: number; offMs: number }
  | { type: 'tempo'; bpm: number }
  | { type: 'sync'; status: SyncStatus }
  | { type: 'realtime'; message: 'Start' | 'Continue' | 'Stop'; t: number };

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

  /** Where musical time comes from. Change it with setSource(). */
  source: ClockSource = 'internal';
  /** Measures the incoming clock (display tempo and between-pulse placement only). */
  readonly pulses = new PulseEstimator();
  /** External clock state. */
  readonly ext = {
    /** Tick that the next incoming pulse represents. */
    nextTick: 0,
    /** Tick and arrival time of the most recent pulse (the external anchor). */
    anchorTick: 0,
    anchorMs: 0,
    lastPulseMs: -Infinity,
    /** Pulses received since EXTERNAL was selected. */
    pulseCount: 0,
    /** Pulses that advanced the engine. */
    advanced: 0,
    lost: false,
    /** Whether a usable MIDI input is attached (set by the app). */
    inputReady: false,
    lastTransport: null as null | 'Start' | 'Continue' | 'Stop',
  };
  private lastStatus: SyncStatus = 'internal';

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

  get external(): boolean {
    return this.source === 'external';
  }

  /**
   * Milliseconds per tick. INTERNAL: from the tempo. EXTERNAL: the measured
   * pulse period (falling back to the tempo before two pulses have arrived);
   * it only ever places events between pulses, never advances time.
   */
  get msPerTick(): number {
    if (this.external) {
      const p = this.pulses.periodMs();
      if (p !== null && p > 0) return p;
    }
    return 60000 / (this.bpm * PPQ);
  }

  tickToMs(t: number): number {
    if (this.external) return this.ext.anchorMs + (t - this.ext.anchorTick) * this.msPerTick;
    return this.anchorMs + (t - this.anchorTick) * this.msPerTick;
  }

  msToTick(ms: number): number {
    if (this.external) return this.ext.anchorTick + (ms - this.ext.anchorMs) / this.msPerTick;
    return this.anchorTick + (ms - this.anchorMs) / this.msPerTick;
  }

  /** The transport position in ticks as heard now. */
  positionTick(): number {
    if (this.state === 'playing' && this.external) return Math.max(0, Math.min(this.engine.horizon, this.ext.anchorTick));
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

  /**
   * MIDI Clock output. Always off while following an external clock, so an
   * incoming clock can never be echoed back to its source (no clock-thru).
   */
  get clockOut(): boolean {
    return this.engine.project.options.clockOut && !this.external;
  }

  /** Start / pause / resume are INTERNAL transport; externally, FA / FC / FB drive it. */
  start(): void {
    if (this.external) return;
    if (this.state !== 'stopped') this.stop();
    this.engine.reset();
    this.engine.captureStart();
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
    if (this.external || this.state !== 'playing') return;
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
    if (this.external || this.state !== 'paused') return;
    this.anchorTick = this.pauseTick;
    this.anchorMs = this.now() + this.opts.startLatencyMs;
    if (this.clockOut) this.out.send([CONTINUE], this.anchorMs);
    this.state = 'playing';
    this.emit({ type: 'transport', state: this.state });
    this.ticker.start(() => this.pump(), this.opts.intervalMs);
    this.pump();
  }

  stop(): void {
    // Externally the ticker is the clock-loss watchdog and keeps running.
    if (!this.external) this.ticker.stop();
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
    this.ext.lost = false;
    this.engine.reset();
    this.emit({ type: 'transport', state: this.state });
    this.syncChanged();
  }

  setTempo(bpm: number): void {
    const b = Math.min(400, Math.max(10, bpm));
    // Externally the tempo setting is only stored; the clock decides timing.
    if (this.state === 'playing' && !this.external) {
      const h = this.engine.horizon;
      this.anchorMs = this.tickToMs(h);
      this.anchorTick = h;
    }
    this.bpm = b;
    this.engine.project.tempo = b;
    this.emit({ type: 'tempo', bpm: b });
  }

  /**
   * Called by the ticker. INTERNAL: schedules everything up to now +
   * lookahead. EXTERNAL: checks for clock loss (pulses do the scheduling).
   */
  pump(): void {
    if (this.external) {
      this.watchdog();
      return;
    }
    if (this.state !== 'playing') return;
    const horizonTick = this.msToTick(this.now() + this.opts.lookaheadMs);
    if (horizonTick <= this.engine.horizon) return;
    this.advance(horizonTick);
  }

  /** Assemble and dispatch everything before `horizonTick` (both clock sources). */
  private advance(horizonTick: number): void {
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
   * Overlap handling per line. MONO: a line holds at most one note; a new
   * note cuts the previous one at its onset. LEGATO: the previous note is cut
   * just after the new onset, so mono synths can glide. WRITTEN (Fingers):
   * every note keeps its computed length, so S/L of 16 and above overlap.
   * In every mode a repeated pitch is released before it is struck again.
   * Silent events (rests) leave sounding notes to finish naturally.
   */
  private handleNote(ev: NoteEvent): void {
    const ms = this.tickToMs(ev.tick);
    if (ev.overlap === 'written') {
      if (!ev.silent) {
        for (const p of this.pending.filter((x) => x.line === ev.line && x.channel === ev.channel && x.pitch === ev.pitch)) {
          this.removePending(p);
          this.out.noteOff(p.channel, p.pitch, p.id, ms);
        }
      }
      this.sound(ev, ms);
      return;
    }
    const held = this.lineHeld[ev.line];
    let legatoRelease: PendingOff | null = null;
    if (held && !ev.silent) {
      this.removePending(held);
      this.lineHeld[ev.line] = null;
      const same = held.channel === ev.channel && held.pitch === ev.pitch;
      if (ev.legato && !same) legatoRelease = held;
      else this.out.noteOff(held.channel, held.pitch, held.id, ms);
    }
    this.sound(ev, ms);
    if (legatoRelease) this.out.noteOff(legatoRelease.channel, legatoRelease.pitch, legatoRelease.id, ms);
  }

  /** Send the note-on, queue its note-off and report it. */
  private sound(ev: NoteEvent, ms: number): void {
    const offTick = ev.tick + ev.duration;
    if (!ev.silent) {
      const id = this.out.noteOn(ev.channel, ev.pitch, ev.velocity, ms);
      const p: PendingOff = { tick: offTick, id, channel: ev.channel, pitch: ev.pitch, line: ev.line };
      this.insertPending(p);
      this.lineHeld[ev.line] = p;
    }
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

  /** Release a line's sounding notes now (used when muting, pausing a line or changing its channel). */
  releaseLine(line: number): void {
    const mine = this.pending.filter((p) => p.line === line);
    this.lineHeld[line] = null;
    const t = Math.max(this.now(), this.state === 'playing' ? this.tickToMs(this.engine.horizon) : 0);
    for (const p of mine) {
      this.removePending(p);
      this.out.noteOff(p.channel, p.pitch, p.id, t);
    }
  }

  dispose(): void {
    this.ticker.stop();
  }

  // -----------------------------------------------------------------------
  // External clock

  /**
   * Select the clock source. Changing source always stops (releasing every
   * note and returning to the starting state): the two sources disagree
   * about where "now" is, so carrying a performance across would be a guess.
   */
  setSource(source: ClockSource): void {
    if (source === this.source) return;
    this.stop();
    this.ticker.stop();
    this.source = source;
    this.pulses.reset();
    Object.assign(this.ext, { nextTick: 0, anchorTick: 0, anchorMs: this.now(), lastPulseMs: -Infinity, pulseCount: 0, advanced: 0, lost: false, lastTransport: null });
    if (this.external) this.ticker.start(() => this.pump(), this.opts.intervalMs);
    this.syncChanged();
  }

  /** Tell the scheduler whether a MIDI input is attached (for status only). */
  setInputReady(ready: boolean): void {
    this.ext.inputReady = ready;
    this.syncChanged();
  }

  /**
   * Feed incoming MIDI bytes (from the selected input). Only the realtime
   * transport and clock bytes are acted on: F8 Clock, FA Start, FB Continue,
   * FC Stop. `t` is the message's receive time in ms (performance.now()).
   */
  receive(bytes: ArrayLike<number>, t: number): void {
    if (!this.external) return;
    const now = this.now();
    // Trust the device timestamp only if it is plausible.
    const ts = Number.isFinite(t) && t > 0 && t <= now + 5 && t >= now - 1000 ? t : now;
    for (let i = 0; i < bytes.length; i++) {
      switch (bytes[i]) {
        case CLOCK:
          this.pulse(ts);
          break;
        case START:
          this.extStart(ts);
          break;
        case CONTINUE:
          this.extContinue(ts);
          break;
        case STOP:
          this.extStop(ts);
          break;
      }
    }
  }

  /** One F8 pulse: the authoritative advance of musical time by one tick. */
  private pulse(t: number): void {
    this.pulses.add(t);
    this.ext.pulseCount++;
    this.ext.lastPulseMs = t;
    if (this.state !== 'playing') {
      // Clock while stopped never starts Feelers; it only feeds the tempo display.
      this.syncChanged();
      return;
    }
    const tick = this.ext.nextTick;
    this.ext.anchorTick = tick;
    this.ext.anchorMs = t;
    this.ext.nextTick = tick + 1;
    this.ext.advanced++;
    if (this.ext.lost) this.ext.lost = false;
    // Everything in [tick, tick + 1): integer-tick events land on this pulse,
    // fractional ones between it and the expected next pulse.
    this.advance(tick + 1);
    this.syncChanged();
  }

  /** FA: a fresh performance from the defined starting state; the next pulse is tick 0. */
  private extStart(t: number): void {
    this.ext.lastTransport = 'Start';
    this.emit({ type: 'realtime', message: 'Start', t });
    if (this.state !== 'stopped') this.out.releaseAll(true);
    this.engine.reset();
    this.engine.captureStart();
    this.pending = [];
    this.lineHeld = [null, null, null, null];
    this.pauseTick = 0;
    Object.assign(this.ext, { nextTick: 0, anchorTick: 0, anchorMs: t, lost: false });
    if (this.engine.project.options.programOnStart) {
      for (const l of this.engine.project.lines) {
        if (l.program !== null) this.out.send(programChange(l.channel, l.program), t);
      }
    }
    this.state = 'playing';
    this.emit({ type: 'transport', state: this.state });
    this.syncChanged();
  }

  /** FB: carry on from where FC stopped; nothing is reset. The next pulse is the next tick. */
  private extContinue(t: number): void {
    this.ext.lastTransport = 'Continue';
    this.emit({ type: 'realtime', message: 'Continue', t });
    if (this.state === 'playing') return;
    const from = this.state === 'paused' ? this.pauseTick : this.engine.horizon;
    Object.assign(this.ext, { nextTick: from, anchorTick: from, anchorMs: t, lost: false });
    this.state = 'playing';
    this.emit({ type: 'transport', state: this.state });
    this.syncChanged();
  }

  /**
   * FC: stop, keeping the position, heads, loop counters and each line's
   * remaining wait for a later Continue. Sounding notes end when the next
   * pulse was due (after any note already released for this pulse).
   */
  private extStop(t: number): void {
    this.ext.lastTransport = 'Stop';
    this.emit({ type: 'realtime', message: 'Stop', t });
    if (this.state !== 'playing') return;
    this.pauseTick = this.engine.horizon;
    this.releasePending(Math.max(this.now(), this.tickToMs(this.pauseTick)));
    this.ext.lost = false;
    this.state = 'paused';
    this.emit({ type: 'transport', state: this.state });
    this.syncChanged();
  }

  /** Release every held note at `ms`, forgetting pending note-offs. */
  private releasePending(ms: number): void {
    for (const p of this.pending) this.out.noteOff(p.channel, p.pitch, p.id, ms);
    this.pending = [];
    this.lineHeld = [null, null, null, null];
  }

  /**
   * The clock stopped arriving while running (timeout, input unplugged or
   * changed). Release notes and hold position; the transport stays "running"
   * because no Stop was received, so the next pulse simply carries on.
   */
  clockInterrupted(): void {
    if (!this.external) return;
    this.pulses.reset();
    if (this.state === 'playing' && !this.ext.lost) {
      this.ext.lost = true;
      // After anything already dispatched for the current pulse.
      this.releasePending(Math.max(this.now(), this.tickToMs(this.engine.horizon)));
    }
    this.syncChanged();
  }

  private watchdog(): void {
    const now = this.now();
    if (this.state === 'playing' && !this.ext.lost && now - Math.max(this.ext.lastPulseMs, this.ext.anchorMs) > CLOCK_LOSS_MS) {
      this.clockInterrupted();
      return;
    }
    this.syncChanged();
  }

  syncStatus(): SyncStatus {
    if (!this.external) return 'internal';
    if (!this.ext.inputReady) return this.state === 'playing' ? 'lost' : 'no-input';
    if (this.state === 'playing') return this.ext.lost ? 'lost' : 'running';
    if (this.state === 'paused') return 'stopped';
    return this.now() - this.ext.lastPulseMs < CLOCK_LOSS_MS ? 'clock' : 'waiting';
  }

  private syncChanged(): void {
    const s = this.syncStatus();
    if (s === this.lastStatus) return;
    this.lastStatus = s;
    this.emit({ type: 'sync', status: s });
  }
}
