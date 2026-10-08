/**
 * Application controller: owns the engine, scheduler, MIDI, preview and
 * persistence, and exposes the actions the interface calls. UI modules
 * subscribe to topics and re-render the parts that changed.
 */
import { AudioPreview } from './audio/preview';
import { demo } from './demos/demos';
import { Engine, cloneProject, recallSnapshot, takeSnapshot, type NoteEvent } from './engine/engine';
import { fullBank, makeLine, makeProject } from './engine/factory';
import { activeLength, matchBracket } from './engine/series';
import type { Cell, Direction, Kind, Project } from './engine/types';
import { KINDS, KIND_RANGE, MAX_CELLS } from './engine/types';
import { describe } from './midi/messages';
import { MidiOutput } from './midi/output';
import { MidiAccess, type PortInfo } from './midi/webmidi';
import { deserialize, serialize } from './persistence/project';
import { loadCurrent, saveCurrent, saveToLibrary } from './persistence/storage';
import { TakeRecorder } from './persistence/takes';
import { Scheduler, WorkerTicker, type TransportState } from './scheduler/scheduler';

export type Topic = 'project' | 'bank' | 'lines' | 'transport' | 'midi' | 'selection' | 'takes' | 'snapshots' | 'status' | 'heads';

export interface Selection {
  series: string;
  index: number;
}

export interface MonitorEntry {
  t: number;
  text: string;
}

export interface DisplayHead {
  series: string;
  index: number | null;
}

