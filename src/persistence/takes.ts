/**
 * Takes: every performance from Start to Stop is recorded as the notes the
 * engine produced (in ticks), and the last nine are kept. A take can be
 * exported as a Standard MIDI File (type 1, one track per line).
 *
 * Fingers reportedly kept the last nine performances; the recording and
 * export here are an independent design (see docs/PROVENANCE.md).
 */
import type { NoteEvent } from '../engine/engine';
import { PPQ } from '../engine/types';
import type { Scheduler } from '../scheduler/scheduler';

export interface TakeNote {
  line: number;
  tick: number;
  duration: number;
  channel: number;
  pitch: number;
  velocity: number;
}

export interface Take {
  name: string;
  startedAt: string;
  lineNames: string[];
  tempos: { tick: number; bpm: number }[];
  notes: TakeNote[];
  lengthTicks: number;
}

export const MAX_TAKES = 9;

export class TakeRecorder {
  takes: Take[] = [];
  current: Take | null = null;
  private listeners = new Set<() => void>();

  constructor(private sched: Scheduler) {
    sched.on((e) => {
      if (e.type === 'transport') {
        if (e.state === 'playing' && !this.current) this.begin();
        if (e.state === 'stopped') this.end();
      } else if (e.type === 'note' && this.current) {
        this.add(e.note);
      } else if (e.type === 'tempo' && this.current) {
        this.current.tempos.push({ tick: this.sched.at(), bpm: e.bpm });
      }
    });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  private begin(): void {
    const p = this.sched.engine.project;
    const d = new Date();
    this.current = {
      name: `${p.name} ${d.toTimeString().slice(0, 8)}`,
      startedAt: d.toISOString(),
      lineNames: p.lines.map((l) => l.name),
      tempos: [{ tick: 0, bpm: this.sched.bpm }],
      notes: [],
      lengthTicks: 0,
    };
  }

  private add(n: NoteEvent): void {
    const t = this.current!;
    if (!n.silent) {
      t.notes.push({ line: n.line, tick: n.tick, duration: n.duration, channel: n.channel, pitch: n.pitch, velocity: n.velocity });
    }
    t.lengthTicks = Math.max(t.lengthTicks, n.tick + n.duration);
  }

  private end(): void {
    const t = this.current;
    this.current = null;
    if (!t || t.notes.length === 0) return;
    this.takes.unshift(t);
    this.takes.length = Math.min(this.takes.length, MAX_TAKES);
    this.changed();
  }
}

// ---------------------------------------------------------------------------
// Standard MIDI File writer

const DIVISION = 96; // SMF ticks per quarter; engine ticks * 4

function vlq(n: number): number[] {
  let v = Math.max(0, Math.round(n));
  const bytes = [v & 0x7f];
  while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
}

function chunk(id: string, data: number[]): number[] {
  const len = data.length;
  return [...[...id].map((c) => c.charCodeAt(0)), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...data];
}

function text(type: number, s: string): number[] {
  const b = [...new TextEncoder().encode(s)];
  return [0xff, type, ...vlq(b.length), ...b];
}

function track(events: { t: number; bytes: number[] }[], name: string): number[] {
  events.sort((a, b) => a.t - b.t || (a.bytes[0]! & 0xf0) - (b.bytes[0]! & 0xf0));
  const out: number[] = [0, ...text(0x03, name)];
  let last = 0;
  for (const e of events) {
    out.push(...vlq(e.t - last), ...e.bytes);
    last = e.t;
  }
  out.push(0, 0xff, 0x2f, 0);
  return chunk('MTrk', out);
}

export function takeToMidi(take: Take): Uint8Array {
  const scale = DIVISION / PPQ;
  const conductor = take.tempos.map((tp) => {
    const us = Math.round(60_000_000 / tp.bpm);
    return { t: Math.round(tp.tick * scale), bytes: [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255] };
  });
  const tracks = [track(conductor, take.name)];
  for (let line = 0; line < take.lineNames.length; line++) {
    const evs: { t: number; bytes: number[] }[] = [];
    for (const n of take.notes.filter((x) => x.line === line)) {
      const ch = (n.channel - 1) & 0x0f;
      const on = Math.round(n.tick * scale);
      const off = Math.max(on + 1, Math.round((n.tick + n.duration) * scale));
      evs.push({ t: on, bytes: [0x90 | ch, n.pitch & 0x7f, n.velocity & 0x7f] });
      evs.push({ t: off, bytes: [0x80 | ch, n.pitch & 0x7f, 0] });
    }
    tracks.push(track(evs, take.lineNames[line] ?? `Line ${line + 1}`));
  }
  const header = chunk('MThd', [0, 1, 0, tracks.length, (DIVISION >> 8) & 255, DIVISION & 255]);
  return new Uint8Array([...header, ...tracks.flat()]);
}
