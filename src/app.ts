/**
 * Application controller: owns the engine, scheduler, MIDI, preview and
 * persistence, and exposes the actions the interface calls. UI modules
 * subscribe to topics and re-render the parts that changed.
 */
import { AudioPreview } from './audio/preview';
import { demo } from './demos/demos';
import { Engine, cloneProject, recallSnapshot, takeSnapshot, type NoteEvent } from './engine/engine';
import { fullBank, makeLine, makeProject } from './engine/factory';
import { effectiveScale } from './engine/scale';
import { peekHead, seriesPositions, type Score } from './engine/series';
import type { AutoRand, Column, ColumnRandom, Direction, El, GlobalScale, Kind, LineScale, Overlap, Pos, Project, RandomSettings, RestMark, ScaleSpec } from './engine/types';
import { KINDS, KIND_RANGE, MAX_ELS, MAX_LOOP } from './engine/types';
import { describe } from './midi/messages';
import { MidiOutput } from './midi/output';
import { MidiAccess, type PortInfo } from './midi/webmidi';
import { load, serialize } from './persistence/project';
import { loadCurrent, saveCurrent, saveToLibrary } from './persistence/storage';
import { TakeRecorder } from './persistence/takes';
import { Scheduler, WorkerTicker, type ClockSource, type TransportState } from './scheduler/scheduler';

export type Topic = 'project' | 'bank' | 'lines' | 'transport' | 'midi' | 'selection' | 'takes' | 'snapshots' | 'status' | 'heads' | 'scale';

export interface Selection {
  col: string;
  index: number;
}

export interface MonitorEntry {
  t: number;
  text: string;
}

