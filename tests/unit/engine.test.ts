import { describe, expect, it } from 'vitest';
import { Engine, cloneProject } from '../../src/engine/engine';
import { makeColumn, makeLine, makeProject } from '../../src/engine/factory';
import type { Project } from '../../src/engine/types';

function simple(): Project {
  return makeProject({
    columns: [
      makeColumn('time', 1, '12 6 6'),
      makeColumn('time', 2, '24'),
      makeColumn('pitch', 1, 'C4 D4 E4 G4'),
      makeColumn('pitch', 2, 'C3 G3'),
      makeColumn('velocity', 1, '100 80'),
      makeColumn('artic', 1, '8'),
    ],
    lines: [
      makeLine(0, { time: 'T1', pitch: 'P1', velocity: 'V1', artic: 'S1' }),
      makeLine(1, { time: 'T2', pitch: 'P2', velocity: 'V1', artic: 'S1' }),
      makeLine(2, {}, { mute: true }),
      makeLine(3, {}, { mute: true }),
    ],
  });
}

const line0 = (e: Engine, until: number) => e.generate(until).filter((n) => n.line === 0);

describe('note assembly: Time is the wait before the note (FM ch. 1, ch. 6)', () => {
  it('each note waits its own Time value; the first Time value is consumed at Start (CHOICE)', () => {
    const e = new Engine(simple());
    const notes = line0(e, 48);
    // Time 12 6 6: note 1 at Start (its 12 is not waited), note 2 waits 6, note 3 waits 6, note 4 waits 12...
    expect(notes.map((n) => n.tick)).toEqual([0, 6, 12, 24, 30, 36]);
    expect(notes.map((n) => n.reads.time.value)).toEqual([12, 6, 6, 12, 6, 6]);
    expect(notes.map((n) => n.pitch)).toEqual([60, 62, 64, 67, 60, 62]);
    expect(notes.map((n) => n.velocity)).toEqual([100, 80, 100, 80, 100, 80]);
  });

  it('with the alternative reading the first note also waits its Time value', () => {
    const e = new Engine(simple(), { firstNoteWaits: true });
    expect(line0(e, 48).map((n) => n.tick)).toEqual([12, 18, 24, 36, 42]);
  });

  it('a note’s length is the next Time value x S/L / 16', () => {
    const e = new Engine(simple());
    const notes = line0(e, 48);
    // S/L 8: half of the following Time value.
    expect(notes.map((n) => n.time)).toEqual([6, 6, 12, 6, 6, 12]);
    expect(notes.map((n) => n.duration)).toEqual([3, 3, 6, 3, 3, 6]);
    expect(notes.map((n) => n.nextTime.value)).toEqual([6, 6, 12, 6, 6, 12]);
  });

  it('a crotchet-quaver rhythm: the first note lasts a quaver (Music Technology, 1988)', () => {
    const p = simple();
    p.columns.find((c) => c.id === 'T1')!.els = makeColumn('time', 1, '24 12 24 12').els;
    const notes = line0(new Engine(p), 100);
    expect(notes[1]!.tick - notes[0]!.tick).toBe(12);
  });

  it('S/L 1 is staccato, 15 ends just before the next note, 16 touches it, over 16 overlaps', () => {
    for (const [sl, dur] of [[1, 1.5], [15, 22.5], [16, 24], [24, 36]] as const) {
      const p = simple();
      p.columns.find((c) => c.id === 'S1')!.els = [{ v: sl }];
      const n = new Engine(p).generate(1).find((x) => x.line === 1)!;
      expect(n.duration).toBe(dur);
    }
  });

  it('time adjust scales the waits and the lengths', () => {
    const p = simple();
    p.lines[1]!.timeScale = 1.5;
    const notes = new Engine(p).generate(100).filter((n) => n.line === 1);
    expect(notes.map((n) => n.tick)).toEqual([0, 36, 72]);
    expect(notes[0]!.duration).toBe(18);
  });

  it('combination period is the LCM of series lengths', () => {
    const e = new Engine(simple());
    const sig = line0(e, 24 * 40).map((n) => `${n.pitch}/${n.velocity}/${n.time}`);
    expect(sig.slice(0, 12)).toEqual(sig.slice(12, 24));
    expect(sig.slice(0, 6)).not.toEqual(sig.slice(6, 12));
  });

  it('lines run independently and in onset order', () => {
    const notes = new Engine(simple()).generate(48);
    const ticks = notes.map((n) => n.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
    expect(notes.filter((n) => n.line === 1).map((n) => [n.tick, n.pitch])).toEqual([[0, 48], [24, 55]]);
  });

  it('muted lines keep moving silently', () => {
    const n2 = new Engine(simple()).generate(48).filter((n) => n.line === 2);
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
    const n = new Engine(p).generate(1).find((x) => x.line === 0)!;
    expect(n.pitch).toBe(67);
    expect(n.velocity).toBe(70);
    p.lines[0]!.transpose = 80;
    expect(new Engine(p).generate(1).find((x) => x.line === 0)!.pitch).toBe(128 - 12);
  });

  it('delay holds back a line on start', () => {
    const p = simple();
    p.lines[1]!.delay = 6;
    expect(new Engine(p).generate(40).filter((n) => n.line === 1).map((n) => n.tick)).toEqual([6, 30]);
  });
});

describe('Rest and rest (FM ch. 3)', () => {
  function restProject(pitch: string, time = '12'): Project {
    return makeProject({
      columns: [makeColumn('time', 1, time), makeColumn('pitch', 1, pitch), makeColumn('velocity', 1, '1 2 3 4 5 6 7'), makeColumn('artic', 1, '8')],
      lines: [makeLine(0, {}), makeLine(1, {}, { mute: true }), makeLine(2, {}, { mute: true }), makeLine(3, {}, { mute: true })],
    });
  }
  const run = (p: Project, n = 5) => line0(new Engine(p), 12 * n).map((x) => (x.silent ? `-${x.reads.pitch.value ?? '·'}` : `${x.pitch}:${x.velocity}`));

  it('Rest: only the Time head and the head that read it advance', () => {
    // Velocity is held while pitch reads the Rest, so it continues where it was.
    expect(run(restProject('60 62R 64'))).toEqual(['60:1', '-62', '64:2', '60:3', '-62']);
  });

  it('rest: every head advances', () => {
    expect(run(restProject('60 62r 64'))).toEqual(['60:1', '-62', '64:3', '60:4', '-62']);
  });

  it('a Rest on a Time element holds the other heads', () => {
    const notes = line0(new Engine(restProject('60 62 64', '12 12R 12')), 12 * 5);
    expect(notes.map((n) => (n.silent ? '-' : `${n.pitch}:${n.velocity}`))).toEqual(['60:1', '-', '62:2', '64:3', '-']);
    expect(notes[1]!.reads.pitch.held).toBe(true);
  });

  it('Rest and rest on the same note: every head advances', () => {
    const p = restProject('60 62R 64');
    p.columns.find((c) => c.id === 'V1')!.els = makeColumn('velocity', 1, '1 2r 3 4').els;
    expect(run(p, 3)).toEqual(['60:1', '-62', '64:3']);
  });

  it('a rest still takes its Time value', () => {
    const notes = line0(new Engine(restProject('60 62r 64', '12 6 18')), 60);
    expect(notes.map((n) => n.tick)).toEqual([0, 6, 24, 36, 42]);
    expect(notes[1]!.silent).toBe(true);
  });
});

describe('engine interventions', () => {
  it('reversing a head turns around at the element just read (CHOICE)', () => {
    const e = new Engine(simple());
    e.generate(7); // line 0 has played C4 (t0) and D4 (t6)
    e.setDirection(0, 'pitch', -1);
    expect(line0(e, 48).map((n) => n.pitch).slice(0, 4)).toEqual([60, 67, 64, 62]);
  });

  it('reverseLine flips all four heads', () => {
    const e = new Engine(simple());
    e.reverseLine(0);
    for (const k of ['time', 'pitch', 'velocity', 'artic'] as const) expect(e.lines[0]!.heads[k].dir).toBe(-1);
  });

  it('pause preserves the remaining wait; resume continues', () => {
    const e = new Engine(simple());
    e.generate(7); // line 0: next onset at 12
    e.setPaused(0, true, 9);
    expect(line0(e, 100)).toEqual([]);
    e.setPaused(0, false, 100);
    const after = line0(e, 130);
    expect(after[0]!.tick).toBe(103);
    expect(after[0]!.pitch).toBe(64);
  });

  it('nextNow plays the next note immediately', () => {
    const p = simple();
    p.columns.find((c) => c.id === 'T2')!.els = [{ v: 999 }];
    const e = new Engine(p);
    e.generate(10);
    e.nextNow(1, 10);
    expect(e.generate(11).filter((n) => n.line === 1).map((n) => n.tick)).toEqual([10]);
  });

  it('resetLine returns one line to its start', () => {
    const e = new Engine(simple());
    e.generate(40);
    e.resetLine(0, 40);
    expect(line0(e, 41).map((x) => [x.tick, x.pitch])).toEqual([[40, 60]]);
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
    e.generate(1); // C4 read
    e.setValue({ col: 'P1', i: 1 }, 70);
    expect(line0(e, 7).map((n) => n.pitch)).toEqual([70]);
  });

  it('shift-edit keeps a time series total', () => {
    const e = new Engine(simple());
    e.setValue({ col: 'T1', i: 0 }, 8, true);
    expect(e.column('T1')!.els.map((x) => x.v)).toEqual([8, 10, 6]);
  });

  it('reassigning a head to another column', () => {
    const e = new Engine(simple());
    e.setHeadColumn(0, 'pitch', 'P2');
    expect(line0(e, 1).map((n) => n.pitch)).toEqual([48]);
    e.setHeadColumn(0, 'pitch', 'T1'); // wrong kind: ignored
    expect(e.lines[0]!.heads.pitch.pos.col).toBe('P2');
  });

  it('heads survive elements deleted under them', () => {
    const e = new Engine(simple());
    e.setHeadPos(0, 'pitch', 3);
    e.column('P1')!.els.splice(1, 3);
    expect(line0(e, 1).map((n) => n.pitch)).toEqual([60]);
  });
});

describe('Restore Last Start (FM ch. 5)', () => {
  function randomised(): Project {
    const p = simple();
    p.columns.find((c) => c.id === 'P1')!.els = makeColumn('pitch', 1, 'C4? D4? E4? G4?').els;
    p.random.pitch = { amount: 3, type: 1, p1: 100, p2: 0, pw: 0 };
    return p;
  }

  it('returns series values changed by auto-randomisation and edits; a second press undoes it', () => {
    const e = new Engine(randomised());
    e.captureStart();
    e.generate(24 * 8);
    e.cfg(0).transpose = 5;
    const drifted = e.column('P1')!.els.map((x) => x.v);
    expect(drifted).not.toEqual([60, 62, 64, 67]);
    expect(e.toggleRestore()).toBe('restored');
    expect(e.column('P1')!.els.map((x) => x.v)).toEqual([60, 62, 64, 67]);
    expect(e.cfg(0).transpose).toBe(0);
    expect(e.toggleRestore()).toBe('undone');
    expect(e.column('P1')!.els.map((x) => x.v)).toEqual(drifted);
    expect(e.cfg(0).transpose).toBe(5);
  });

  it('does nothing before the first Start', () => {
    expect(new Engine(simple()).toggleRestore()).toBeNull();
  });
});

describe('determinism', () => {
  it('same project and seed replay identically, including randomisation', () => {
    const p = simple();
    p.columns.find((c) => c.id === 'P1')!.els = makeColumn('pitch', 1, 'C4? D4~ E4?? G4').els;
    p.random.pitch = { amount: 2, type: 0, p1: 60, p2: 30, pw: 60 };
    const a = new Engine(cloneProject(p)).generate(2000);
    const b = new Engine(cloneProject(p)).generate(2000);
    expect(a.map((n) => [n.tick, n.pitch, n.velocity])).toEqual(b.map((n) => [n.tick, n.pitch, n.velocity]));
    const c = cloneProject(p);
    c.seed = 7;
    expect(new Engine(c).generate(2000).map((n) => n.pitch)).not.toEqual(a.map((n) => n.pitch));
  });

  it('reset reseeds and restores start positions (WOBBLE leaves the material unchanged)', () => {
    const p = simple();
    p.columns.find((c) => c.id === 'P1')!.els[0] = { v: 60, ar: 3 };
    const e = new Engine(p);
    const first = e.generate(500).map((n) => n.pitch);
    e.reset();
    expect(e.generate(500).map((n) => n.pitch)).toEqual(first);
  });
});
