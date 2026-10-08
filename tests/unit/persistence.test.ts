import { describe, expect, it } from 'vitest';
import { Engine, cloneProject, recallSnapshot, takeSnapshot } from '../../src/engine/engine';
import { DEMOS } from '../../src/demos/demos';
import { ProjectFormatError, deserialize, normalizeProject, serialize } from '../../src/persistence/project';
import { TakeRecorder, takeToMidi } from '../../src/persistence/takes';
import { rig } from './helpers';

describe('project format', () => {
  it('round-trips every demo exactly', () => {
    for (const d of DEMOS) {
      const p = d.build();
      expect(deserialize(serialize(p))).toEqual(p);
    }
  });

  it('a reloaded project performs identically (deterministic replay)', () => {
    for (const d of DEMOS) {
      const p = d.build();
      const a = new Engine(cloneProject(p)).generate(24 * 64);
      const b = new Engine(deserialize(serialize(p))).generate(24 * 64);
      expect(b.map((n) => [n.line, n.tick, n.pitch, n.velocity, n.duration])).toEqual(a.map((n) => [n.line, n.tick, n.pitch, n.velocity, n.duration]));
    }
  });

  it('rejects foreign and future files', () => {
    expect(() => deserialize('nope')).toThrow(ProjectFormatError);
    expect(() => deserialize('{"format":"other"}')).toThrow(/Not a Feelers/);
    expect(() => deserialize({ format: 'feelers.project', version: 99, project: {} })).toThrow(/newer/);
  });

  it('saves format version 2', () => {
    expect(JSON.parse(serialize(DEMOS[0]!.build()))).toMatchObject({ format: 'feelers.project', version: 2 });
  });

  it('repairs damaged data', () => {
    const p = normalizeProject({
      tempo: 9999,
      minTime: -5,
      pitchLimit: 900,
      columns: [
        { id: 'P1', kind: 'pitch', link: 'yes', els: [{ v: 300 }, 'bogus', { loop: 5000, rest: 'R', ar: 2 }, { v: 61, rest: 'X', ar: 9, end: true, skip: true }, ...Array.from({ length: 20 }, () => ({ v: 60 }))] },
        { id: 'X', kind: 'nonsense', els: [] },
        { id: 'P1', kind: 'pitch', els: [{ v: 1 }] },
      ],
      lines: [{ channel: 40, overlap: 'sometimes', heads: { pitch: { col: 'T1', start: 3 }, time: { col: 'P1' } }, timeScale: -3 }],
    });
    expect(p.tempo).toBe(400);
    expect(p.minTime).toBe(1);
    expect(p.pitchLimit).toBe(127);
    const p1 = p.columns.find((s) => s.id === 'P1')!;
    expect(p1.link).toBe(false);
    expect(p1.els.slice(0, 3)).toEqual([{ v: 127 }, { v: null, loop: 999 }, { v: 61, end: true, skip: true }]);
    expect(p1.els.length).toBeLessThanOrEqual(16);
    expect(p.columns.some((s) => s.id === 'X')).toBe(false);
    expect(p.columns.filter((s) => s.id === 'P1')).toHaveLength(1);
    expect(p.columns.filter((s) => s.kind === 'time').length).toBe(4);
    expect(p.lines).toHaveLength(4);
    expect(p.lines[0]!.channel).toBe(16);
    expect(p.lines[0]!.overlap).toBe('written');
    expect(p.lines[0]!.heads.pitch.col).toBe('P1');
    expect(p.lines[0]!.heads.time.col).toBe('T1');
    expect(p.lines[0]!.timeScale).toBeGreaterThan(0);
    expect(p.snapshots).toHaveLength(9);
  });
});

describe('snapshots', () => {
  it('store and recall a performance state', () => {
    const p = DEMOS[0]!.build();
    const e = new Engine(p);
    e.generate(100);
    e.setDirection(0, 'pitch', -1);
    p.lines[1]!.transpose = 5;
    const snap = takeSnapshot(e, 104);
    const expected = e.generate(300).filter((n) => n.line === 0).map((n) => n.pitch);
    // wander off, then recall
    const e2 = new Engine(cloneProject(DEMOS[0]!.build()));
    e2.generate(37);
    recallSnapshot(e2, JSON.parse(JSON.stringify(snap)), 37);
    expect(e2.cfg(1).transpose).toBe(5);
    expect(e2.lines[0]!.heads.pitch.dir).toBe(-1);
    // the snapshot stores the elements of the last note, so the recalled line replays it first
    const got = e2.generate(600).filter((n) => n.line === 0 && n.tick >= 37).map((n) => n.pitch);
    expect(got.slice(1, 6)).toEqual(expected.slice(0, 5));
  });
});

describe('takes', () => {
  it('records a performance and writes a valid Standard MIDI File', () => {
    const r = rig(DEMOS[0]!.build());
    const rec = new TakeRecorder(r.sched);
    r.sched.start();
    r.run(3000);
    r.sched.stop();
    expect(rec.takes).toHaveLength(1);
    const t = rec.takes[0]!;
    expect(t.notes.length).toBeGreaterThan(10);
    const bytes = takeToMidi(t);
    const ascii = (i: number) => String.fromCharCode(...bytes.slice(i, i + 4));
    expect(ascii(0)).toBe('MThd');
    expect(bytes[9]).toBe(1); // format 1
    expect(bytes[11]).toBe(5); // conductor + 4 lines
    // walk chunks
    let i = 14;
    let tracks = 0;
    while (i < bytes.length) {
      expect(ascii(i)).toBe('MTrk');
      const len = (bytes[i + 4]! << 24) | (bytes[i + 5]! << 16) | (bytes[i + 6]! << 8) | bytes[i + 7]!;
      i += 8 + len;
      tracks++;
    }
    expect(i).toBe(bytes.length);
    expect(tracks).toBe(5);
  });

  it('keeps only the last nine takes', () => {
    const r = rig(DEMOS[0]!.build());
    const rec = new TakeRecorder(r.sched);
    for (let k = 0; k < 12; k++) {
      r.sched.start();
      r.run(300);
      r.sched.stop();
    }
    expect(rec.takes).toHaveLength(9);
  });
});