/** Which scale the Pitch columns preview: the global scale, or one line's. */
export type ScaleLens = 'global' | 0 | 1 | 2 | 3;

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
  display: Record<Kind, Pos | null>[] = [];
  /** The scale the Pitch columns preview. */
  lens: ScaleLens = 'global';
  lastNotes: (NoteEvent | null)[] = [null, null, null, null];
  /** Live shifts applied to each line since Start, in ticks (for display). */
  shifts = [0, 0, 0, 0];
  /** Notes waiting to be shown at their sounding time. */
  private visualQueue: { ms: number; ev: NoteEvent; offMs: number }[] = [];
  noteListeners = new Set<(ev: NoteEvent, offMs: number) => void>();
  monitor: MonitorEntry[] = [];
  clockCount = 0;
  /** MIDI inputs available as an external clock source. */
  inputs: PortInfo[] = [];
  selectedInput: string | null = null;
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
        this.inputs = this.access.inputs();
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
      onInputLost: () => {
        this.sched.setInputReady(false);
        this.sched.clockInterrupted();
        this.midiMessage = 'Clock input disconnected. Notes released; position held. Reconnect it, or choose another input.';
        this.emit('midi');
      },
      onInputReturned: () => {
        this.sched.setInputReady(true);
        this.midiMessage = 'Clock input reconnected. Feelers carries on with the next clock pulse.';
        this.emit('midi');
      },
    });
    this.sched.on((e) => {
      if (e.type === 'transport') {
        if (e.state === 'stopped') {
          this.shifts = [0, 0, 0, 0];
          this.visualQueue = [];
          this.resetDisplay();
        }
        this.emit('transport');
      } else if (e.type === 'note') {
        this.visualQueue.push({ ms: e.ms, ev: e.note, offMs: e.offMs });
      } else if (e.type === 'tempo' || e.type === 'sync') {
        this.emit('transport');
      } else if (e.type === 'realtime') {
        this.monitor.push({ t: e.t, text: `IN  ${e.message}` });
      }
    });
    if (safeGet('feelers.clockSource') === 'external') this.sched.setSource('external');
    this.engine.on((c) => {
      if (c.type === 'cell') this.emitSoon('bank');
      else if (c.type === 'line') this.emitSoon('lines');
      else if (c.type === 'restore') this.emitSoon('project');
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

  scheduleSave(): void {
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
        for (const k of KINDS) {
          const r = v.ev.reads[k];
          if (!r.held) d[k] = r.pos;
        }
        for (const fn of this.noteListeners) fn(v.ev, v.offMs);
      } else keep.push(v);
    }
    this.visualQueue = keep;
    if (due.length) this.emit('heads');
    return due;
  }

  /** Show heads at their start cells (or current runtime positions). */
  resetDisplay(): void {
    this.display = this.engine.lines.map(() => {
      const d = {} as Record<Kind, Pos | null>;
      for (const k of KINDS) d[k] = null;
      return d;
    });
    this.lastNotes = [null, null, null, null];
    this.emit('heads');
  }

  /** Where to draw a head: the element last sounded, else the one it will read next. */
  headView(line: number, kind: Kind): { col: string; index: number; live: boolean } {
    const d = this.display[line]?.[kind];
    if (d && this.transport !== 'stopped' && this.engine.column(d.col)) return { col: d.col, index: d.i, live: true };
    const h = this.engine.lines[line]!.heads[kind];
    const next = peekHead(h, { score: this.engine.score, choices: this.engine.choices }).pos ?? h.pos;
    return { col: next.col, index: next.i, live: false };
  }

  /** Position of an element within its series, for display ("3/8"). */
  seriesPlace(p: Pos, sc: Score = this.engine.score): { at: number; of: number } {
    const all = seriesPositions(sc, p).filter((q) => sc.el(q)?.loop === undefined);
    const at = all.findIndex((q) => q.col === p.col && q.i === p.i);
    return { at: at + 1, of: all.length };
  }

  /** The scale a line plays in (or null). */
  lineScale(line: number): ScaleSpec | null {
    return effectiveScale(this.project.scale, this.engine.cfg(line));
  }

  /** The scale the Pitch columns preview, with the transposition it applies after (lens on a line). */
  lensScale(): { spec: ScaleSpec | null; transpose: number } {
    if (this.lens === 'global') {
      const g = this.project.scale;
      return { spec: g.on ? { root: g.root, scale: g.scale, dir: g.dir } : null, transpose: 0 };
    }
    return { spec: this.lineScale(this.lens), transpose: this.engine.cfg(this.lens).transpose };
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

  get external(): boolean {
    return this.sched.external;
  }
  private followsClock(): boolean {
    if (!this.external) return false;
    this.setStatus('Following an external clock: Start, Stop and Continue come from the clock source. STOP here still stops and resets.');
    return true;
  }
  start(): void {
    if (this.followsClock()) return;
    this.sched.setTempo(this.project.tempo);
    this.sched.start();
    this.emit('snapshots');
  }

  /**
   * Restore Last Start: every series value and line setting returns to how
   * it was when Start was last pressed (undoing edits and auto-randomisation).
   * Pressing again undoes the restore.
   */
  restoreLastStart(): void {
    const r = this.engine.toggleRestore();
    if (!r) {
      this.setStatus('Nothing to restore yet: RESTORE returns to the state at the last Start.');
      return;
    }
    this.sched.setTempo(this.project.tempo);
    for (let l = 0; l < 4; l++) if (this.engine.cfg(l).mute) this.sched.releaseLine(l);
    this.selection = null;
    this.emit('project');
    this.emit('snapshots');
    this.setStatus(r === 'restored' ? 'Restored every value and line setting to the last Start. Press RESTORE again to undo.' : 'Undid the restore: back to the values before it.');
  }
  pause(): void {
    if (this.followsClock()) return;
    this.sched.pause();
  }
  resume(): void {
    if (this.followsClock()) return;
    this.sched.resume();
  }
  stop(): void {
    this.sched.stop();
  }
  /** Space bar behaviour: Start when stopped, otherwise Pause / Continue. */
  togglePlay(): void {
    if (this.followsClock()) return;
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
    this.scheduleSave();
  }

  // -------------------------------------------------------------------
  // MIDI devices

  async requestMidi(): Promise<void> {
    const pending = this.access.request();
    this.midiMessage = this.access.status.message;
    this.emit('midi');
    const st = await pending;
    this.midiMessage = st.message;
    this.ports = this.access.ports();
    this.inputs = this.access.inputs();
    if (st.state === 'ready' && !this.selectedPort && this.ports.length) {
      const remembered = safeGet('feelers.port');
      const pick = this.ports.find((p) => p.id === remembered);
      if (pick) this.selectPort(pick.id);
    }
    if (st.state === 'ready' && !this.selectedInput) {
      const remembered = safeGet('feelers.clockInput');
      if (this.inputs.some((p) => p.id === remembered)) this.selectInput(remembered);
    }
    this.emit('midi');
  }

  // -------------------------------------------------------------------
  // Clock source

  /** INTERNAL: Feelers owns tempo and transport. EXTERNAL: follow incoming MIDI Clock. */
  setClockSource(source: ClockSource): void {
    if (source === this.sched.source) return;
    this.sched.setSource(source);
    this.sched.setInputReady(this.selectedInput !== null && this.access.inputs().some((p) => p.id === this.selectedInput && p.connected));
    safeSet('feelers.clockSource', source);
    this.setStatus(
      source === 'external'
        ? 'Following external MIDI Clock. Choose the input that sends clock; the device starts, stops and continues Feelers.'
        : 'Internal clock: Feelers sets the tempo and runs its own transport.',
    );
    this.emit('midi');
    this.emit('transport');
  }

  /** Choose the MIDI input that supplies clock. Changing it mid-performance releases notes. */
  selectInput(id: string | null): void {
    if (id !== this.selectedInput) this.sched.clockInterrupted();
    this.selectedInput = id;
    const ok = this.access.openInput(id, (data, t) => this.sched.receive(data, t));
    this.sched.setInputReady(ok);
    if (id) safeSet('feelers.clockInput', id);
    const name = this.inputs.find((p) => p.id === id)?.name ?? id;
    this.midiMessage = ok ? `Listening for clock on ${name}` : id ? 'That input is not available.' : 'No clock input selected.';
    this.emit('midi');
    this.emit('transport');
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
      columns: fullBank([]),
      lines: [0, 1, 2, 3].map((i) => makeLine(i, {}, { mute: i > 0 })),
    });
    this.loadProject(p);
  }

  exportJson(): string {
    return serialize(this.project);
  }

  importJson(text: string): void {
    const r = load(text);
    this.loadProject(r.project);
    if (r.from < 2) this.setStatus(`Converted "${r.project.name}" from an older Feelers format: ${r.migration.length} note(s) added to the project notes.`);
  }

  saveToBrowser(): void {
    this.setStatus(saveToLibrary(cloneProject(this.project)) ? `Saved "${this.project.name}" in this browser.` : 'Could not save: browser storage unavailable.');
  }

  rename(name: string): void {
    this.project.name = name.trim() || 'Untitled';
    this.emit('transport');
    this.scheduleSave();
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
    if (this.transport === 'playing' && !this.engine.lines[line]!.paused) {
      this.setStatus(`Pause line ${line + 1} first: STEP plays one note at a time from a paused line.`);
      return;
    }
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
      this.engine.resetLine(line, 0);
      this.engine.lines[line]!.nextTick = cfg.delay;
      this.emit('lines');
    } else {
      this.engine.nudge(line, delta, this.sched.at());
      this.shifts[line]! += delta;
      this.emit('lines');
    }
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

  assign(line: number, kind: Kind, col: string): void {
    this.engine.setHeadColumn(line, kind, col);
    this.engine.cfg(line).heads[kind].start = 0;
    this.emit('lines');
    this.emit('heads');
  }

  /** Move a head to an element; while stopped this sets its starting element. */
  placeHead(line: number, kind: Kind, col: string, index: number): void {
    const cfg = this.engine.cfg(line);
    if (cfg.heads[kind].col !== col) this.engine.setHeadColumn(line, kind, col, index);
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

  setOverlap(line: number, mode: Overlap): void {
    const cfg = this.engine.cfg(line);
    if (cfg.overlap === mode) return;
    cfg.overlap = mode;
    this.emit('lines');
  }

  // -------------------------------------------------------------------
  // Scale Mode (modern facility; never rewrites the stored series)

  setGlobalScale(patch: Partial<GlobalScale>): void {
    Object.assign(this.project.scale, patch);
    this.scaleChanged();
  }

  setLineScale(line: number, patch: Partial<LineScale>): void {
    Object.assign(this.engine.cfg(line).scale, patch);
    this.scaleChanged();
  }

  setLens(lens: ScaleLens): void {
    this.lens = lens;
    this.emit('scale');
  }

  private scaleChanged(): void {
    this.emit('scale');
    this.emit('lines');
    this.scheduleSave();
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
      this.emit('heads');
    }
    this.emit('snapshots');
  }

  // -------------------------------------------------------------------
  // Score editing

  select(sel: Selection | null): void {
    this.selection = sel;
    this.emit('selection');
  }

  column(id: string): Column | undefined {
    return this.engine.column(id);
  }

  elAt(sel: Selection | null = this.selection): El | undefined {
    if (!sel) return undefined;
    return this.column(sel.col)?.els[sel.index];
  }

  private edited(): void {
    this.emit('bank');
  }

  setValue(col: string, index: number, v: number): void {
    const c = this.column(col);
    const e = c?.els[index];
    if (!c || !e || e.loop !== undefined) return;
    const r = KIND_RANGE[c.kind];
    this.engine.setValue({ col, i: index }, Math.min(r.max, Math.max(r.min, Math.round(v))), this.project.options.shiftEdit);
    this.edited();
  }

  /** Turn the selected slot into a value (keeping its marks), a blank, or a Loop. */
  setSlot(kind: 'value' | 'blank' | 'loop', count = 0): void {
    const e = this.elAt();
    const c = this.selection && this.column(this.selection.col);
    if (!e || !c) return;
    if (kind === 'loop') {
      if (e.loop === undefined) e.loop = count;
      e.v = null;
      delete e.rest;
      delete e.ar;
    } else {
      delete e.loop;
      e.v = kind === 'blank' ? null : (e.v ?? this.neighbourValue(c, this.selection!.index));
    }
    this.edited();
  }

  private neighbourValue(c: Column, i: number): number {
    for (let d = 1; d < c.els.length; d++) {
      for (const j of [i - d, i + d]) {
        const v = c.els[j]?.v;
        if (v !== null && v !== undefined) return v;
      }
    }
    return defaultValue(c.kind);
  }

  toggleSkip(): void {
    const e = this.elAt();
    if (!e) return;
    if (e.skip) delete e.skip;
    else e.skip = true;
    this.edited();
  }

  toggleEnd(): void {
    const e = this.elAt();
    if (!e) return;
    if (e.end) delete e.end;
    else e.end = true;
    this.edited();
  }

  /** Set a rest mark, or cycle none -> Rest -> rest -> none (as the Fingers Rest option does). */
  setRest(mark?: RestMark | null): void {
    const e = this.elAt();
    if (!e || e.loop !== undefined) return;
    const next: RestMark | null = mark !== undefined ? mark : e.rest === undefined ? 'R' : e.rest === 'R' ? 'r' : null;
    if (next) e.rest = next;
    else delete e.rest;
    this.edited();
  }

  setAutoRand(ar: AutoRand | 0): void {
    const e = this.elAt();
    if (!e || e.loop !== undefined) return;
    if (ar) e.ar = ar;
    else delete e.ar;
    this.edited();
  }

  setLoopCount(n: number): void {
    const e = this.elAt();
    if (!e || e.loop === undefined) return;
    e.loop = Math.min(MAX_LOOP, Math.max(0, Math.round(n)));
    this.edited();
  }

  toggleLink(col: string): void {
    const c = this.column(col);
    if (!c) return;
    c.link = !c.link;
    this.edited();
  }

  insertEl(after: boolean): void {
    const sel = this.selection;
    const c = sel && this.column(sel.col);
    if (!sel || !c) return;
    if (c.els.length >= MAX_ELS) {
      this.setStatus(`A column holds ${MAX_ELS} elements. Delete one first, or continue in another column with Column Link.`);
      return;
    }
    const src = c.els[sel.index];
    const at = after ? sel.index + 1 : sel.index;
    c.els.splice(at, 0, { v: src?.v ?? this.neighbourValue(c, sel.index) });
    this.shiftHeads(c.id, at, 1);
    this.selection = { col: c.id, index: at };
    this.edited();
    this.emit('selection');
  }

  appendEl(colId: string): void {
    const c = this.column(colId);
    if (!c || c.els.length >= MAX_ELS) return;
    c.els.push({ v: this.neighbourValue(c, c.els.length) });
    this.selection = { col: c.id, index: c.els.length - 1 };
    this.edited();
    this.emit('selection');
  }

  deleteEl(): void {
    const sel = this.selection;
    const c = sel && this.column(sel.col);
    if (!sel || !c || c.els.length <= 1) return;
    c.els.splice(sel.index, 1);
    this.shiftHeads(c.id, sel.index + 1, -1);
    this.selection = { col: c.id, index: Math.min(sel.index, c.els.length - 1) };
    this.edited();
    this.emit('selection');
  }

  /** Keep heads pointing at the same elements after an insert / delete. */
  private shiftHeads(col: string, from: number, d: number): void {
    const move = (p: Pos | null) => {
      if (p && p.col === col && p.i >= from) p.i = Math.max(0, p.i + d);
    };
    for (let l = 0; l < this.engine.lines.length; l++) {
      const rt = this.engine.lines[l]!;
      for (const k of KINDS) {
        const h = rt.heads[k];
        move(h.pos);
        move(h.last);
        move(this.display[l]![k]);
        const cfg = this.engine.cfg(l).heads[k];
        if (cfg.col === col && cfg.start >= from) cfg.start = Math.max(0, cfg.start + d);
        h.loops = {};
      }
      move(rt.pending?.pos ?? null);
    }
  }

  /**
   * Rotate the values of a column by one step (Feelers tool). Values move
   * with their Skip, rest and randomise marks; Loop elements and End flags
   * stay where they are, so the structure is kept.
   */
  rotate(colId: string, d: 1 | -1): void {
    const c = this.column(colId);
    if (!c) return;
    const slots = c.els.map((e, i) => (e.loop === undefined ? i : -1)).filter((i) => i >= 0);
    if (slots.length < 2) return;
    const items = slots.map((i) => strip(c.els[i]!));
    if (d === 1) items.unshift(items.pop()!);
    else items.push(items.shift()!);
    slots.forEach((i, k) => (c.els[i] = { ...items[k]!, ...(c.els[i]!.end ? { end: true as const } : {}) }));
    this.edited();
  }

  /** Reverse the order of the values of a column (Loop elements and End flags stay put). */
  retrograde(colId: string): void {
    const c = this.column(colId);
    if (!c) return;
    const slots = c.els.map((e, i) => (e.loop === undefined ? i : -1)).filter((i) => i >= 0);
    const items = slots.map((i) => strip(c.els[i]!)).reverse();
    slots.forEach((i, k) => (c.els[i] = { ...items[k]!, ...(c.els[i]!.end ? { end: true as const } : {}) }));
    this.edited();
  }

  /** Add to every value (pitch transposition of material, not of the line). */
  offsetColumn(colId: string, d: number): void {
    const c = this.column(colId);
    if (!c) return;
    const r = KIND_RANGE[c.kind];
    for (const e of c.els) if (e.v !== null) e.v = Math.min(r.max, Math.max(r.min, e.v + d));
    this.edited();
  }

  setKindRandom(kind: Kind, patch: Partial<RandomSettings>): void {
    Object.assign(this.project.random[kind], patch);
    this.edited();
  }

  /** Give a column its own randomisation (Feelers extension), or null to follow its kind. */
  setColumnRandom(colId: string, patch: Partial<ColumnRandom> | null): void {
    const c = this.column(colId);
    if (!c) return;
    if (patch === null) delete c.rand;
    else {
      c.rand = { ...(c.rand ?? { ...this.project.random[c.kind] }), ...patch };
      if (c.rand.lo !== undefined && c.rand.hi !== undefined && c.rand.lo > c.rand.hi) [c.rand.lo, c.rand.hi] = [c.rand.hi, c.rand.lo];
    }
    this.edited();
  }

  setLimits(patch: Partial<{ minTime: number; pitchLimit: number }>): void {
    if (patch.minTime !== undefined) this.project.minTime = Math.min(999, Math.max(1, Math.round(patch.minTime)));
    if (patch.pitchLimit !== undefined) this.project.pitchLimit = Math.min(127, Math.max(0, Math.round(patch.pitchLimit)));
    this.edited();
  }

  dirOf(line: number, kind: Kind): Direction {
    return this.engine.lines[line]!.heads[kind].dir;
  }
}

/** An element without its End flag (which belongs to the slot, not the value). */
function strip(e: El): El {
  const { end: _end, ...rest } = e;
  return rest;
}

export function defaultValue(kind: Kind): number {
  return { time: 12, pitch: 60, velocity: 90, artic: 13 }[kind];
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
