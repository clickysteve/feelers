/**
 * Series traversal and randomisation, against the Fingers manual (chapter 3
 * "Series and Columns", "Series Control Elements"; chapter 6 "Randomization").
 * Rules the manual leaves open are marked CHOICE and documented in
 * docs/UNCERTAINTIES.md.
 */
import { describe, expect, it } from 'vitest';
import { makeColumn } from '../../src/engine/factory';
import { Rng } from '../../src/engine/rng';
import { GAUSS_SCALE, Score, cycleLength, newHead, pitchRanges, readHead, seriesKey, type ReadContext } from '../../src/engine/series';
import type { Column, Direction, RandomSettings } from '../../src/engine/types';

const V = (n: number, src: string, opts: Partial<Column> = {}) => makeColumn('velocity', n, src, opts);

function walk(cols: Column[], id: string, n: number, dir: Direction = 1, start = 0, extra: Partial<ReadContext> = {}): (number | string)[] {
  const c = cols.find((x) => x.id === id)!;
  const head = newHead(c.kind, id, start, dir);
  const score = new Score(cols);
  const out: (number | string)[] = [];
  for (let i = 0; i < n; i++) {
    const r = readHead(head, { score, ...extra });
    out.push(r.pos === null ? '∅' : r.rest ? `${r.value ?? '_'}${r.rest}` : (r.value as number));
  }
  return out;
}

describe('columns and series', () => {
  it('walks forward and wraps', () => {
    expect(walk([V(1, '10 20 30')], 'V1', 7)).toEqual([10, 20, 30, 10, 20, 30, 10]);
  });

  it('walks in reverse and wraps', () => {
    expect(walk([V(1, '10 20 30')], 'V1', 5, -1, 2)).toEqual([30, 20, 10, 30, 20]);
  });

  it('honours a starting element', () => {
    expect(walk([V(1, '10 20 30 40')], 'V1', 4, 1, 2)).toEqual([30, 40, 10, 20]);
  });

  it('End of Series splits a column into separate, usable series', () => {
    const cols = [V(1, '10 20| 30 40 50')];
    expect(walk(cols, 'V1', 5)).toEqual([10, 20, 10, 20, 10]);
    expect(walk(cols, 'V1', 5, 1, 2)).toEqual([30, 40, 50, 30, 40]);
    expect(walk(cols, 'V1', 4, -1, 1)).toEqual([20, 10, 20, 10]);
    expect(walk(cols, 'V1', 4, -1, 2)).toEqual([30, 50, 40, 30]);
  });

  it('Column Link makes linked columns one continuous series', () => {
    const cols = [V(1, '1 2 +'), V(2, '3 4')];
    expect(walk(cols, 'V1', 7)).toEqual([1, 2, 3, 4, 1, 2, 3]);
    // A head starting in the second column belongs to the same series.
    expect(walk(cols, 'V2', 4)).toEqual([3, 4, 1, 2]);
  });

  it('Column Link goes to the next column of the same kind, even if not adjacent', () => {
    const cols = [V(1, '1 2 +'), makeColumn('pitch', 1, 'C4'), V(2, '3')];
    expect(walk(cols, 'V1', 4)).toEqual([1, 2, 3, 1]);
  });

  it('a link from the rightmost column wraps to the leftmost', () => {
    const cols = [V(1, '1 2'), V(2, '3 4 +')];
    expect(walk(cols, 'V2', 6)).toEqual([3, 4, 1, 2, 3, 4]);
  });

  it('Link joins the bottom series of a column to the top series of the next', () => {
    const cols = [V(1, '1 2| 3 +'), V(2, '4 5| 6')];
    expect(walk(cols, 'V1', 4)).toEqual([1, 2, 1, 2]);
    expect(walk(cols, 'V1', 6, 1, 2)).toEqual([3, 4, 5, 3, 4, 5]);
    expect(walk(cols, 'V2', 3, 1, 2)).toEqual([6, 6, 6]);
  });

  it('a ring of linked columns never wraps', () => {
    expect(walk([V(1, '1 +'), V(2, '2 +')], 'V1', 5)).toEqual([1, 2, 1, 2, 1]);
  });

  it('heads moving backward cross links too', () => {
    const cols = [V(1, '1 2 +'), V(2, '3 4')];
    expect(walk(cols, 'V2', 6, -1, 1)).toEqual([4, 3, 2, 1, 4, 3]);
  });

  it('blank elements are passed over (CHOICE)', () => {
    expect(walk([V(1, '1 _ 2')], 'V1', 4)).toEqual([1, 2, 1, 2]);
  });

  it('an empty linked column is passed through', () => {
    const cols = [V(1, '1 +'), V(2, '', { link: true }), V(3, '3')];
    expect(walk(cols, 'V1', 4)).toEqual([1, 3, 1, 3]);
  });
});

