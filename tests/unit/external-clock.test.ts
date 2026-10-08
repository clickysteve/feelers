import { describe, expect, it } from 'vitest';
import { DEMOS } from '../../src/demos/demos';
import { Engine, cloneProject, type NoteEvent } from '../../src/engine/engine';
import { makeLine, makeProject, makeSeries } from '../../src/engine/factory';
import type { Project } from '../../src/engine/types';
import { CLOCK, CONTINUE, START, STOP } from '../../src/midi/messages';
import { PulseEstimator } from '../../src/scheduler/pulses';
import { CLOCK_LOSS_MS } from '../../src/scheduler/scheduler';
import { checkPairing, rig } from './helpers';

const P120 = 60000 / (120 * 24); // 20.8333 ms per pulse at 120 BPM

function proj(over: (p: Project) => void = () => {}): Project {
  const p = makeProject({
    tempo: 100,
    series: [
      makeSeries('time', 1, '24'),
      makeSeries('time', 2, '6 18'),
      makeSeries('pitch', 1, 'C4 D4 E4'),
      makeSeries('pitch', 2, 'C3'),
      makeSeries('velocity', 1, '100'),
      makeSeries('artic', 1, '50'),
      makeSeries('artic', 2, '200'),
    ],
    lines: [
      makeLine(0, { time: 'T1', pitch: 'P1' }),
      makeLine(1, { time: 'T2', pitch: 'P2' }),
      makeLine(2, {}, { mute: true }),
      makeLine(3, {}, { mute: true }),
    ],
  });
  p.options.programOnStart = false;
  over(p);
  return p;
}

/** A scheduler following an external clock, with helpers to send realtime bytes. */
function ext(project: Project) {
  const r = rig(project);
  r.sched.setSource('external');
  r.sched.setInputReady(true);
  const notes: { ev: NoteEvent; ms: number }[] = [];
  const pulseTimes: number[] = [];
  r.sched.on((e) => e.type === 'note' && notes.push({ ev: e.note, ms: e.ms }));
  const send = (b: number) => r.sched.receive([b], r.clock.t);
  /** Send n pulses, `period` ms apart (or a function giving each interval). */
  const pulses = (n: number, period: number | ((i: number) => number) = P120) => {
    for (let i = 0; i < n; i++) {
      r.clock.t += typeof period === 'number' ? period : period(i);
      pulseTimes.push(r.clock.t);
      send(CLOCK);
      r.sched.pump(); // the watchdog runs alongside
    }
  };
  /** Let time pass with no pulses (watchdog keeps ticking). */
  const silence = (ms: number) => {
    const end = r.clock.t + ms;
    while (r.clock.t < end) {
      r.clock.t = Math.min(end, r.clock.t + 25);
      r.sched.pump();
    }
  };
  return { ...r, notes, pulseTimes, send, pulses, silence };
}

const sig = (n: NoteEvent) => [n.line, +n.tick.toFixed(6), n.pitch, n.velocity, +n.duration.toFixed(6), n.silent];

