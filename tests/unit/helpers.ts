import { Engine } from '../../src/engine/engine';
import type { Project } from '../../src/engine/types';
import { MidiOutput, type MidiSink } from '../../src/midi/output';
import { Scheduler, type Ticker } from '../../src/scheduler/scheduler';

export class FakeClock {
  t = 1000;
  now = () => this.t;
}

export class ManualTicker implements Ticker {
  fn: (() => void) | null = null;
  start(fn: () => void): void {
    this.fn = fn;
  }
  stop(): void {
    this.fn = null;
  }
}

export interface Sent {
  bytes: number[];
  t: number;
}

/** Simulated MIDI device: records every message with its timestamp. */
export class RecordingSink implements MidiSink {
  id = 'fake';
  name = 'Fake device';
  sent: Sent[] = [];
  cleared = 0;
  constructor(
    private supportsClear = true,
    private now: () => number = () => 0,
  ) {
    if (!supportsClear) (this as { clear?: unknown }).clear = undefined;
  }
  send(bytes: number[], t = 0): void {
    this.sent.push({ bytes: [...bytes], t });
  }
  clear(): void {
    if (!this.supportsClear) return;
    this.cleared++;
    // Like MIDIOutput.clear(): drop everything not yet emitted.
    const t = this.now();
    this.sent = this.sent.filter((m) => m.t <= t);
  }
  /** Messages sorted by timestamp (stable), as the device would emit them. */
  ordered(): Sent[] {
    return this.sent.map((s, i) => ({ s, i })).sort((a, b) => a.s.t - b.s.t || a.i - b.i).map((x) => x.s);
  }
  notes(): { on: boolean; ch: number; note: number; vel: number; t: number }[] {
    return this.ordered()
      .filter((m) => (m.bytes[0]! & 0xe0) === 0x80)
      .map((m) => {
        const isOn = (m.bytes[0]! & 0xf0) === 0x90 && m.bytes[2]! > 0;
        return { on: isOn, ch: (m.bytes[0]! & 0x0f) + 1, note: m.bytes[1]!, vel: m.bytes[2]!, t: m.t };
      });
  }
}

export function rig(project: Project, opts: { clear?: boolean } = {}) {
  const clock = new FakeClock();
  const ticker = new ManualTicker();
  const engine = new Engine(project);
  const out = new MidiOutput(clock.now);
  const sink = new RecordingSink(opts.clear ?? true, clock.now);
  out.setSink(sink);
  const sched = new Scheduler(engine, out, clock.now, ticker);
  /** Advance time in pump-sized steps. */
  const run = (ms: number, step = 25) => {
    const end = clock.t + ms;
    while (clock.t < end) {
      clock.t = Math.min(end, clock.t + step);
      sched.pump();
    }
  };
  return { clock, ticker, engine, out, sink, sched, run };
}

/** Assert every note-on is matched by a later note-off and nothing is left hanging. */
export function checkPairing(sink: RecordingSink): { ok: boolean; hanging: string[]; maxPolyPerChannel: Record<number, number> } {
  const held = new Map<string, number>();
  const maxPoly: Record<number, number> = {};
  const poly: Record<number, number> = {};
  for (const n of sink.notes()) {
    const k = `${n.ch}:${n.note}`;
    if (n.on) {
      if ((held.get(k) ?? 0) > 0) return { ok: false, hanging: [`double on ${k}`], maxPolyPerChannel: maxPoly };
      held.set(k, 1);
      poly[n.ch] = (poly[n.ch] ?? 0) + 1;
      maxPoly[n.ch] = Math.max(maxPoly[n.ch] ?? 0, poly[n.ch]!);
    } else if ((held.get(k) ?? 0) > 0) {
      held.set(k, 0);
      poly[n.ch] = (poly[n.ch] ?? 1) - 1;
    }
  }
  const hanging = [...held.entries()].filter(([, v]) => v > 0).map(([k]) => k);
  return { ok: hanging.length === 0, hanging, maxPolyPerChannel: maxPoly };
}
