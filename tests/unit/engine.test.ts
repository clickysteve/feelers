import { describe, expect, it } from 'vitest';
import { Engine, cloneProject } from '../../src/engine/engine';
import { makeLine, makeProject, makeSeries } from '../../src/engine/factory';
import type { Project } from '../../src/engine/types';

function simple(): Project {
  return makeProject({
    series: [
      makeSeries('time', 1, '12 6 6'),
      makeSeries('time', 2, '24'),
      makeSeries('pitch', 1, 'C4 D4 E4 G4'),
      makeSeries('pitch', 2, 'C3 G3'),
      makeSeries('velocity', 1, '100 80'),
      makeSeries('artic', 1, '50'),
    ],
    lines: [
      makeLine(0, { time: 'T1', pitch: 'P1', velocity: 'V1', artic: 'A1' }),
      makeLine(1, { time: 'T2', pitch: 'P2', velocity: 'V1', artic: 'A1' }, { mute: false }),
      makeLine(2, {}, { mute: true }),
      makeLine(3, {}, { mute: true }),
    ],
  });
}

describe('engine note assembly', () => {
  it('assembles notes from independently traversed series', () => {
    const e = new Engine(simple());
    const notes = e.generate(48).filter((n) => n.line === 0);
    expect(notes.map((n) => n.tick)).toEqual([0, 12, 18, 24, 36, 42]);
    expect(notes.map((n) => n.pitch)).toEqual([60, 62, 64, 67, 60, 62]);
    expect(notes.map((n) => n.velocity)).toEqual([100, 80, 100, 80, 100, 80]);
    // time 3 long, pitch 4 long: combination repeats after 12 notes
    expect(notes.map((n) => n.duration)).toEqual([6, 3, 3, 6, 3, 3]);
  });

  it('combination period is the LCM of series lengths', () => {
    const e = new Engine(simple());
    const notes = e.generate(24 * 40).filter((n) => n.line === 0);
    const sig = notes.map((n) => `${n.pitch}/${n.velocity}/${n.time}`);
    // series lengths 3 (time), 4 (pitch), 2 (vel) -> LCM 12
    expect(sig.slice(0, 12)).toEqual(sig.slice(12, 24));
    expect(sig.slice(0, 6)).not.toEqual(sig.slice(6, 12));
  });

  it('lines run independently and in onset order', () => {
    const e = new Engine(simple());
    const notes = e.generate(48);
    const ticks = notes.map((n) => n.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
    expect(notes.filter((n) => n.line === 1).map((n) => n.tick)).toEqual([0, 24]);
    expect(notes.filter((n) => n.line === 1).map((n) => n.pitch)).toEqual([48, 55]);
  });

  it('muted lines keep moving silently', () => {
    const e = new Engine(simple());
    const n2 = e.generate(48).filter((n) => n.line === 2);
    expect(n2.length).toBeGreaterThan(0);
    expect(n2.every((n) => n.silent && n.muted)).toBe(true);
  });

  it('generate is incremental: chunked equals one-shot', () => {
    const a = new Engine(simple());
    const b = new Engine(simple());
    const one = a.generate(500);
    const chunked = [];
    for (let t = 7; t <= 500; t += 7) chunked.push(...b.generate(t));
    chunked.push(...b.generate(500));
    expect(chunked.map((n) => [n.line, n.tick, n.pitch])).toEqual(one.map((n) => [n.line, n.tick, n.pitch]));
  });

  it('transposition, velocity offset and pitch folding', () => {
    const p = simple();
    p.lines[0]!.transpose = 7;
    p.lines[0]!.velOffset = -30;
    const e = new Engine(p);
    const n = e.generate(1).find((x) => x.line === 0)!;
    expect(n.pitch).toBe(67);
    expect(n.velocity).toBe(70);
    p.lines[0]!.transpose = 80; // 60 + 80 = 140 -> folds down by octaves
    const e2 = new Engine(p);
    expect(e2.generate(1).find((x) => x.line === 0)!.pitch).toBe(128 - 12 + 0);
  });

  it('time adjust scales a line and makes it drift against others', () => {
    const p = simple();
    p.lines[1]!.timeScale = 1.5;
    const e = new Engine(p);
    expect(e.generate(100).filter((n) => n.line === 1).map((n) => n.tick)).toEqual([0, 36, 72]);
  });

  it('delay holds back a line on start', () => {
    const p = simple();
    p.lines[1]!.delay = 6;
    const e = new Engine(p);
    expect(e.generate(40).filter((n) => n.line === 1).map((n) => n.tick)).toEqual([6, 30]);
  });

  it('articulation sets duration as a percentage of time (legato over 100)', () => {
    const p = simple();
    p.series.find((s) => s.id === 'A1')!.cells = [{ t: 'v', v: 150 }];
    const e = new Engine(p);
    const n = e.generate(1).find((x) => x.line === 1)!;
    expect(n.duration).toBe(36);
  });
});

describe('engine interventions', () => {
  it('reversing a head mid-stream turns around at the current cell', () => {
    const e = new Engine(simple());
    e.generate(13); // line 0 has played C4 (t0) and D4 (t12)
    e.setDirection(0, 'pitch', -1);
    const next = e.generate(48).filter((n) => n.line === 0).map((n) => n.pitch);
    expect(next.slice(0, 4)).toEqual([60, 67, 64, 62]);
  });

  it('reverseLine flips all four heads', () => {
    const e = new Engine(simple());
    e.reverseLine(0);
    for (const k of ['time', 'pitch', 'velocity', 'artic'] as const) expect(e.lines[0]!.heads[k].dir).toBe(-1);
  });

  it('pause preserves remaining wait; resume continues', () => {
    const e = new Engine(simple());
    e.generate(13); // line 0: next onset at 18
    e.setPaused(0, true, 15);
    expect(e.generate(100).filter((n) => n.line === 0)).toEqual([]);
    e.setPaused(0, false, 100);
    const after = e.generate(130).filter((n) => n.line === 0);
    expect(after[0]!.tick).toBe(103);
    expect(after[0]!.pitch).toBe(64);
  });

  it('nextNow plays the next note immediately', () => {
    const p = simple();
    p.series.find((s) => s.id === 'T2')!.cells = [{ t: 'v', v: 999 }];
    const e = new Engine(p);
    e.generate(10);
    e.nextNow(1, 10);
    expect(e.generate(11).filter((n) => n.line === 1).map((n) => n.tick)).toEqual([10]);
  });

  it('resetLine returns one line to its start', () => {
    const e = new Engine(simple());
    e.generate(40);
    e.resetLine(0, 40);
    const n = e.generate(41).filter((x) => x.line === 0);
    expect(n.map((x) => [x.tick, x.pitch])).toEqual([[40, 60]]);
  });

  it('nudge advances or delays a running line', () => {
    const e = new Engine(simple());
    e.generate(1); // line 1 next at 24
    e.nudge(1, 6, 1);
    expect(e.lines[1]!.nextTick).toBe(30);
    e.nudge(1, -100, 1);
    expect(e.lines[1]!.nextTick).toBe(1);
  });

  it('step plays one note from a paused line', () => {
    const e = new Engine(simple());
    e.setPaused(0, true, 0);
    const a = e.step(0, 5)!;
    const b = e.step(0, 9)!;
    expect([a.pitch, b.pitch]).toEqual([60, 62]);
    expect(e.lines[0]!.paused).toBe(true);
  });

  it('editing values while running affects the next read', () => {
    const e = new Engine(simple());
    e.generate(1); // C4 read at index 0
    e.setValue('P1', 1, 70);
    expect(e.generate(13).filter((n) => n.line === 0).map((n) => n.pitch)).toEqual([70]);
  });

  it('shift-edit keeps a time series total', () => {
    const e = new Engine(simple());
    e.setValue('T1', 0, 8, true);
    const cells = e.series('T1')!.cells.map((c) => (c.t === 'v' ? c.v : 0));
    expect(cells).toEqual([8, 10, 6]);
  });

  it('reassigning a head to another series', () => {
    const e = new Engine(simple());
    e.setHeadSeries(0, 'pitch', 'P2');
    expect(e.generate(1).filter((n) => n.line === 0).map((n) => n.pitch)).toEqual([48]);
    e.setHeadSeries(0, 'pitch', 'T1'); // wrong kind: ignored
    expect(e.lines[0]!.heads.pitch.series).toBe('P2');
  });
});

describe('determinism', () => {
  it('same project and seed replay identically, including randomisation', () => {
    const p = simple();
    const s = p.series.find((x) => x.id === 'P1')!;
    s.cells = s.cells.map((c) => (c.t === 'v' ? { ...c, r: 2 as const } : c));
    s.rand = { amount: 2, type: 0, prob: 60 };
    const a = new Engine(cloneProject(p)).generate(2000);
    const b = new Engine(cloneProject(p)).generate(2000);
    expect(a.map((n) => [n.tick, n.pitch, n.velocity])).toEqual(b.map((n) => [n.tick, n.pitch, n.velocity]));
    const c = cloneProject(p);
    c.seed = 7;
    const d = new Engine(c).generate(2000);
    expect(d.map((n) => n.pitch)).not.toEqual(a.map((n) => n.pitch));
  });

  it('reset reseeds and restores start positions', () => {
    const p = simple();
    p.series.find((x) => x.id === 'P1')!.cells[0] = { t: 'v', v: 60, r: 1 };
    const e = new Engine(p);
    const first = e.generate(500).map((n) => n.pitch);
    e.reset();
    expect(e.generate(500).map((n) => n.pitch)).toEqual(first);
  });
});
