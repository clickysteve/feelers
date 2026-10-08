import { describe, expect, it } from 'vitest';
import { makeLine, makeProject, makeSeries } from '../../src/engine/factory';
import type { Project } from '../../src/engine/types';
import { CLOCK, CONTINUE, START, STOP } from '../../src/midi/messages';
import { checkPairing, rig } from './helpers';

function proj(over: (p: Project) => void = () => {}): Project {
  const p = makeProject({
    tempo: 120,
    series: [
      makeSeries('time', 1, '12'),
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

// At 120 BPM: 1 tick = 60000 / (120 * 24) = 20.833 ms

describe('scheduler timing', () => {
  it('places notes at tempo-accurate timestamps', () => {
    const r = rig(proj());
    r.sched.start();
    r.run(1000);
    const ons = r.sink.notes().filter((n) => n.on && n.ch === 1);
    const t0 = ons[0]!.t;
    expect(t0).toBeCloseTo(1040, 5); // start latency 40 ms
    const gaps = ons.slice(1, 5).map((n, i) => n.t - ons[i]!.t);
    for (const g of gaps) expect(g).toBeCloseTo(250, 5); // 12 ticks = an eighth at 120
  });

  it('never schedules further ahead than the lookahead window', () => {
    const r = rig(proj());
    r.sched.start();
    for (let i = 0; i < 40; i++) {
      r.run(25);
      const latest = Math.max(...r.sink.sent.map((s) => s.t));
      expect(latest).toBeLessThanOrEqual(r.clock.t + 100 + 1e-6);
    }
  });

  it('tempo change applies from the scheduling horizon without glitches', () => {
    const r = rig(proj());
    r.sched.start();
    r.run(500);
    r.sched.setTempo(60);
    r.run(3000);
    const ons = r.sink.notes().filter((n) => n.on && n.ch === 1);
    const gaps = ons.slice(1).map((n, i) => n.t - ons[i]!.t);
    // every gap is either the old (250 ms) or new (500 ms) eighth, or one mixed gap
    const mixed = gaps.filter((g) => Math.abs(g - 250) > 1e-6 && Math.abs(g - 500) > 1e-6);
    expect(mixed.length).toBeLessThanOrEqual(1);
    expect(gaps.at(-1)).toBeCloseTo(500, 5);
    // monotonic timestamps per channel
    for (let i = 1; i < ons.length; i++) expect(ons[i]!.t).toBeGreaterThan(ons[i - 1]!.t);
  });
});

describe('note pairing and monophony', () => {
  it('every note-on is paired with a note-off', () => {
    const r = rig(proj());
    r.sched.start();
    r.run(5000);
    r.sched.stop();
    expect(checkPairing(r.sink)).toMatchObject({ ok: true });
  });

  it('a line never sounds more than one note (strict mono, long articulation)', () => {
    const r = rig(proj((p) => (p.lines[0]!.heads.artic.series = 'A2')));
    r.sched.start();
    r.run(4000);
    r.sched.stop();
    const res = checkPairing(r.sink);
    expect(res.ok).toBe(true);
    expect(res.maxPolyPerChannel[1]).toBe(1);
  });

  it('legato lets the next note start before the previous ends', () => {
    const r = rig(
      proj((p) => {
        p.lines[0]!.heads.artic.series = 'A2';
        p.lines[0]!.legato = true;
      }),
    );
    r.sched.start();
    r.run(2000);
    r.sched.stop();
    const res = checkPairing(r.sink);
    expect(res.ok).toBe(true);
    expect(res.maxPolyPerChannel[1]).toBe(2);
    // the overlap is momentary: off comes at the same timestamp as the next on
    const msgs = r.sink.notes().filter((n) => n.ch === 1);
    const firstOff = msgs.find((m) => !m.on)!;
    const secondOn = msgs.filter((m) => m.on)[1]!;
    expect(firstOff.t).toBeCloseTo(secondOn.t, 6);
  });

  it('repeated notes are cut before being re-struck', () => {
    const r = rig(
      proj((p) => {
        p.series.find((s) => s.id === 'P1')!.cells = [{ t: 'v', v: 60 }];
        p.lines[0]!.heads.artic.series = 'A2';
        p.lines[0]!.legato = true;
      }),
    );
    r.sched.start();
    r.run(1000);
    const msgs = r.sink.notes().filter((n) => n.ch === 1);
    for (let i = 1; i < msgs.length; i++) {
      if (msgs[i]!.on) expect(msgs[i - 1]!.on).toBe(false);
    }
  });

  it('lines sharing a channel do not cut each other', () => {
    const r = rig(
      proj((p) => {
        p.lines[1]!.channel = 1;
        p.lines[1]!.heads.pitch.series = 'P1';
        p.lines[1]!.heads.time.series = 'T1';
      }),
    );
    r.sched.start();
    r.run(3000);
    r.sched.stop();
    expect(checkPairing(r.sink).ok).toBe(true);
  });

  it('channel isolation: each line speaks only on its channel', () => {
    const r = rig(proj((p) => (p.lines[1]!.channel = 9)));
    r.sched.start();
    r.run(2000);
    const chans = new Set(r.sink.notes().map((n) => n.ch));
    expect([...chans].sort()).toEqual([1, 9]);
    const c9 = r.sink.notes().filter((n) => n.ch === 9 && n.on);
    expect(c9.every((n) => n.note === 48)).toBe(true);
  });

  it('changing a channel mid-note releases on the original channel', () => {
    const r = rig(proj((p) => (p.lines[0]!.heads.artic.series = 'A2')));
    r.sched.start();
    r.run(300);
    r.engine.project.lines[0]!.channel = 5;
    r.run(1000);
    r.sched.stop();
    expect(checkPairing(r.sink).ok).toBe(true);
    expect(r.sink.notes().some((n) => n.ch === 5)).toBe(true);
  });

  it('muting releases the line and silences further notes', () => {
    const r = rig(proj((p) => (p.lines[0]!.heads.artic.series = 'A2')));
    r.sched.start();
    r.run(500);
    r.engine.project.lines[0]!.mute = true;
    r.sched.releaseLine(0);
    const before = r.sink.notes().filter((n) => n.ch === 1 && n.on).length;
    r.run(1000);
    expect(r.sink.notes().filter((n) => n.ch === 1 && n.on).length).toBe(before);
    r.sched.stop();
    expect(checkPairing(r.sink).ok).toBe(true);
  });
});

describe('transport', () => {
  it('pause silences, resume continues the same stream', () => {
    const ref = rig(proj());
    ref.sched.start();
    ref.run(4000);
    const refPitches = ref.sink.notes().filter((n) => n.on && n.ch === 1).map((n) => n.note);

    const r = rig(proj());
    r.sched.start();
    r.run(1000);
    r.sched.pause();
    const afterPause = r.sink.sent.length;
    r.run(2000);
    expect(r.sink.sent.length).toBe(afterPause); // nothing while paused
    expect(r.out.heldCount()).toBe(0);
    r.sched.resume();
    r.run(3000);
    const pitches = r.sink.notes().filter((n) => n.on && n.ch === 1).map((n) => n.note);
    expect(pitches.slice(0, refPitches.length - 1)).toEqual(refPitches.slice(0, pitches.length).slice(0, refPitches.length - 1));
    r.sched.stop();
    expect(checkPairing(r.sink).ok).toBe(true);
  });

  it('pause preserves line timing across the gap', () => {
    const r = rig(proj());
    r.sched.start();
    r.run(1010);
    r.sched.pause();
    const lastOn = r.sink.notes().filter((n) => n.on && n.ch === 1).at(-1)!;
    r.run(5000);
    r.sched.resume();
    const resumeAt = r.clock.t + 40;
    r.run(1000);
    const next = r.sink.notes().filter((n) => n.on && n.ch === 1 && n.t > lastOn.t)[0]!;
    // the gap is the pre-pause remainder (some fraction of 250 ms) after resume
    expect(next.t - resumeAt).toBeGreaterThanOrEqual(0);
    expect(next.t - resumeAt).toBeLessThan(250 + 1e-6);
  });

  it('stop resets: start afterwards replays from the beginning', () => {
    const r = rig(proj());
    r.sched.start();
    r.run(1500);
    const first = r.sink.notes().filter((n) => n.on).map((n) => `${n.ch}:${n.note}`);
    r.sched.stop();
    r.sink.sent = [];
    r.sched.start();
    r.run(1500);
    const second = r.sink.notes().filter((n) => n.on).map((n) => `${n.ch}:${n.note}`);
    expect(second).toEqual(first);
  });

  it('stop releases sounding notes immediately and cancels queued ones', () => {
    const r = rig(proj((p) => (p.lines[0]!.heads.artic.series = 'A2')));
    r.sched.start();
    r.run(510);
    r.sched.stop();
    expect(r.sink.cleared).toBeGreaterThan(0);
    expect(r.out.heldCount()).toBe(0);
    // nothing remains queued for the future, and nothing is left hanging
    expect(r.sink.sent.every((m) => m.t <= r.clock.t)).toBe(true);
    expect(checkPairing(r.sink).ok).toBe(true);
  });

  it('without clear() support, emergency note-offs follow queued note-ons', () => {
    const r = rig(proj(), { clear: false });
    r.sched.start();
    r.run(510);
    const latestOn = Math.max(...r.sink.notes().filter((n) => n.on).map((n) => n.t));
    r.sched.stop();
    const offs = r.sink.notes().filter((n) => !n.on);
    expect(Math.max(...offs.map((o) => o.t))).toBeGreaterThan(latestOn);
    expect(checkPairing(r.sink).ok).toBe(true);
  });

  it('sends program changes on Start when enabled', () => {
    const r = rig(
      proj((p) => {
        p.options.programOnStart = true;
        p.lines[0]!.program = 5;
      }),
    );
    r.sched.start();
    const pc = r.sink.sent.find((m) => (m.bytes[0]! & 0xf0) === 0xc0)!;
    expect(pc.bytes).toEqual([0xc0, 5]);
    const firstNote = r.sink.notes()[0]!;
    expect(pc.t).toBeLessThan(firstNote.t);
  });

  it('manual step while stopped auditions one note', () => {
    const r = rig(proj());
    r.sched.stepLine(0);
    r.sched.stepLine(0);
    const ons = r.sink.notes().filter((n) => n.on);
    expect(ons.map((n) => n.note)).toEqual([60, 62]);
    expect(checkPairing(r.sink).ok).toBe(true);
  });
});

describe('MIDI clock and transport messages', () => {
  const sys = (r: ReturnType<typeof rig>) => r.sink.ordered().filter((m) => m.bytes[0]! >= 0xf0);

  it('Start, 24 PPQN clock, Stop and song position reset', () => {
    const r = rig(proj((p) => (p.options.clockOut = true)));
    r.sched.start();
    r.run(1000);
    r.sched.stop();
    const m = sys(r);
    expect(m[0]!.bytes).toEqual([START]);
    const clocks = m.filter((x) => x.bytes[0] === CLOCK);
    expect(clocks[0]!.t).toBe(m[0]!.t); // first clock coincides with Start
    for (let i = 1; i < clocks.length; i++) expect(clocks[i]!.t - clocks[i - 1]!.t).toBeCloseTo(60000 / (120 * 24), 6);
    const tail = m.slice(-2).map((x) => x.bytes[0]);
    expect(tail).toEqual([STOP, 0xf2]);
  });

  it('Pause sends Stop, Continue sends Continue, and the clock resumes', () => {
    const r = rig(proj((p) => (p.options.clockOut = true)));
    r.sched.start();
    r.run(500);
    r.sched.pause();
    const pauseCount = sys(r).filter((x) => x.bytes[0] === CLOCK).length;
    r.run(1000);
    expect(sys(r).filter((x) => x.bytes[0] === CLOCK).length).toBe(pauseCount);
    r.sched.resume();
    r.run(500);
    const m = sys(r);
    const kinds = m.filter((x) => x.bytes[0] !== CLOCK).map((x) => x.bytes[0]);
    expect(kinds).toEqual([START, STOP, CONTINUE]);
    const cont = m.find((x) => x.bytes[0] === CONTINUE)!;
    const after = m.filter((x) => x.bytes[0] === CLOCK && x.t >= cont.t);
    expect(after.length).toBeGreaterThan(10);
  });

  it('no clock or transport bytes when clock out is off', () => {
    const r = rig(proj());
    r.sched.start();
    r.run(500);
    r.sched.pause();
    r.sched.resume();
    r.sched.stop();
    expect(sys(r)).toEqual([]);
  });

  it('clock count matches musical position', () => {
    const r = rig(proj((p) => (p.options.clockOut = true)));
    r.sched.start();
    r.run(2040);
    // 2000 ms of music at 120 BPM = 4 beats = 96 clocks (plus up to one lookahead window)
    const clocks = sys(r).filter((x) => x.bytes[0] === CLOCK && x.t < 1040 + 2000);
    expect(clocks.length).toBe(96);
  });
});

describe('device safety', () => {
  it('switching device releases held notes on the old one', () => {
    const r = rig(proj((p) => (p.lines[0]!.heads.artic.series = 'A2')));
    r.sched.start();
    r.run(300);
    const old = r.sink;
    r.out.setSink(null);
    expect(checkPairing(old).ok).toBe(true);
  });

  it('device loss forgets held notes and playback carries on', () => {
    const r = rig(proj());
    r.sched.start();
    r.run(300);
    r.out.deviceLost();
    expect(r.out.heldCount()).toBe(0);
    expect(() => r.run(500)).not.toThrow();
    expect(r.sched.state).toBe('playing');
  });

  it('a throwing device does not stop the scheduler', () => {
    const r = rig(proj());
    r.out.setSink({ id: 'x', name: 'x', send: () => { throw new Error('gone'); } });
    r.sched.start();
    expect(() => r.run(500)).not.toThrow();
    expect(r.out.errors).toBeGreaterThan(0);
  });

  it('panic releases everything and sends All Notes Off on all channels', () => {
    const r = rig(proj((p) => (p.lines[0]!.heads.artic.series = 'A2')));
    r.sched.start();
    r.run(300);
    r.out.panic();
    const cc = r.sink.sent.filter((m) => (m.bytes[0]! & 0xf0) === 0xb0);
    expect(cc.filter((m) => m.bytes[1] === 123).length).toBe(16);
    expect(r.out.heldCount()).toBe(0);
    r.run(1000);
    r.sched.stop();
    expect(checkPairing(r.sink).ok).toBe(true);
  });
});
