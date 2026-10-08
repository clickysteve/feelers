/**
 * Scale Mode: a modern Feelers facility. Deterministic, non-destructive,
 * applied after line transposition, and always visible in the note events.
 */
import { describe, expect, it } from 'vitest';
import { Engine, cloneProject } from '../../src/engine/engine';
import { makeColumn, makeLine, makeProject } from '../../src/engine/factory';
import { QUANT_DIRS, ROOT_NAMES, SCALES, constrain, effectiveScale, quantize, scaleLabel, scaleMask } from '../../src/engine/scale';
import type { Project, QuantDir, ScaleSpec } from '../../src/engine/types';
import { deserialize, serialize } from '../../src/persistence/project';
import { CLOCK, START } from '../../src/midi/messages';
import { checkPairing, rig } from './helpers';

/** Brute-force reference. */
function reference(p: number, spec: ScaleSpec): number {
  const mask = scaleMask(spec);
  const inScale = (n: number) => n >= 0 && n <= 127 && mask[n % 12];
  const cands = Array.from({ length: 128 }, (_, n) => n).filter(inScale);
  if (inScale(p)) return p;
  const down = cands.filter((n) => n < p).at(-1);
  const up = cands.find((n) => n > p);
  if (spec.dir === 'down') return down ?? up!;
  if (spec.dir === 'up') return up ?? down!;
  if (down === undefined) return up!;
  if (up === undefined) return down;
  return up - p <= p - down ? up : down;
}