describe('external clock: 24 PPQN and transport', () => {
  it('each F8 is one tick: a quarter-note line plays on every 24th pulse', () => {
    const e = ext(proj());
    e.send(START);
    e.pulses(73);
    const ch1 = e.sink.notes().filter((n) => n.on && n.ch === 1);
    expect(ch1.map((n) => n.t)).toEqual([e.pulseTimes[0], e.pulseTimes[24], e.pulseTimes[48], e.pulseTimes[72]]);
    expect(ch1.map((n) => n.note)).toEqual([60, 62, 64, 60]);
  });

  it('F8 while stopped does not start playback', () => {
    const e = ext(proj());
    e.pulses(200);
    expect(e.sched.state).toBe('stopped');
    expect(e.notes).toEqual([]);
    expect(e.sink.notes()).toEqual([]);
    expect(e.engine.horizon).toBe(0);
    expect(e.sched.syncStatus()).toBe('clock');
  });

  it('FA starts fresh; the first pulse after FA is tick 0', () => {
    const e = ext(proj());
    e.send(START);
    expect(e.sched.state).toBe('playing');
    expect(e.notes).toEqual([]); // nothing before the first pulse
    e.pulses(1);
    // all four lines (two of them muted, so silent) assemble their first note on tick 0
    expect(e.notes.map((n) => n.ev.tick)).toEqual([0, 0, 0, 0]);
    expect(e.notes[0]!.ms).toBe(e.pulseTimes[0]);
  });

  it('time advances only when pulses arrive, never ahead of the next pulse', () => {
    const e = ext(proj());
    e.send(START);
    for (let i = 1; i <= 50; i++) {
      e.pulses(1);
      expect(e.engine.horizon).toBe(i);
      const latest = Math.max(...e.sink.sent.map((m) => m.t));
      expect(latest).toBeLessThanOrEqual(e.clock.t + P120 + 1e-6);
    }
    e.silence(200); // a pause shorter than the loss timeout: nothing moves
    expect(e.engine.horizon).toBe(50);
  });

  it('FC stops safely, keeps position, and F8 after FC does not advance', () => {
    const e = ext(proj((p) => (p.lines[0]!.heads.artic.series = 'A2')));
    e.send(START);
    e.pulses(30);
    e.send(STOP);
    expect(e.sched.state).toBe('paused');
    expect(e.sched.syncStatus()).toBe('stopped');
    expect(e.out.heldCount()).toBe(0);
    expect(checkPairing(e.sink).ok).toBe(true);
    const h = e.engine.horizon;
    const sent = e.sink.sent.length;
    e.pulses(100);
    expect(e.engine.horizon).toBe(h);
    expect(e.sink.sent.length).toBe(sent);
  });

  it('FA, F8.., FC, F8.., FB, F8..: Continue resumes exactly where Stop left off', () => {
    const ref = ext(proj());
    ref.send(START);
    ref.pulses(200);
    const want = ref.notes.map((n) => sig(n.ev));

    const e = ext(proj());
    e.send(START);
    e.pulses(80);
    e.send(STOP);
    e.pulses(37); // clock keeps running while stopped
    e.send(CONTINUE);
    e.pulses(120);
    expect(e.notes.map((n) => sig(n.ev))).toEqual(want);
    expect(e.engine.horizon).toBe(200);
  });

  it('FA, F8.., FC, FA, F8..: a second Start is a genuinely fresh performance', () => {
    // Seed-dependent WOBBLE randomisation proves the random generator resets too.
    // (DRIFT cells rewrite the material itself, under either clock, so are not used here.)
    const p = proj((x) => {
      const p1 = x.series.find((s) => s.id === 'P1')!;
      p1.cells = p1.cells.map((c) => (c.t === 'v' ? { ...c, r: 1 as const } : c));
      p1.rand = { amount: 2, type: 0, prob: 70 };
      x.lines[1]!.heads.pitch.series = 'P1';
    });
    const fresh = ext(cloneProject(p));
    fresh.send(START);
    fresh.pulses(300);
    const want = fresh.notes.map((n) => sig(n.ev));

    const e = ext(cloneProject(p));
    e.send(START);
    e.pulses(170);
    e.send(STOP);
    e.notes.length = 0;
    e.send(START);
    e.pulses(300);
    expect(e.notes.map((n) => sig(n.ev))).toEqual(want);
  });

  it('Start and Continue are different', () => {
    const run = (second: number) => {
      const e = ext(proj());
      e.send(START);
      e.pulses(50);
      e.send(STOP);
      e.notes.length = 0;
      e.send(second);
      e.pulses(30);
      return e.notes.map((n) => n.ev.tick);
    };
    expect(run(START)[0]).toBe(0);
    expect(run(CONTINUE)[0]).toBeGreaterThanOrEqual(50);
  });

  it('FB from a cold stop plays from the beginning without needing FA', () => {
    const e = ext(proj());
    e.send(CONTINUE);
    e.pulses(1);
    expect(e.notes.map((n) => n.ev.tick)).toEqual([0, 0, 0, 0]);
  });

  it('FA while running restarts cleanly with nothing left hanging', () => {
    const e = ext(proj((p) => (p.lines[0]!.heads.artic.series = 'A2')));
    e.send(START);
    e.pulses(40);
    e.send(START);
    e.pulses(40);
    e.send(STOP);
    expect(checkPairing(e.sink).ok).toBe(true);
  });
});

