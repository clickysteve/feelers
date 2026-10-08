/**
 * Migration of Feelers format v1 projects to v2.
 *
 * tests/fixtures/v1-golden.json holds v1 project files (the v1 demos and two
 * synthetic projects covering every v1 control element) together with the
 * notes the v1 engine produced for them, recorded from the last v1 release.
 * A migrated project must play the same notes, except where the report says
 * the historical model now differs (LINK).
 */
import { describe, expect, it } from 'vitest';
import golden from '../fixtures/v1-golden.json';
import { Engine } from '../../src/engine/engine';
import { ProjectFormatError, deserialize, load, serialize } from '../../src/persistence/project';
import { articToSL } from '../../src/persistence/migrate';

type Golden = Record<string, { file: { version: number; project: Record<string, unknown> }; notes: number[][] }>;
const G = golden as unknown as Golden;
const play = (id: string) => {
  const r = load(G[id]!.file);
  const notes = new Engine(r.project).generate(24 * 32);
  return { r, notes };
};

describe('v1 to v2: the music is kept', () => {
  for (const id of ['first-contact', 'phase-garden', 'drift', 'lanes', 'controls', 'reversed', 'clockwork']) {
    it(`${id}: same onsets, pitches and velocities as v1`, () => {
      expect(G[id]!.file.version).toBe(1);
      const { r, notes } = play(id);
      const want = G[id]!.notes;
      const lines = id === 'clockwork' ? [0, 1] : [0, 1, 2, 3]; // clockwork line 3 reads a LINK
      const pick = (xs: number[][]) => xs.filter((n) => lines.includes(n[0]!));
      const got = notes.map((n) => [n.line, n.tick, n.silent ? -1 : n.pitch, n.silent ? 0 : n.velocity, n.duration, n.time]);
      const a = pick(got);
      const b = pick(want);
      expect(a.map((n) => n.slice(0, 4))).toEqual(b.map((n) => n.slice(0, 4)));
      // Lengths: articulation percent becomes whole sixteenths, so within 1/32 of the gap
      // (not for drift, whose S/L values are themselves randomised).
      if (id !== 'drift') a.forEach((n, i) => expect(Math.abs(n[4]! - b[i]![4]!)).toBeLessThanOrEqual(n[5]! / 32 + 1e-9));
      expect(r.from).toBe(1);
    });
  }

  it('LINK becomes Column Link: the linked columns form one series (reported)', () => {
    const { r, notes } = play('links');
    const v1 = G.links!.notes.filter((n) => n[0] === 0).map((n) => n[2]);
    const v2 = notes.filter((n) => n.line === 0).map((n) => n.pitch);
    expect(v1.slice(0, 8)).toEqual([60, 62, 64, 65, 67, 64, 65, 67]);
    expect(v2.slice(0, 8)).toEqual([60, 62, 64, 65, 67, 60, 62, 64]);
    expect(r.migration.join(' ')).toMatch(/Column Link/);
    expect(r.project.notes).toMatch(/Converted from Feelers format 1/);
  });
});

