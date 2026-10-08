import { describe, expect, it } from 'vitest';
import { makeSeries } from '../../src/engine/factory';
import { Rng } from '../../src/engine/rng';
import { cycleLength, newHead, readHead } from '../../src/engine/series';
import type { Direction, Kind, Series } from '../../src/engine/types';

function walk(bank: Series[], id: string, n: number, dir: Direction = 1, start = 0, kind?: Kind): (number | '_')[] {
  const s = bank.find((x) => x.id === id)!;
  const head = newHead(kind ?? s.kind, id, start, dir);
  const rng = new Rng(1);
  const out: (number | '_')[] = [];
  for (let i = 0; i < n; i++) {
    const r = readHead(head, { bank, rng });
    out.push(r.rest ? '_' : r.value);
  }
  return out;
}

describe('series traversal', () => {
  it('walks forward and wraps', () => {
    const bank = [makeSeries('velocity', 1, '10 20 30')];
    expect(walk(bank, 'V1', 7)).toEqual([10, 20, 30, 10, 20, 30, 10]);
  });

  it('walks in reverse and wraps', () => {
    const bank = [makeSeries('velocity', 1, '10 20 30')];
    expect(walk(bank, 'V1', 5, -1, 2)).toEqual([30, 20, 10, 30, 20]);
  });

  it('honours a starting position', () => {
    const bank = [makeSeries('velocity', 1, '10 20 30 40')];
    expect(walk(bank, 'V1', 4, 1, 2)).toEqual([30, 40, 10, 20]);
  });

  it('END makes later cells dormant', () => {
    const bank = [makeSeries('velocity', 1, '10 20 | 99 98')];
    expect(walk(bank, 'V1', 5)).toEqual([10, 20, 10, 20, 10]);
    expect(walk(bank, 'V1', 4, -1, 1)).toEqual([20, 10, 20, 10]);
  });

  it('SKIP hops over the next value', () => {
    const bank = [makeSeries('velocity', 1, '10 > 20 30')];
    expect(walk(bank, 'V1', 4)).toEqual([10, 30, 10, 30]);
  });

  it('SKIP works in the direction of travel', () => {
    const bank = [makeSeries('velocity', 1, '10 20 > 30')];
    // reverse from the end: 30, then skip flag hit, so 20 is jumped -> 10
    expect(walk(bank, 'V1', 4, -1, 3)).toEqual([30, 10, 30, 10]);
  });

  it('loops play the section n times in total', () => {
    const bank = [makeSeries('velocity', 1, '1 [ 2 3 ]3 4')];
    expect(walk(bank, 'V1', 9)).toEqual([1, 2, 3, 2, 3, 2, 3, 4, 1]);
  });

  it('nested loops', () => {
    const bank = [makeSeries('velocity', 1, '[ 1 [ 2 ]2 ]2 3')];
    expect(walk(bank, 'V1', 7)).toEqual([1, 2, 2, 1, 2, 2, 3]);
  });

  it('loops work in reverse', () => {
    const bank = [makeSeries('velocity', 1, '1 [ 2 3 ]2 4')];
    expect(walk(bank, 'V1', 7, -1, 6)).toEqual([4, 3, 2, 3, 2, 1, 4]);
  });

  it('REST in a pitch series silences that note', () => {
    const bank = [makeSeries('pitch', 1, '60 _ 62')];
    expect(walk(bank, 'P1', 4)).toEqual([60, '_', 62, 60]);
  });

  it('REST in a time series marks the next time value as silent', () => {
    const bank = [makeSeries('time', 1, '6 _ 12 6')];
    const s = bank[0]!;
    const head = newHead('time', s.id, 0, 1);
    const rng = new Rng(1);
    const r1 = readHead(head, { bank, rng });
    const r2 = readHead(head, { bank, rng });
    const r3 = readHead(head, { bank, rng });
    expect([r1.rest, r1.value]).toEqual([false, 6]);
    expect([r2.rest, r2.value]).toEqual([true, 12]);
    expect([r3.rest, r3.value]).toEqual([false, 6]);
  });

  it('LINK continues into the next series of the same kind', () => {
    const bank = [
      makeSeries('velocity', 1, '1 2 +'),
      makeSeries('pitch', 1, '60'),
      makeSeries('velocity', 2, '3 4'),
    ];
    // V1 -> V2, and V2 wraps on itself
    expect(walk(bank, 'V1', 7)).toEqual([1, 2, 3, 4, 3, 4, 3]);
  });

  it('LINK chains can cycle', () => {
    const bank = [makeSeries('velocity', 1, '1 +'), makeSeries('velocity', 2, '2 +')];
    expect(walk(bank, 'V1', 5)).toEqual([1, 2, 1, 2, 1]);
  });

  it('reversing past the start of a linked series re-enters its predecessor', () => {
    const bank = [makeSeries('velocity', 1, '1 2 +'), makeSeries('velocity', 2, '3 4')];
    expect(walk(bank, 'V2', 5, -1, 1)).toEqual([4, 3, 2, 1, 2]);
  });

  it('applies limits to read values', () => {
    const bank = [makeSeries('pitch', 1, '40 60 90', { lo: 48, hi: 72 })];
    expect(walk(bank, 'P1', 3)).toEqual([48, 60, 72]);
  });

  it('survives degenerate series', () => {
    const bank = [makeSeries('pitch', 1, '[ ]999 >'), makeSeries('pitch', 2, '|')];
    expect(walk(bank, 'P1', 2)).toEqual(['_', '_']);
    expect(walk(bank, 'P2', 2)).toEqual(['_', '_']);
  });
});