describe('external clock: the musical model is preserved', () => {
  it('every demo produces exactly the notes the engine defines (lines, Time Adjust, rests, skips, loops, links, delays, randomisation)', () => {
    for (const d of DEMOS) {
      const p = d.build();
      p.options.programOnStart = false;
      const want = new Engine(cloneProject(p)).generate(24 * 32).map(sig);
      const e = ext(cloneProject(p));
      e.send(START);
      e.pulses(24 * 32);
      expect(e.notes.map((n) => sig(n.ev)), d.id).toEqual(want);
      e.send(STOP);
      expect(checkPairing(e.sink).ok, d.id).toBe(true);
    }
  });

  it('reverse traversal under external clock matches the engine', () => {
    const p = proj((x) => {
      x.lines[0]!.heads.pitch = { series: 'P1', start: 2, startDir: -1 };
      x.lines[1]!.heads.time = { series: 'T2', start: 1, startDir: -1 };
    });
    const want = new Engine(cloneProject(p)).generate(200).map(sig);
    const e = ext(p);
    e.send(START);
    e.pulses(200);
    expect(e.notes.map((n) => sig(n.ev))).toEqual(want);
    expect(e.notes.filter((n) => n.ev.line === 0).map((n) => n.ev.pitch).slice(0, 4)).toEqual([64, 62, 60, 64]);
  });

  it('Time Adjust: fractional onsets are placed between pulses by the measured period', () => {
    const e = ext(proj((p) => (p.lines[0]!.timeScale = 1.0125)));
    e.send(START);
    e.pulses(24 * 20);
    const line0 = e.notes.filter((n) => n.ev.line === 0);
    expect(line0.some((n) => !Number.isInteger(n.ev.tick))).toBe(true);
    for (const n of line0) {
      const k = Math.floor(n.ev.tick);
      // released on pulse k, placed (tick - k) of a pulse after it
      expect(n.ms).toBeCloseTo(e.pulseTimes[k]! + (n.ev.tick - k) * P120, 6);
    }
  });

  it('Time Adjust lines drift against straight lines exactly as under internal clock', () => {
    const p = proj((x) => {
      x.lines[1]!.heads.time.series = 'T1';
      x.lines[1]!.timeScale = 1.5;
    });
    const e = ext(p);
    e.send(START);
    e.pulses(24 * 6 + 1);
    expect(e.notes.filter((n) => n.ev.line === 1).map((n) => n.ev.tick)).toEqual([0, 36, 72, 108, 144]);
  });

  it('Advance/Delay: entry delay and live shifts are counted in pulses', () => {
    const e = ext(proj((p) => (p.lines[0]!.delay = 6)));
    e.send(START);
    e.pulses(10);
    expect(e.sink.notes().find((n) => n.on && n.ch === 1)!.t).toBe(e.pulseTimes[6]);
    e.engine.nudge(0, 12, e.sched.at()); // line 0 next due at 30, now 42
    e.pulses(50);
    expect(e.notes.filter((n) => n.ev.line === 0).map((n) => n.ev.tick)).toEqual([6, 42]);
  });

  it('note-offs follow the clock: an off is sent only when its pulse arrives', () => {
    const e = ext(proj((p) => (p.lines[0]!.heads.artic.series = 'A1'))); // 50% of 24 ticks = 12
    e.send(START);
    e.pulses(12); // pulses 0..11
    const offs = () => e.sink.notes().filter((n) => !n.on && n.ch === 1);
    expect(offs()).toEqual([]);
    e.pulses(1); // pulse 12
    expect(offs().map((o) => o.t)).toEqual([e.pulseTimes[12]]);
  });

  it('fractional note-offs are placed between pulses, not quantised', () => {
    const e = ext(proj((p) => (p.series.find((s) => s.id === 'A1')!.cells = [{ t: 'v', v: 37 }])));
    e.send(START);
    e.pulses(30);
    const off = e.sink.notes().find((n) => !n.on && n.ch === 1)!; // 24 * 0.37 = 8.88 ticks
    expect(off.t).toBeCloseTo(e.pulseTimes[8]! + 0.88 * P120, 6);
  });

  it('strict monophony and legato overlap behave as under internal clock', () => {
    for (const legato of [false, true]) {
      const e = ext(
        proj((p) => {
          p.lines[0]!.heads.artic.series = 'A2';
          p.lines[0]!.legato = legato;
        }),
      );
      e.send(START);
      e.pulses(24 * 8);
      e.send(STOP);
      const res = checkPairing(e.sink);
      expect(res.ok).toBe(true);
      expect(res.maxPolyPerChannel[1]).toBe(legato ? 2 : 1);
    }
  });

  it('irregular F8 intervals: the musical sequence is unchanged and every integer tick lands on its pulse', () => {
    const want = (() => {
      const e = ext(proj((p) => (p.lines[1]!.timeScale = 0.75)));
      e.send(START);
      e.pulses(300);
      return e.notes.map((n) => sig(n.ev));
    })();
    let seed = 9;
    const jitter = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return P120 + ((seed / 2 ** 31) * 2 - 1) * 8; // +/- 8 ms on a 20.8 ms pulse
    };
    const e = ext(proj((p) => (p.lines[1]!.timeScale = 0.75)));
    e.send(START);
    e.pulses(300, jitter);
    expect(e.notes.map((n) => sig(n.ev))).toEqual(want);
    for (const n of e.notes) {
      const k = Math.floor(n.ev.tick);
      if (Number.isInteger(n.ev.tick)) expect(n.ms).toBe(e.pulseTimes[k]);
      else {
        expect(n.ms).toBeGreaterThan(e.pulseTimes[k]!);
        expect(n.ms).toBeLessThan(e.pulseTimes[k]! + 2 * P120);
      }
    }
    e.send(STOP);
    expect(checkPairing(e.sink).ok).toBe(true);
  });

  it('follows tempo changes immediately, pulse by pulse', () => {
    const e = ext(proj());
    e.send(START);
    e.pulses(48, P120);
    e.pulses(48, P120 * 2); // drops to 60 BPM
    e.pulses(48, P120 * 2);
    const ch1 = e.sink.notes().filter((n) => n.on && n.ch === 1).map((n) => n.t);
    // pulses 0-47 are 120 BPM, 48 onwards 60 BPM
    expect(ch1[1]! - ch1[0]!).toBeCloseTo(24 * P120, 6);
    expect(ch1[3]! - ch1[2]!).toBeCloseTo(24 * P120 * 2, 6);
  });
});