export class App {
  engine: Engine;
  out: MidiOutput;
  sched: Scheduler;
  access: MidiAccess;
  preview = new AudioPreview();
  recorder: TakeRecorder;
  ports: PortInfo[] = [];
  selectedPort: string | null = null;
  midiMessage = '';
  status = '';
  selection: Selection | null = null;
  storeMode = false;
  /** Visual state: what each head last sounded (updated at sounding time). */
  display: Record<Kind, DisplayHead | null>[] = [];
  lastNotes: (NoteEvent | null)[] = [null, null, null, null];
  /** Notes waiting to be shown at their sounding time. */
  private visualQueue: { ms: number; ev: NoteEvent; offMs: number }[] = [];
  noteListeners = new Set<(ev: NoteEvent, offMs: number) => void>();
  monitor: MonitorEntry[] = [];
  clockCount = 0;
  private listeners = new Map<Topic, Set<() => void>>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const now = () => performance.now();
    const initial = loadCurrent() ?? demo('first-contact');
    this.engine = new Engine(initial);
    this.out = new MidiOutput(now);
    this.sched = new Scheduler(this.engine, this.out, now, new WorkerTicker());
    this.recorder = new TakeRecorder(this.sched);
    this.recorder.onChange(() => this.emit('takes'));
    this.out.tap(this.preview.handle);
    this.out.onClear(() => this.preview.silence());
    this.out.tap((bytes, t) => this.logMidi(bytes, t));
    this.access = new MidiAccess({
      onPortsChanged: (p) => {
        this.ports = p;
        this.emit('midi');
      },
      onSelectedLost: () => {
        this.out.deviceLost();
        this.midiMessage = 'MIDI device disconnected. Playback continues silently; reconnect it or choose another output.';
        this.emit('midi');
      },
      onSelectedReturned: (id) => {
        this.out.setSink(this.access.open(id));
        this.midiMessage = 'MIDI device reconnected.';
        this.emit('midi');
      },
    });
    this.sched.on((e) => {
      if (e.type === 'transport') {
        if (e.state === 'stopped') {
          this.visualQueue = [];
          this.resetDisplay();
        }
        this.emit('transport');
      } else if (e.type === 'note') {
        this.visualQueue.push({ ms: e.ms, ev: e.note, offMs: e.offMs });
      } else if (e.type === 'tempo') {
        this.emit('transport');
      }
    });
    this.engine.on((c) => {
      if (c.type === 'cell') this.emitSoon('bank');
      else if (c.type === 'line') this.emitSoon('lines');
    });
    this.resetDisplay();
  }

  get project(): Project {
    return this.engine.project;
  }

  get transport(): TransportState {
    return this.sched.state;
  }

  // -------------------------------------------------------------------
  // Pub/sub

  on(topic: Topic, fn: () => void): () => void {
    let s = this.listeners.get(topic);
    if (!s) this.listeners.set(topic, (s = new Set()));
    s.add(fn);
    return () => s.delete(fn);
  }

  emit(topic: Topic): void {
    for (const fn of this.listeners.get(topic) ?? []) fn();
    if (topic !== 'status' && topic !== 'heads' && topic !== 'transport') this.scheduleSave();
  }

  private pendingTopics = new Set<Topic>();
  private emitSoon(topic: Topic): void {
    if (this.pendingTopics.size === 0) queueMicrotask(() => this.flushTopics());
    this.pendingTopics.add(topic);
  }
  private flushTopics(): void {
    const t = [...this.pendingTopics];
    this.pendingTopics.clear();
    for (const x of t) this.emit(x);
  }

  setStatus(s: string): void {
    this.status = s;
    this.emit('status');
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => saveCurrent(this.project), 800);
  }

  // -------------------------------------------------------------------
  // Visual timing: called every animation frame

  frame(nowMs: number): NoteEvent[] {
    const due: NoteEvent[] = [];
    if (this.visualQueue.length === 0) return due;
    const keep: typeof this.visualQueue = [];
    for (const v of this.visualQueue) {
      if (v.ms <= nowMs) {
        due.push(v.ev);
        this.lastNotes[v.ev.line] = v.ev;
        const d = this.display[v.ev.line]!;
        for (const k of KINDS) d[k] = { series: v.ev.reads[k].series, index: v.ev.reads[k].index };
        for (const fn of this.noteListeners) fn(v.ev, v.offMs);
      } else keep.push(v);
    }
    this.visualQueue = keep;
    if (due.length) this.emit('heads');
    return due;
  }

  /** Show heads at their start cells (or current runtime positions). */
  resetDisplay(): void {
    this.display = this.engine.lines.map((rt) => {
      const d = {} as Record<Kind, DisplayHead | null>;
      for (const k of KINDS) d[k] = null;
      void rt;
      return d;
    });
    this.lastNotes = [null, null, null, null];
    this.emit('heads');
  }

  /** Where to draw a head: last sounded cell, else the next cell it will read. */
  headView(line: number, kind: Kind): { series: string; index: number; live: boolean } {
    const d = this.display[line]?.[kind];
    const h = this.engine.lines[line]!.heads[kind];
    if (d && d.index !== null && d.series === h.series && this.transport !== 'stopped') return { series: d.series, index: d.index, live: true };
    const s = this.engine.series(h.series);
    const act = s ? activeLength(s) : 0;
    let idx = h.pos;
    if (idx >= act || idx < 0) idx = h.dir === 1 ? 0 : Math.max(0, act - 1);
    return { series: h.series, index: idx, live: false };
  }

  // -------------------------------------------------------------------
  // MIDI monitor

  private logMidi(bytes: number[], t: number): void {
    if (bytes[0] === 0xf8) {
      this.clockCount++;
      return;
    }
    this.monitor.push({ t, text: describe(bytes) });
    if (this.monitor.length > 300) this.monitor.splice(0, this.monitor.length - 300);
  }

  // -------------------------------------------------------------------
  // Transport

  start(): void {
    this.sched.setTempo(this.project.tempo);
    this.sched.start();
  }
  pause(): void {
    this.sched.pause();
  }
  resume(): void {
    this.sched.resume();
  }
  stop(): void {
    this.sched.stop();
  }
  /** Space bar behaviour: Start when stopped, otherwise Pause / Continue. */
  togglePlay(): void {
    if (this.transport === 'stopped') this.start();
    else if (this.transport === 'playing') this.pause();
    else this.resume();
  }
  panic(): void {
    this.out.panic();
    this.preview.silence();
    this.setStatus('Panic: all notes off sent on all 16 channels.');
  }
  setTempo(bpm: number): void {
    this.sched.setTempo(bpm);
    this.emit('project');
  }

  // -------------------------------------------------------------------
  // MIDI devices

  async requestMidi(): Promise<void> {
    const st = await this.access.request();
    this.midiMessage = st.message;
    this.ports = this.access.ports();
    if (st.state === 'ready' && !this.selectedPort && this.ports.length) {
      const remembered = safeGet('feelers.port');
      const pick = this.ports.find((p) => p.id === remembered);
      if (pick) this.selectPort(pick.id);
    }
    this.emit('midi');
  }

  selectPort(id: string | null): void {
    this.selectedPort = id;
    const sink = this.access.open(id);
    this.out.setSink(sink);
    if (id) safeSet('feelers.port', id);
    this.midiMessage = sink ? `Sending to ${sink.name}` : id ? 'That output is not available.' : 'No MIDI output: preview only.';
    this.emit('midi');
  }

  async togglePreview(): Promise<void> {
    if (this.preview.enabled) this.preview.disable();
    else if (!(await this.preview.enable())) this.setStatus('Audio preview is not available in this browser.');
    this.emit('midi');
  }

  // -------------------------------------------------------------------
  // Project

  loadProject(p: Project, label = p.name): void {
    this.sched.stop();
    this.engine.load(p);
    this.sched.setTempo(p.tempo);
    this.selection = null;
    this.resetDisplay();
    this.emit('project');
    this.setStatus(`Loaded "${label}".`);
  }

  loadDemo(id: string): void {
    this.loadProject(demo(id));
  }

  newProject(): void {
    const p = makeProject({
      name: 'New feelers',
      series: fullBank([]),
      lines: [0, 1, 2, 3].map((i) => makeLine(i, {}, { mute: i > 0 })),
    });
    this.loadProject(p);
  }

  exportJson(): string {
    return serialize(this.project);
  }

  importJson(text: string): void {
    this.loadProject(deserialize(text));
  }

  saveToBrowser(): void {
    this.setStatus(saveToLibrary(cloneProject(this.project)) ? `Saved "${this.project.name}" in this browser.` : 'Could not save: browser storage unavailable.');
  }

  rename(name: string): void {
    this.project.name = name.trim() || 'Untitled';
    this.emit('project');
  }

  setOption(k: keyof Project['options'], v: boolean): void {
    this.project.options[k] = v;
    this.emit('transport');
    this.scheduleSave();
  }

  setSeed(seed: number): void {
    this.project.seed = seed >>> 0;
    this.scheduleSave();
  }

  // -------------------------------------------------------------------
  // Lines

  lineChanged(): void {
    this.emit('lines');
  }

  toggleMute(line: number): void {
    const cfg = this.engine.cfg(line);
    cfg.mute = !cfg.mute;
    if (cfg.mute) this.sched.releaseLine(line);
    this.emit('lines');
  }

  togglePause(line: number): void {
    const rt = this.engine.lines[line]!;
    this.engine.setPaused(line, !rt.paused, this.sched.at());
    if (rt.paused) this.sched.releaseLine(line);
  }

  next(line: number): void {
    if (this.transport === 'playing') this.engine.nextNow(line, this.sched.at());
    else this.sched.stepLine(line);
  }

  step(line: number): void {
    this.sched.stepLine(line);
  }

  resetLine(line: number): void {
    this.engine.resetLine(line, this.sched.at());
    this.display[line] = { time: null, pitch: null, velocity: null, artic: null };
    this.emit('heads');
  }

  nudge(line: number, delta: number): void {
    if (this.transport === 'stopped') {
      const cfg = this.engine.cfg(line);
      cfg.delay = Math.max(0, cfg.delay + delta);
      this.engine.lines[line]!.nextTick = cfg.delay;
      this.emit('lines');
    } else this.engine.nudge(line, delta, this.sched.at());
  }

  /** Direction: while stopped this edits the starting direction. */
  toggleDir(line: number, kind: Kind): void {
    this.engine.toggleDirection(line, kind);
    if (this.transport === 'stopped') this.engine.cfg(line).heads[kind].startDir = this.engine.lines[line]!.heads[kind].dir;
    this.emit('lines');
  }

  reverseLine(line: number): void {
    for (const k of KINDS) this.toggleDir(line, k);
  }

  assign(line: number, kind: Kind, series: string): void {
    this.engine.setHeadSeries(line, kind, series);
    this.engine.cfg(line).heads[kind].start = 0;
    this.emit('lines');
    this.emit('heads');
  }

  /** Move a head to a cell; while stopped this sets its starting cell. */
  placeHead(line: number, kind: Kind, series: string, index: number): void {
    const cfg = this.engine.cfg(line);
    if (cfg.heads[kind].series !== series) this.engine.setHeadSeries(line, kind, series, index);
    else this.engine.setHeadPos(line, kind, index);
    if (this.transport === 'stopped') cfg.heads[kind].start = index;
    this.display[line]![kind] = null;
    this.emit('lines');
    this.emit('heads');
  }

  setChannel(line: number, ch: number): void {
    this.sched.releaseLine(line);
    this.engine.cfg(line).channel = ch;
    this.emit('lines');
  }

  setProgram(line: number, prog: number | null): void {
    this.engine.cfg(line).program = prog;
    if (prog !== null) this.sched.sendProgram(line);
    this.emit('lines');
  }

  // -------------------------------------------------------------------
  // Snapshots

  snapshotSlot(i: number): void {
    if (this.storeMode) {
      this.project.snapshots[i] = takeSnapshot(this.engine, this.sched.bpm);
      this.storeMode = false;
      this.setStatus(`Stored performance memory ${i + 1}.`);
    } else {
      const s = this.project.snapshots[i];
      if (!s) {
        this.setStatus(`Memory ${i + 1} is empty. Press STORE then a slot to keep the current performance state.`);
        return;
      }
      recallSnapshot(this.engine, s, this.sched.at());
      this.sched.setTempo(s.tempo);
      for (let l = 0; l < 4; l++) if (this.engine.cfg(l).mute) this.sched.releaseLine(l);
      this.setStatus(`Recalled performance memory ${i + 1}.`);
      this.emit('lines');
      this.emit('project');
    }
    this.emit('snapshots');
  }

  // -------------------------------------------------------------------
  // Series editing

  select(sel: Selection | null): void {
    this.selection = sel;
    this.emit('selection');
  }

  cellAt(sel: Selection | null = this.selection): Cell | undefined {
    if (!sel) return undefined;
    return this.engine.series(sel.series)?.cells[sel.index];
  }

  setValue(series: string, index: number, v: number): void {
    const s = this.engine.series(series);
    if (!s) return;
    const r = KIND_RANGE[s.kind];
    this.engine.setValue(series, index, Math.min(r.max, Math.max(r.min, Math.round(v))), this.project.options.shiftEdit);
    this.emit('bank');
  }

  /** Replace the selected cell with a different element type. */
  setCellType(type: Cell['t'], n = 2): void {
    const sel = this.selection;
    const s = sel && this.engine.series(sel.series);
    if (!sel || !s) return;
    const old = s.cells[sel.index];
    let cell: Cell;
    switch (type) {
      case 'v':
        cell = { t: 'v', v: old?.t === 'v' ? old.v : defaultValue(s.kind) };
        break;
      case 'close':
        cell = { t: 'close', n };
        break;
      default:
        cell = { t: type } as Cell;
    }
    s.cells[sel.index] = cell;
    this.emit('bank');
  }

  setRandFlag(r: 0 | 1 | 2): void {
    const c = this.cellAt();
    if (!c || c.t !== 'v') return;
    if (r) c.r = r;
    else delete c.r;
    this.emit('bank');
  }

  setLoopCount(n: number): void {
    const c = this.cellAt();
    if (!c || c.t !== 'close') return;
    c.n = Math.min(999, Math.max(1, Math.round(n)));
    this.emit('bank');
  }

  insertCell(after: boolean): void {
    const sel = this.selection;
    const s = sel && this.engine.series(sel.series);
    if (!sel || !s || s.cells.length >= MAX_CELLS) return;
    const src = s.cells[sel.index];
    const cell: Cell = src && src.t === 'v' ? { t: 'v', v: src.v } : { t: 'v', v: defaultValue(s.kind) };
    const at = after ? sel.index + 1 : sel.index;
    s.cells.splice(at, 0, cell);
    this.shiftHeads(s.id, at, 1);
    this.selection = { series: s.id, index: at };
    this.emit('bank');
    this.emit('selection');
  }

  appendCell(seriesId: string): void {
    const s = this.engine.series(seriesId);
    if (!s || s.cells.length >= MAX_CELLS) return;
    const lastV = [...s.cells].reverse().find((c) => c.t === 'v');
    s.cells.push({ t: 'v', v: lastV && lastV.t === 'v' ? lastV.v : defaultValue(s.kind) });
    this.selection = { series: s.id, index: s.cells.length - 1 };
    this.emit('bank');
    this.emit('selection');
  }

  deleteCell(): void {
    const sel = this.selection;
    const s = sel && this.engine.series(sel.series);
    if (!sel || !s || s.cells.length <= 1) return;
    s.cells.splice(sel.index, 1);
    this.shiftHeads(s.id, sel.index + 1, -1);
    this.selection = { series: s.id, index: Math.min(sel.index, s.cells.length - 1) };
    this.emit('bank');
    this.emit('selection');
  }

  /** Keep heads pointing at the same cells after an insert / delete. */
  private shiftHeads(series: string, from: number, d: number): void {
    for (let l = 0; l < this.engine.lines.length; l++) {
      for (const k of KINDS) {
        const h = this.engine.lines[l]!.heads[k];
        if (h.series !== series) continue;
        if (h.pos >= from) h.pos = Math.max(0, h.pos + d);
        if (h.lastIndex !== null && h.lastIndex >= from) h.lastIndex = Math.max(0, h.lastIndex + d);
        const disp = this.display[l]![k];
        if (disp && disp.series === series && disp.index !== null && disp.index >= from) disp.index = Math.max(0, disp.index + d);
        const cfg = this.engine.cfg(l).heads[k];
        if (cfg.series === series && cfg.start >= from) cfg.start = Math.max(0, cfg.start + d);
      }
    }
  }

  /** Rotate the active part of a series by one step. */
  rotate(seriesId: string, d: 1 | -1): void {
    const s = this.engine.series(seriesId);
    if (!s) return;
    const act = activeLength(s);
    const part = s.cells.slice(0, act);
    if (part.length < 2) return;
    if (d === 1) part.unshift(part.pop()!);
    else part.push(part.shift()!);
    s.cells.splice(0, act, ...part);
    this.emit('bank');
  }

  /** Add to every value (pitch transposition of material, not of the line). */
  offsetSeries(seriesId: string, d: number): void {
    const s = this.engine.series(seriesId);
    if (!s) return;
    const r = KIND_RANGE[s.kind];
    for (const c of s.cells) if (c.t === 'v') c.v = Math.min(r.max, Math.max(r.min, c.v + d));
    this.emit('bank');
  }

  /** Reverse the order of the active part (retrograde of the material). */
  retrograde(seriesId: string): void {
    const s = this.engine.series(seriesId);
    if (!s) return;
    const act = activeLength(s);
    // Brackets swap roles; each new close bracket takes its partner's count.
    const part = s.cells.slice(0, act).map((c, i): Cell => {
      if (c.t === 'close') return { t: 'open' };
      if (c.t === 'open') {
        const partner = s.cells[matchBracket(s.cells, i, act)];
        return { t: 'close', n: partner && partner.t === 'close' ? partner.n : 2 };
      }
      return c;
    });
    s.cells.splice(0, act, ...part.reverse());
    this.emit('bank');
  }

  setSeriesRand(seriesId: string, patch: Partial<{ amount: number; type: number; prob: number; lo: number; hi: number }>): void {
    const s = this.engine.series(seriesId);
    if (!s) return;
    if (patch.amount !== undefined) s.rand.amount = patch.amount;
    if (patch.type !== undefined) s.rand.type = patch.type;
    if (patch.prob !== undefined) s.rand.prob = patch.prob;
    if (patch.lo !== undefined) s.lo = Math.min(patch.lo, s.hi);
    if (patch.hi !== undefined) s.hi = Math.max(patch.hi, s.lo);
    this.emit('bank');
  }

  dirOf(line: number, kind: Kind): Direction {
    return this.engine.lines[line]!.heads[kind].dir;
  }
}

export function defaultValue(kind: Kind): number {
  return { time: 12, pitch: 60, velocity: 90, artic: 80 }[kind];
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