describe('v1 to v2: structure', () => {
  const controls = () => load(G.controls!.file).project;

  it('SKIP marks the value it jumped; the value is kept', () => {
    expect(controls().columns.find((c) => c.id === 'P1')!.els).toEqual([{ v: 60 }, { v: 62, skip: true }, { v: 64 }, { v: 65 }]);
  });

  it('a loop that starts its series becomes a Loop element; others are written out', () => {
    const p = controls();
    expect(p.columns.find((c) => c.id === 'P2')!.els).toEqual([{ v: 48 }, { v: 50 }, { v: null, loop: 2 }, { v: 52 }]);
    expect(p.columns.find((c) => c.id === 'P3')!.els.map((e) => e.v)).toEqual([72, 74, 76, 74, 76, 77]);
    expect(p.columns.find((c) => c.id === 'V1')!.els.map((e) => e.v)).toEqual([100, 80, 60, 60, 80, 60, 60, 90]);
  });

  it('END marks the last active element; dormant cells remain as a series below it', () => {
    expect(controls().columns.find((c) => c.id === 'T2')!.els).toEqual([{ v: 12 }, { v: 12, end: true }, { v: 6 }, { v: 6 }]);
  });

  it('REST: a blank rest element in Pitch/Velocity/S/L; a rest on the preceding Time element', () => {
    const p = controls();
    expect(p.columns.find((c) => c.id === 'V2')!.els).toEqual([{ v: 70 }, { v: null, rest: 'r' }, { v: 90 }]);
    // v1 "6 _ 12 6": the note whose gap was 12 was silent; in v2 its Time value (6) carries the rest.
    expect(p.columns.find((c) => c.id === 'T1')!.els).toEqual([{ v: 6, rest: 'r' }, { v: 12 }, { v: 6 }]);
  });

  it('Time heads start one element earlier; articulation becomes S/L; legato becomes overlap', () => {
    const p = controls();
    expect(p.lines[0]!.heads.time).toEqual({ col: 'T1', start: 2, startDir: 1 });
    expect(p.lines[0]!.heads.artic.col).toBe('S1');
    expect(p.columns.find((c) => c.id === 'S1')!.els.map((e) => e.v)).toEqual([8, 13, 5]);
    expect(p.lines[1]!.overlap).toBe('legato');
    expect(p.lines[0]!.overlap).toBe('mono');
    expect(p.lines.every((l) => l.scale.mode === 'global')).toBe(true);
    expect(p.scale.on).toBe(false);
    expect([articToSL(1), articToSL(50), articToSL(100), articToSL(400)]).toEqual([1, 8, 16, 64]);
  });

  it('randomisation: DRIFT becomes ?, WOBBLE stays WOBBLE, per-series settings become per-column', () => {
    const p = load(G.drift!.file).project;
    const p1 = p.columns.find((c) => c.id === 'P1')!;
    expect(p1.els.every((e) => e.ar === 1)).toBe(true);
    expect(p1.rand).toMatchObject({ type: 1, amount: 5, p1: 35, lo: 52, hi: 81 });
    const p2 = p.columns.find((c) => c.id === 'P2')!;
    expect(p2.els.every((e) => e.ar === 3)).toBe(true);
    expect(p2.rand!.pw).toBe(40);
    // Gaussian v1 amounts were standard deviations; v2 amounts are average changes.
    expect(p.columns.find((c) => c.id === 'V1')!.rand!.amount).toBeCloseTo(6 / 1.2533, 2);
    expect(p.pitchLimit).toBe(127);
  });

  it('series longer than 16 elements continue in an added, linked column', () => {
    const values = Array.from({ length: 21 }, (_, i) => ({ t: 'v', v: 40 + i }));
    const file = {
      format: 'feelers.project',
      version: 1,
      project: { series: [{ id: 'P1', kind: 'pitch', cells: values, rand: { amount: 2, type: 0, prob: 50 }, lo: 0, hi: 127 }], lines: [{ heads: { pitch: { series: 'P1', start: 18 } } }] },
    };
    const r = load(file);
    const ids = r.project.columns.filter((c) => c.kind === 'pitch').map((c) => c.id);
    expect(ids.slice(0, 3)).toEqual(['P1', 'P1a', 'P2']);
    expect(r.project.columns.find((c) => c.id === 'P1')!.link).toBe(true);
    expect(r.project.columns.find((c) => c.id === 'P1a')!.els).toHaveLength(5);
    expect(r.project.lines[0]!.heads.pitch).toMatchObject({ col: 'P1a', start: 2 });
    const pitches = new Engine(r.project).generate(24 * 30).filter((n) => n.line === 0).map((n) => n.pitch);
    expect(pitches.slice(0, 6)).toEqual([58, 59, 60, 40, 41, 42]);
  });

  it('snapshots move with the conversion', () => {
    const file = JSON.parse(JSON.stringify(G.controls!.file));
    const lines = (file.project.lines as { heads: Record<string, { series: string }> }[]).map((l) => ({
      heads: Object.fromEntries(Object.entries(l.heads).map(([k, h]) => [k, { series: h.series, pos: 2, dir: -1 }])),
      paused: false,
      mute: false,
      transpose: 0,
      velOffset: 0,
      timeScale: 1,
    }));
    file.project.snapshots = [{ tempo: 90, lines }];
    const p = load(file).project;
    const s = p.snapshots[0]!;
    // v1 cell 2 of "C4 > D4 E4 F4" is D4; the SKIP cell is gone, so D4 is element 1.
    expect(s.lines[0]!.heads.pitch).toEqual({ col: 'P1', pos: 1, dir: -1 });
    // A Time head moving backwards: one element "earlier" is the next one forward.
    expect(s.lines[0]!.heads.time.col).toBe('T1');
    expect(s.lines[0]!.heads.time.pos).toBe(2);
  });

  it('repairs damaged v1 data', () => {
    const p = deserialize({
      format: 'feelers.project',
      version: 1,
      project: {
        tempo: 9999,
        series: [
          { id: 'P1', kind: 'pitch', cells: [{ t: 'v', v: 300 }, { t: 'bogus' }, { t: 'open' }, { t: 'v', v: 61 }, { t: 'close', n: 5000 }], lo: 90, hi: 10 },
          { id: 'X', kind: 'nonsense', cells: [] },
        ],
        lines: [{ channel: 40, heads: { pitch: { series: 'T1' }, time: { series: 'P1' } }, timeScale: -3 }],
      },
    });
    expect(p.tempo).toBe(400);
    expect(p.columns.some((c) => c.id === 'X')).toBe(false);
    expect(p.columns.filter((c) => c.kind === 'time')).toHaveLength(4);
    expect(p.lines[0]!.channel).toBe(16);
    expect(p.lines[0]!.heads.pitch.col).toBe('P1');
    expect(p.lines[0]!.heads.time.col).toBe('T1');
    expect(p.lines[0]!.timeScale).toBeGreaterThan(0);
  });

  it('a migrated project saves as v2 and reloads identically', () => {
    const p = load(G.controls!.file).project;
    const text = serialize(p);
    expect(JSON.parse(text).version).toBe(2);
    const again = load(text);
    expect(again.project).toEqual(p);
    expect(again.migration).toEqual([]);
  });

  it('refuses files from the future', () => {
    expect(() => deserialize({ format: 'feelers.project', version: 3, project: {} })).toThrow(ProjectFormatError);
  });
});