describe('external clock: tempo estimate', () => {
  it('is stable under jitter and does not drive timing', () => {
    const est = new PulseEstimator();
    let s = 3;
    const shown: number[] = [];
    for (let i = 0; i < 24 * 40; i++) {
      s = (s * 69069 + 1) % 2 ** 32;
      est.add(1000 + i * P120 + ((s / 2 ** 32) * 2 - 1) * 3); // steady clock read with +/- 3 ms jitter
      const b = est.bpm();
      if (b !== null && i > 48) shown.push(b);
    }
    expect(Math.abs(shown.at(-1)! - 120)).toBeLessThan(0.6);
    // the display changes rarely despite jitter on every pulse
    const changes = shown.filter((v, i) => i > 0 && v !== shown[i - 1]).length;
    expect(changes).toBeLessThan(shown.length / 20);
  });

  it('tracks a tempo change within about two beats', () => {
    const est = new PulseEstimator();
    let t = 0;
    for (let i = 0; i < 96; i++) est.add((t += P120));
    expect(est.bpm()).toBeCloseTo(120, 0);
    for (let i = 0; i < 49; i++) est.add((t += 60000 / (90 * 24)));
    expect(est.bpm()).toBeCloseTo(90, 0);
  });

  it('a long silence starts a new measurement instead of reading as a slow tempo', () => {
    const est = new PulseEstimator();
    let t = 0;
    for (let i = 0; i < 60; i++) est.add((t += P120));
    est.add((t += 3000));
    expect(est.bpm()).toBeNull();
    for (let i = 0; i < 30; i++) est.add((t += P120));
    expect(est.bpm()).toBeCloseTo(120, 0);
  });

  it('the displayed tempo is informational: changing the BPM setting does not move notes', () => {
    const e = ext(proj());
    e.send(START);
    e.pulses(30);
    e.sched.setTempo(40);
    e.pulses(30);
    const ch1 = e.sink.notes().filter((n) => n.on && n.ch === 1);
    expect(ch1.map((n) => n.t)).toEqual([e.pulseTimes[0], e.pulseTimes[24], e.pulseTimes[48]]);
  });
});