describe('quantize', () => {
  it('chromatic is the identity for every pitch, root and direction', () => {
    for (let root = 0; root < 12; root++)
      for (const dir of QUANT_DIRS) for (let p = 0; p <= 127; p++) expect(quantize(p, { root, scale: 'chromatic', dir })).toBe(p);
  });

  it('every scale, every root, every direction, every pitch matches the reference', () => {
    let checked = 0;
    for (const s of SCALES)
      for (let root = 0; root < 12; root++)
        for (const dir of QUANT_DIRS) {
          const spec = { root, scale: s.id, dir };
          const mask = scaleMask(spec);
          const got = Array.from({ length: 128 }, (_, p) => quantize(p, spec));
          const want = Array.from({ length: 128 }, (_, p) => reference(p, spec));
          expect(got).toEqual(want);
          expect(got.every((q) => q >= 0 && q <= 127 && mask[q % 12])).toBe(true);
          checked += got.length;
        }
    expect(checked).toBe(SCALES.length * 12 * 3 * 128);
  });

  it('notes already in the scale are never moved', () => {
    for (const s of SCALES)
      for (let root = 0; root < 12; root++)
        for (const step of s.steps) for (let oct = 0; oct < 10; oct++) {
          const p = oct * 12 + root + step;
          if (p > 127) continue;
          for (const dir of QUANT_DIRS) expect(quantize(p, { root, scale: s.id, dir })).toBe(p);
        }
  });

  it('DOWN never rises and UP never falls (away from the range edges)', () => {
    for (const s of SCALES)
      for (let root = 0; root < 12; root++)
        for (let p = 12; p <= 115; p++) {
          const dn = quantize(p, { root, scale: s.id, dir: 'down' });
          const up = quantize(p, { root, scale: s.id, dir: 'up' });
          if (dn > p || up < p) expect({ s: s.id, root, p, dn, up }).toBeNull();
        }
  });

  it('NEAREST ties go up: C#4 in C major plays D4 (+1)', () => {
    const cMaj: ScaleSpec = { root: 0, scale: 'major', dir: 'nearest' };
    expect(constrain(61, cMaj)).toEqual({ pitch: 62, delta: 1 });
    // F#4 lies between F4 and G4: up.
    expect(quantize(66, cMaj)).toBe(67);
    // Not a tie: C#4 in C minor pentatonic (C Eb F G Bb): C is 1 away, Eb 2 -> down.
    expect(quantize(61, { root: 0, scale: 'minor-pent', dir: 'nearest' })).toBe(60);
  });

  it('crosses octave boundaries correctly', () => {
    // B in C major pentatonic (C D E G A): A below is 2 away, C above is 1 away.
    expect(quantize(71, { root: 0, scale: 'major-pent', dir: 'nearest' })).toBe(72);
    expect(quantize(71, { root: 0, scale: 'major-pent', dir: 'down' })).toBe(69);
    expect(quantize(70, { root: 0, scale: 'major-pent', dir: 'up' })).toBe(72);
    // C in D major (C# is the leading note) goes down to B or up to C#: tie -> up.
    expect(quantize(60, { root: 2, scale: 'major', dir: 'nearest' })).toBe(61);
    expect(quantize(60, { root: 2, scale: 'major', dir: 'down' })).toBe(59);
  });

  it('stays inside MIDI range at the edges', () => {
    // 127 is G9. In C# major, G is out; UP has nowhere to go, so it falls back down.
    expect(quantize(127, { root: 1, scale: 'major', dir: 'up' })).toBe(126);
    // 0 is C, not in D major; nothing lies below, so DOWN falls back up to C#.
    expect(quantize(0, { root: 2, scale: 'major', dir: 'down' })).toBe(1);
    expect(quantize(0, { root: 11, scale: 'whole-tone', dir: 'nearest' })).toBe(1);
  });

  it('offers the expected scales', () => {
    const names = SCALES.map((s) => s.name);
    for (const n of ['Chromatic', 'Major', 'Natural Minor', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Locrian', 'Major Pentatonic', 'Minor Pentatonic', 'Whole Tone', 'Diminished (whole-half)', 'Diminished (half-whole)'])
      expect(names).toContain(n);
    for (const s of SCALES) {
      expect(s.steps[0]).toBe(0);
      expect([...s.steps].sort((a, b) => a - b)).toEqual(s.steps);
      expect(new Set(s.steps).size).toBe(s.steps.length);
    }
    expect(SCALES.find((s) => s.id === 'dim-wh')!.steps).toHaveLength(8);
    expect(scaleLabel({ root: 2, scale: 'dorian', dir: 'up' })).toBe('D Dorian ↑');
    expect(ROOT_NAMES).toHaveLength(12);
  });
});

describe('inheritance', () => {
  const g = (on: boolean) => ({ on, root: 2, scale: 'dorian', dir: 'nearest' as QuantDir });
  it('a line follows the global scale only while Scale Mode is on', () => {
    expect(effectiveScale(g(true), { scale: { mode: 'global', root: 0, scale: 'major', dir: 'up' } })).toEqual({ root: 2, scale: 'dorian', dir: 'nearest' });
    expect(effectiveScale(g(false), { scale: { mode: 'global', root: 0, scale: 'major', dir: 'up' } })).toBeNull();
  });
  it('a line can use its own scale (whether or not the global one is on), or none', () => {
    const own = { scale: { mode: 'own' as const, root: 9, scale: 'minor', dir: 'down' as QuantDir } };
    expect(effectiveScale(g(true), own)).toEqual({ root: 9, scale: 'minor', dir: 'down' });
    expect(effectiveScale(g(false), own)).toEqual({ root: 9, scale: 'minor', dir: 'down' });
    expect(effectiveScale(g(true), { scale: { mode: 'off', root: 0, scale: 'major', dir: 'up' } })).toBeNull();
  });
});

function scaleProject(): Project {
  const p = makeProject({
    tempo: 120,
    columns: [makeColumn('time', 1, '12'), makeColumn('pitch', 1, 'C4 C#4 D#4 F#4'), makeColumn('velocity', 1, '100'), makeColumn('artic', 1, '8')],
    lines: [0, 1, 2, 3].map((i) => makeLine(i, {}, { mute: i > 1 })),
  });
  p.options.programOnStart = false;
  return p;
}

const pitches = (p: Project, line = 0, until = 48) => new Engine(p).generate(until).filter((n) => n.line === line);

describe('Scale Mode in the engine', () => {
  it('OFF: pitches are exactly the unquantised ones', () => {
    const notes = pitches(scaleProject());
    expect(notes.map((n) => n.pitch)).toEqual([60, 61, 63, 66]);
    expect(notes.every((n) => n.scaleDelta === 0 && n.prePitch === n.pitch)).toBe(true);
  });

  it('ON: emitted pitches are constrained; the source pitch is kept alongside', () => {
    const p = scaleProject();
    p.scale = { on: true, root: 0, scale: 'major', dir: 'nearest' };
    const notes = pitches(p);
    expect(notes.map((n) => [n.prePitch, n.pitch, n.scaleDelta])).toEqual([
      [60, 60, 0],
      [61, 62, 1],
      [63, 64, 1],
      [66, 67, 1],
    ]);
    expect(notes.map((n) => n.reads.pitch.value)).toEqual([60, 61, 63, 66]);
  });

  it('never rewrites the stored series', () => {
    const p = scaleProject();
    p.scale = { on: true, root: 0, scale: 'minor-pent', dir: 'down' };
    const before = JSON.stringify(p.columns);
    const e = new Engine(p);
    e.generate(24 * 40);
    expect(JSON.stringify(e.project.columns)).toBe(before);
  });

  it('transposition happens before the scale constraint', () => {
    const p = scaleProject();
    p.scale = { on: true, root: 0, scale: 'major', dir: 'nearest' };
    p.lines[0]!.transpose = 1;
    const notes = pitches(p);
    // C4+1 = C#4 -> D4; C#4+1 = D4 stays; D#4+1 = E4 stays; F#4+1 = G4 stays.
    expect(notes.map((n) => [n.prePitch, n.pitch])).toEqual([[61, 62], [62, 62], [64, 64], [67, 67]]);
  });

  it('per-line override and per-line OFF', () => {
    const p = scaleProject();
    p.scale = { on: true, root: 0, scale: 'major', dir: 'nearest' };
    p.lines[0]!.scale = { mode: 'off', root: 0, scale: 'major', dir: 'nearest' };
    p.lines[1]!.scale = { mode: 'own', root: 0, scale: 'minor-pent', dir: 'down' };
    expect(pitches(p, 0).map((n) => n.pitch)).toEqual([60, 61, 63, 66]);
    expect(pitches(p, 1).map((n) => n.pitch)).toEqual([60, 60, 63, 65]);
  });

  it('live scale changes apply from the next note assembled', () => {
    const p = scaleProject();
    const e = new Engine(p);
    const a = e.generate(13).filter((n) => n.line === 0);
    p.scale = { on: true, root: 0, scale: 'whole-tone', dir: 'up' };
    const b = e.generate(48).filter((n) => n.line === 0);
    expect(a.map((n) => n.pitch)).toEqual([60, 61]);
    expect(b.map((n) => n.pitch)).toEqual([64, 66]);
    p.lines[0]!.scale.mode = 'off';
    expect(e.generate(72).filter((n) => n.line === 0).map((n) => n.pitch)).toEqual([60, 61]);
  });

  it('persists, and old projects load with Scale Mode off', () => {
    const p = scaleProject();
    p.scale = { on: true, root: 7, scale: 'lydian', dir: 'up' };
    p.lines[2]!.scale = { mode: 'own', root: 3, scale: 'dim-hw', dir: 'down' };
    const q = deserialize(serialize(p));
    expect(q.scale).toEqual(p.scale);
    expect(q.lines[2]!.scale).toEqual(p.lines[2]!.scale);
    const bad = deserialize({ format: 'feelers.project', version: 2, project: { ...cloneProject(p), scale: { on: 'yes', root: 40, scale: 'nope', dir: 'sideways' } } });
    expect(bad.scale).toEqual({ on: false, root: 11, scale: 'major', dir: 'nearest' });
  });
});

describe('Scale Mode with MIDI output', () => {
  it('internal clock: emitted note-ons carry the constrained pitch; every note is paired', () => {
    const p = scaleProject();
    p.scale = { on: true, root: 0, scale: 'major', dir: 'nearest' };
    const r = rig(p);
    r.sched.start();
    r.run(3000);
    r.sched.stop();
    const ons = r.sink.notes().filter((n) => n.on && n.ch === 1).map((n) => n.note);
    expect(ons.slice(0, 4)).toEqual([60, 62, 64, 67]);
    expect(checkPairing(r.sink).ok).toBe(true);
  });

  it('changing the scale while a note sounds still releases the note that was played', () => {
    const p = scaleProject();
    p.columns.find((c) => c.id === 'S1')!.els = [{ v: 64 }]; // long notes
    p.lines[0]!.overlap = 'mono';
    const r = rig(p);
    r.sched.start();
    r.run(300);
    r.engine.project.scale = { on: true, root: 0, scale: 'whole-tone', dir: 'down' };
    r.run(700);
    r.engine.project.scale.on = false;
    r.run(700);
    r.sched.stop();
    expect(checkPairing(r.sink)).toMatchObject({ ok: true });
    expect(r.out.heldCount()).toBe(0);
  });

  it('quantised repeats of the same pitch are released before being struck again', () => {
    const p = scaleProject();
    // C4 and C#4 both become C4 with DOWN in C major: two C4s in a row.
    p.scale = { on: true, root: 0, scale: 'major', dir: 'down' };
    p.columns.find((c) => c.id === 'S1')!.els = [{ v: 40 }];
    for (const overlap of ['written', 'legato', 'mono'] as const) {
      p.lines[0]!.overlap = overlap;
      const r = rig(cloneProject(p));
      r.sched.start();
      r.run(2000);
      r.sched.stop();
      expect(checkPairing(r.sink).ok).toBe(true);
    }
  });

  it('external clock: the same constrained pitches as internal clock', () => {
    const p = scaleProject();
    p.scale = { on: true, root: 2, scale: 'dorian', dir: 'nearest' };
    const internal = new Engine(cloneProject(p)).generate(24 * 8).filter((n) => !n.silent).map((n) => [n.line, n.tick, n.pitch]);
    const r = rig(cloneProject(p));
    r.sched.setSource('external');
    r.sched.setInputReady(true);
    r.sched.receive([START], r.clock.t);
    for (let i = 0; i < 24 * 8; i++) {
      r.clock.t += 20;
      r.sched.receive([CLOCK], r.clock.t);
    }
    r.sched.stop();
    const seen: number[][] = [];
    const ons = r.sink.notes().filter((n) => n.on);
    for (const n of ons) seen.push([n.ch, n.note]);
    expect(seen).toEqual(internal.map(([l, , pitch]) => [l! + 1, pitch]));
    expect(checkPairing(r.sink).ok).toBe(true);
  });
});