describe('Skip', () => {
  it('skips its own element, in both directions, and keeps the value', () => {
    const cols = [V(1, '10 20S 30')];
    expect(walk(cols, 'V1', 4)).toEqual([10, 30, 10, 30]);
    expect(walk(cols, 'V1', 4, -1, 2)).toEqual([30, 10, 30, 10]);
    expect(cols[0]!.els[1]).toEqual({ v: 20, skip: true });
    delete cols[0]!.els[1]!.skip;
    expect(walk(cols, 'V1', 3)).toEqual([10, 20, 30]);
  });

  it('overrides a Loop and a rest on the same element', () => {
    expect(walk([V(1, '1 2 L2S 3')], 'V1', 6)).toEqual([1, 2, 3, 1, 2, 3]);
    expect(walk([V(1, '1 2RS 3')], 'V1', 4)).toEqual([1, 3, 1, 3]);
  });

  it('beside End: the element is skipped but the series still ends there', () => {
    const cols = [V(1, '1 2S| 3')];
    expect(walk(cols, 'V1', 3)).toEqual([1, 1, 1]);
    expect(walk(cols, 'V1', 3, 1, 2)).toEqual([3, 3, 3]);
  });

  it('a series of nothing but skipped elements yields nothing', () => {
    expect(walk([V(1, '1S 2S')], 'V1', 2)).toEqual(['∅', '∅']);
  });
});

describe('Loop', () => {
  it('repeats from the start of the series; count n repeats n more times (CHOICE)', () => {
    expect(walk([V(1, '1 2 L2 3')], 'V1', 8)).toEqual([1, 2, 1, 2, 1, 2, 3, 1]);
  });

  it('count as total passes (the alternative reading)', () => {
    const choices = { firstNoteWaits: false, loopCount: 'passes' as const };
    expect(walk([V(1, '1 2 L2 3')], 'V1', 6, 1, 0, { choices })).toEqual([1, 2, 1, 2, 3, 1]);
  });

  it('starts again after its loop is done', () => {
    expect(walk([V(1, '1 L1 2')], 'V1', 6)).toEqual([1, 1, 2, 1, 1, 2]);
  });

  it('the top of a loop is the previous Loop in the series', () => {
    expect(walk([V(1, '1 L1 2 3 L2 4')], 'V1', 9)).toEqual([1, 1, 2, 3, 2, 3, 2, 3, 4]);
  });

  it('count 0 loops forever', () => {
    expect(walk([V(1, '1 2 L0 3')], 'V1', 9)).toEqual([1, 2, 1, 2, 1, 2, 1, 2, 1]);
  });

  it('is ignored by heads moving backward', () => {
    expect(walk([V(1, '1 2 L2 3')], 'V1', 6, -1, 3)).toEqual([3, 2, 1, 3, 2, 1]);
  });

  it('occupies an element slot', () => {
    const c = V(1, '1 L1 2');
    expect(c.els).toHaveLength(3);
    expect(c.els[1]).toEqual({ v: null, loop: 1 });
  });

  it('the series start may lie in a linked column', () => {
    const cols = [V(1, '1 2 +'), V(2, '3 L1 4')];
    expect(walk(cols, 'V1', 8)).toEqual([1, 2, 3, 1, 2, 3, 4, 1]);
  });

  it('a degenerate loop of nothing yields nothing rather than hanging', () => {
    expect(walk([V(1, 'L0')], 'V1', 2)).toEqual(['∅', '∅']);
  });
});

describe('rests', () => {
  it('are reported with their mark; the head moves on', () => {
    expect(walk([V(1, '60 62R 64r _r')], 'V1', 5)).toEqual([60, '62R', '64r', '_r', 60]);
  });
});