describe('external clock: loss, devices and switching', () => {
  it('clock loss while running: notes released, position held, clearly LOST, no tempo guessing', () => {
    const e = ext(proj((p) => (p.lines[0]!.heads.artic.series = 'A2')));
    e.send(START);
    e.pulses(30);
    const h = e.engine.horizon;
    e.silence(CLOCK_LOSS_MS + 100);
    expect(e.sched.syncStatus()).toBe('lost');
    expect(e.sched.state).toBe('playing'); // no Stop was received
    expect(e.engine.horizon).toBe(h); // nothing advanced on its own
    const notesBefore = e.sink.notes().length;
    e.silence(2000);
    expect(e.sink.notes().length).toBe(notesBefore);
    expect(checkPairing(e.sink).ok).toBe(true);
  });

  it('clock return continues from the held position (no implicit Start)', () => {
    const ref = ext(proj());
    ref.send(START);
    ref.pulses(120);

    const e = ext(proj());
    e.send(START);
    e.pulses(50);
    e.silence(CLOCK_LOSS_MS + 100);
    e.pulses(70);
    expect(e.sched.syncStatus()).toBe('running');
    expect(e.notes.map((n) => sig(n.ev))).toEqual(ref.notes.map((n) => sig(n.ev)));
  });

  it('device disconnection releases notes at once; reconnection resumes on the next pulse', () => {
    const e = ext(proj((p) => (p.lines[0]!.heads.artic.series = 'A2')));
    e.send(START);
    e.pulses(30);
    e.sched.setInputReady(false);
    e.sched.clockInterrupted();
    expect(e.sched.syncStatus()).toBe('lost');
    // offs are queued no earlier than anything already sent for the current pulse
    expect(checkPairing(e.sink).ok).toBe(true);
    e.sched.setInputReady(true);
    e.pulses(30);
    expect(e.sched.syncStatus()).toBe('running');
    expect(e.engine.horizon).toBe(60);
  });

  it('changing input mid-performance releases notes and follows the new clock', () => {
    const e = ext(proj((p) => (p.lines[0]!.heads.artic.series = 'A2')));
    e.send(START);
    e.pulses(30);
    e.sched.clockInterrupted(); // what the app does on an input change
    expect(e.out.heldCount()).toBe(0);
    e.pulses(30, P120 * 1.5); // new device, different tempo
    e.send(STOP);
    expect(checkPairing(e.sink).ok).toBe(true);
    expect(e.engine.horizon).toBe(60);
  });

  it('EXTERNAL to INTERNAL stops cleanly; the internal transport then works as before', () => {
    const e = ext(proj((p) => (p.lines[0]!.heads.artic.series = 'A2')));
    e.send(START);
    e.pulses(30);
    e.sched.setSource('internal');
    expect(e.sched.state).toBe('stopped');
    expect(e.out.heldCount()).toBe(0);
    e.sched.start();
    e.run(1000);
    e.sched.stop();
    expect(checkPairing(e.sink).ok).toBe(true);
    expect(e.sink.notes().filter((n) => n.on && n.t > e.pulseTimes.at(-1)!).length).toBeGreaterThan(2);
  });

  it('INTERNAL to EXTERNAL stops cleanly; local Start is ignored until the clock starts it', () => {
    const r = rig(proj((p) => (p.lines[0]!.heads.artic.series = 'A2')));
    r.sched.start();
    r.run(600);
    r.sched.setSource('external');
    expect(r.sched.state).toBe('stopped');
    expect(r.out.heldCount()).toBe(0);
    r.sched.start();
    expect(r.sched.state).toBe('stopped');
    r.run(1000);
    expect(checkPairing(r.sink).ok).toBe(true);
  });

  it('never echoes clock: no Clock, Start, Stop or Continue is sent while following', () => {
    const e = ext(proj((p) => (p.options.clockOut = true)));
    e.send(START);
    e.pulses(100);
    e.send(STOP);
    e.pulses(10);
    e.send(CONTINUE);
    e.pulses(50);
    e.sched.stop();
    expect(e.sink.sent.filter((m) => m.bytes[0]! >= 0xf0)).toEqual([]);
    expect(e.sink.notes().length).toBeGreaterThan(0);
  });

  it('back on INTERNAL, MIDI Clock output works as before', () => {
    const e = ext(proj((p) => (p.options.clockOut = true)));
    e.send(START);
    e.pulses(20);
    e.sched.setSource('internal');
    e.sink.sent = [];
    e.sched.start();
    e.run(500);
    const sys = e.sink.sent.filter((m) => m.bytes[0]! >= 0xf0).map((m) => m.bytes[0]);
    expect(sys[0]).toBe(START);
    expect(sys.filter((b) => b === CLOCK).length).toBeGreaterThan(20);
  });

  it('only realtime bytes act; notes and other messages from the input are ignored', () => {
    const e = ext(proj());
    e.sched.receive([0x90, 60, 100], e.clock.t);
    e.sched.receive([0xfe], e.clock.t); // active sensing
    expect(e.sched.state).toBe('stopped');
    e.sched.receive([START], e.clock.t);
    e.sched.receive([CLOCK], e.clock.t + 1);
    expect(e.engine.horizon).toBe(1);
  });

  it('INTERNAL ignores incoming clock bytes entirely', () => {
    const r = rig(proj());
    r.sched.receive([START], r.clock.t);
    r.sched.receive([CLOCK], r.clock.t);
    expect(r.sched.state).toBe('stopped');
    expect(r.sched.syncStatus()).toBe('internal');
  });

  it('status reads WAITING, CLOCK, RUNNING, STOPPED, LOST as the stream changes', () => {
    const e = ext(proj());
    const seen: string[] = [];
    e.sched.on((x) => x.type === 'sync' && seen.push(x.status));
    expect(e.sched.syncStatus()).toBe('waiting');
    e.pulses(5);
    e.send(START);
    e.pulses(5);
    e.send(STOP);
    e.send(CONTINUE);
    e.silence(CLOCK_LOSS_MS + 100);
    expect(seen).toEqual(['clock', 'running', 'stopped', 'running', 'lost']);
  });
});