describe('randomisation', () => {
  it('wobble displaces reads but keeps the stored value', () => {
    const s = makeSeries('pitch', 1, '60?', { rand: { amount: 2, type: 3, prob: 100 } });
    const bank = [s];
    const head = newHead('pitch', 'P1', 0, 1);
    const rng = new Rng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const r = readHead(head, { bank, rng });
      if (!r.rest) seen.add(r.value - 60);
    }
    expect([...seen].every((d) => [-6, -4, -2, 2, 4, 6].includes(d))).toBe(true);
    expect(seen.size).toBeGreaterThan(3);
    expect(s.cells[0]).toEqual({ t: 'v', v: 60, r: 1 });
  });

  it('drift writes the displacement back (random walk within limits)', () => {
    const s = makeSeries('pitch', 1, '60~', { rand: { amount: 1, type: 1, prob: 100 }, lo: 55, hi: 65 });
    const bank = [s];
    const head = newHead('pitch', 'P1', 0, 1);
    const rng = new Rng(7);
    let prev = 60;
    for (let i = 0; i < 300; i++) {
      const r = readHead(head, { bank, rng });
      const v = (s.cells[0] as { v: number }).v;
      // one step each read, unless clamped at a limit
      if (v === prev) expect([55, 65]).toContain(v);
      else expect(Math.abs(v - prev)).toBe(1);
      expect(v).toBeGreaterThanOrEqual(55);
      expect(v).toBeLessThanOrEqual(65);
      expect(r.rest ? null : r.value).toBe(v);
      prev = v;
    }
  });

  it('gaussian type produces mostly small displacements', () => {
    const s = makeSeries('velocity', 1, '64?', { rand: { amount: 4, type: 0, prob: 100 } });
    const head = newHead('velocity', 'V1', 0, 1);
    const rng = new Rng(3);
    let within = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const r = readHead(head, { bank: [s], rng });
      if (!r.rest && Math.abs(r.value - 64) <= 4) within++;
    }
    // ~68% within one standard deviation (plus rounding)
    expect(within / N).toBeGreaterThan(0.6);
    expect(within / N).toBeLessThan(0.85);
  });

  it('probability zero never randomises', () => {
    const s = makeSeries('velocity', 1, '64?', { rand: { amount: 10, type: 0, prob: 0 } });
    expect(walk([s], 'V1', 50).every((v) => v === 64)).toBe(true);
  });
});

describe('cycle length', () => {
  it('counts value steps including loops and skips', () => {
    expect(cycleLength(makeSeries('pitch', 1, 'C4 D4 E4'))).toBe(3);
    expect(cycleLength(makeSeries('pitch', 1, 'C4 [ D4 ]3 E4'))).toBe(5);
    expect(cycleLength(makeSeries('pitch', 1, 'C4 > D4 E4 | F4'))).toBe(2);
  });
});