describe('cycle length', () => {
  it('counts reads including loops and skips', () => {
    const sc = new Score([makeColumn('pitch', 1, 'C4 D4 E4'), makeColumn('pitch', 2, 'C4 L2 E4'), makeColumn('pitch', 3, 'C4 D4S E4| F4')]);
    expect(cycleLength(sc, 'P1')).toBe(3);
    expect(cycleLength(sc, 'P2')).toBe(4);
    expect(cycleLength(sc, 'P3')).toBe(2);
  });
});

// ---------------------------------------------------------------------------

const settings = (over: Partial<RandomSettings>): RandomSettings => ({ amount: 2, type: 0, p1: 0, p2: 0, pw: 0, ...over });

function randCtx(cols: Column[], _kind: 'pitch' | 'time' | 'velocity', set: RandomSettings, seed = 1, extra: Partial<ReadContext> = {}): ReadContext {
  const random = { time: set, pitch: set, velocity: set, artic: set };
  return { score: new Score(cols), rng: new Rng(seed), random, minTime: 1, pitchLimit: 127, ...extra };
}

describe('auto-randomisation (Fingers ? and ¿)', () => {
  it('? changes the stored value (the change is kept)', () => {
    const c = makeColumn('pitch', 1, 'C4?');
    const ctx = randCtx([c], 'pitch', settings({ amount: 1, type: 1, p1: 100 }));
    const head = newHead('pitch', 'P1', 0, 1);
    let prev = 60;
    for (let i = 0; i < 50; i++) {
      const r = readHead(head, ctx);
      expect(Math.abs((r.value as number) - prev)).toBe(1);
      expect(c.els[0]!.v).toBe(r.value);
      prev = r.value as number;
    }
  });

  it('? and ¿ differ only in which probability they use', () => {
    const run = (src: string, p1: number, p2: number) => {
      const c = makeColumn('pitch', 1, src);
      const ctx = randCtx([c], 'pitch', settings({ amount: 3, type: 1, p1, p2 }));
      const head = newHead('pitch', 'P1', 0, 1);
      for (let i = 0; i < 40; i++) readHead(head, ctx);
      return c.els[0]!.v;
    };
    // Each symbol ignores the other's probability.
    expect(run('C4?', 0, 100)).toBe(60);
    expect(run('C4??', 100, 0)).toBe(60);
    // Both persist when their probability fires.
    const a = makeColumn('pitch', 1, 'C4?');
    const b = makeColumn('pitch', 1, 'C4??');
    readHead(newHead('pitch', 'P1', 0, 1), randCtx([a], 'pitch', settings({ amount: 3, type: 1, p1: 100 })));
    readHead(newHead('pitch', 'P1', 0, 1), randCtx([b], 'pitch', settings({ amount: 3, type: 1, p2: 100 })));
    expect(a.els[0]!.v).not.toBe(60);
    expect(b.els[0]!.v).not.toBe(60);
  });

  it('probability 33 randomises about one read in three', () => {
    const c = makeColumn('velocity', 1, '64?');
    const ctx = randCtx([c], 'velocity', settings({ amount: 4, type: 1, p1: 33 }));
    const head = newHead('velocity', 'V1', 0, 1);
    let changed = 0;
    for (let i = 0; i < 3000; i++) if (readHead(head, ctx).randomised) changed++;
    expect(changed / 3000).toBeGreaterThan(0.29);
    expect(changed / 3000).toBeLessThan(0.37);
  });

  it('Type n: changes are +/- Amount times 1..n, equally likely', () => {
    const c = makeColumn('velocity', 1, '64~');
    const ctx = randCtx([c], 'velocity', settings({ amount: 3, type: 2, pw: 100 }));
    const head = newHead('velocity', 'V1', 0, 1);
    const seen = new Map<number, number>();
    for (let i = 0; i < 4000; i++) {
      const d = (readHead(head, ctx).value as number) - 64;
      seen.set(d, (seen.get(d) ?? 0) + 1);
    }
    expect([...seen.keys()].sort((a, b) => a - b)).toEqual([-6, -3, 3, 6]);
    for (const n of seen.values()) expect(n / 4000).toBeGreaterThan(0.2);
  });

  it('Type 0: gaussian whose average change is about Amount', () => {
    const c = makeColumn('velocity', 1, '64~');
    const ctx = randCtx([c], 'velocity', settings({ amount: 6, type: 0, pw: 100 }));
    const head = newHead('velocity', 'V1', 0, 1);
    let sum = 0;
    const N = 6000;
    for (let i = 0; i < N; i++) sum += Math.abs((readHead(head, ctx).value as number) - 64);
    expect(sum / N).toBeGreaterThan(5.4);
    expect(sum / N).toBeLessThan(6.6);
    expect(GAUSS_SCALE).toBeCloseTo(1.2533, 3);
  });

  it('limits apply only to randomised values', () => {
    // A stored value far outside the series' randomisation range plays as written.
    const c = makeColumn('pitch', 1, 'C2 C4? C5');
    const sc = new Score([c]);
    const ranges = pitchRanges(sc);
    const ctx = randCtx([c], 'pitch', settings({ amount: 40, type: 1, p1: 100 }), 3, { pitchLimit: 7, pitchRange: (p) => ranges.get(seriesKey(sc, p)) ?? null });
    const head = newHead('pitch', 'P1', 0, 1);
    for (let i = 0; i < 60; i++) {
      const r = readHead(head, ctx);
      if (r.pos!.i === 0) expect(r.value).toBe(36);
      if (r.pos!.i === 2) expect(r.value).toBe(72);
      if (r.pos!.i === 1) {
        // range C2..C5 (36..72) widened by 7
        expect(r.value).toBeGreaterThanOrEqual(29);
        expect(r.value).toBeLessThanOrEqual(79);
      }
    }
  });

  it('Pitch Limit: C4 and C5 with limit 7 stay within F3..G5 (manual example)', () => {
    const c = makeColumn('pitch', 1, 'C4? C5?');
    const sc = new Score([c]);
    const ranges = pitchRanges(sc);
    const ctx = randCtx([c], 'pitch', settings({ amount: 9, type: 3, p1: 100 }), 9, { pitchLimit: 7, pitchRange: (p) => ranges.get(seriesKey(sc, p)) ?? null });
    const head = newHead('pitch', 'P1', 0, 1);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(readHead(head, ctx).value as number);
    expect(Math.min(...seen)).toBe(53);
    expect(Math.max(...seen)).toBe(79);
  });

  it('Minimum Time: randomised Time values never fall below it', () => {
    const c = makeColumn('time', 1, '12?');
    const ctx = randCtx([c], 'time', settings({ amount: 6, type: 3, p1: 100 }), 4, { minTime: 9 });
    const head = newHead('time', 'T1', 0, 1);
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) seen.add(readHead(head, ctx).value as number);
    expect(Math.min(...seen)).toBe(9);
  });

  it('a column can carry its own settings and bounds (Feelers extension)', () => {
    const c = makeColumn('velocity', 1, '64?', { rand: { amount: 50, type: 1, p1: 100, p2: 0, pw: 0, lo: 60, hi: 70 } });
    const ctx = randCtx([c], 'velocity', settings({ p1: 0 }));
    const head = newHead('velocity', 'V1', 0, 1);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) seen.add(readHead(head, ctx).value as number);
    expect([...seen].every((v) => v === 60 || v === 70 || v === 64)).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('probability zero never randomises', () => {
    const c = makeColumn('velocity', 1, '64? 64?? 64~');
    const ctx = randCtx([c], 'velocity', settings({ amount: 10 }));
    const head = newHead('velocity', 'V1', 0, 1);
    for (let i = 0; i < 60; i++) expect(readHead(head, ctx).value).toBe(64);
  });
});

describe('WOBBLE (Feelers extension)', () => {
  it('displaces the value read but never the stored value', () => {
    const c = makeColumn('pitch', 1, 'C4~');
    const ctx = randCtx([c], 'pitch', settings({ amount: 2, type: 3, pw: 100 }), 42);
    const head = newHead('pitch', 'P1', 0, 1);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add((readHead(head, ctx).value as number) - 60);
    expect([...seen].every((d) => [-6, -4, -2, 2, 4, 6].includes(d))).toBe(true);
    expect(c.els[0]).toEqual({ v: 60, ar: 3 });
  });
});
