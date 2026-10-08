/**
 * Series traversal.
 *
 * A head walks a series cell by cell in its current direction. Value cells
 * are read and returned; series control elements steer the head. The rules
 * are symmetric so that reversing a head mid-performance behaves sensibly:
 *
 *  - Wrapping: passing the active end of a series returns to its start, and
 *    vice versa when moving backwards. The active end is the first END cell,
 *    or the last cell if there is none.
 *  - SKIP: the next value cell (or REST) in the direction of travel is jumped.
 *  - REST: in Pitch / Velocity / Articulation series the head lands on it and
 *    the note becomes a rest. In a Time series a REST is a marker: the next
 *    time value is read as a silent gap.
 *  - Loops: `[ ... ]n` plays the bracketed section n times in total. When
 *    travelling backwards the brackets swap roles, sharing one counter.
 *  - LINK: travelling forwards, the head jumps to the start of the next series
 *    of the same kind (bank order, wrapping). Travelling backwards past the
 *    start of a series whose predecessor contains a LINK, the head re-enters
 *    the predecessor just before that LINK.
 */
import type { Cell, Direction, Kind, Series } from './types';
import { KIND_RANGE } from './types';
import type { Rng } from './rng';

export interface HeadState {
  kind: Kind;
  series: string;
  /** Index of the next cell to examine. */
  pos: number;
  dir: Direction;
  /** Loop pass counters keyed by `${seriesId}:${closeIndex}`. */
  loops: Record<string, number>;
  /** Pending skip from a SKIP element. */
  skip: boolean;
  /** Series and index of the most recently read cell (for display). */
  lastSeries: string | null;
  lastIndex: number | null;
}

export type ReadResult =
  | { rest: false; value: number; series: string; index: number; randomised: boolean }
  | { rest: true; value: number | null; series: string; index: number | null };

export type SeriesLookup = (id: string) => Series | undefined;

const ITERATION_GUARD = 20000;

/** Index one past the last active cell (first END, or the length). */
export function activeLength(s: Series): number {
  const i = s.cells.findIndex((c) => c.t === 'end');
  return i === -1 ? s.cells.length : i;
}

/** Find the bracket matching the one at `index`, within the active region. */
export function matchBracket(cells: Cell[], index: number, active: number): number {
  const c = cells[index];
  if (!c) return -1;
  if (c.t === 'close') {
    let depth = 0;
    for (let i = index - 1; i >= 0; i--) {
      const t = cells[i]!.t;
      if (t === 'close') depth++;
      else if (t === 'open') {
        if (depth === 0) return i;
        depth--;
      }
    }
  } else if (c.t === 'open') {
    let depth = 0;
    for (let i = index + 1; i < active; i++) {
      const t = cells[i]!.t;
      if (t === 'open') depth++;
      else if (t === 'close') {
        if (depth === 0) return i;
        depth--;
      }
    }
  }
  return -1;
}

/** The series of the same kind that follows `id` in bank order (wrapping). */
export function nextOfKind(bank: Series[], id: string, step: 1 | -1): Series | undefined {
  const idx = bank.findIndex((s) => s.id === id);
  if (idx === -1) return undefined;
  const kind = bank[idx]!.kind;
  const n = bank.length;
  for (let k = 1; k < n; k++) {
    const s = bank[(idx + step * k + n * k) % n]!;
    if (s.kind === kind) return s;
  }
  return undefined;
}

export function clampToKind(kind: Kind, v: number): number {
  const r = KIND_RANGE[kind];
  return Math.min(r.max, Math.max(r.min, Math.round(v)));
}

export function newHead(kind: Kind, series: string, start: number, dir: Direction): HeadState {
  return { kind, series, pos: start, dir, loops: {}, skip: false, lastSeries: null, lastIndex: null };
}

/** Random displacement according to the series' randomisation settings. */
export function randomDelta(s: Series, rng: Rng): number {
  const { amount, type } = s.rand;
  if (amount <= 0) return 0;
  if (type <= 0) return Math.round(rng.gauss() * amount);
  const k = rng.int(1, Math.max(1, Math.floor(type)));
  return (rng.next() < 0.5 ? -1 : 1) * amount * k;
}

export interface ReadContext {
  bank: Series[];
  rng: Rng;
  /** Called when a DRIFT cell rewrites its stored value. */
  onCellChanged?: (seriesId: string, index: number) => void;
}

/**
 * Read the next value from the head and advance it. Mutates `head` and, for
 * drift-flagged cells, the series itself.
 */
export function readHead(head: HeadState, ctx: ReadContext): ReadResult {
  const lookup = (id: string) => ctx.bank.find((s) => s.id === id);
  let silentTime = false;

  for (let guard = 0; guard < ITERATION_GUARD; guard++) {
    let s = lookup(head.series);
    if (!s) return { rest: true, value: null, series: head.series, index: null };
    const active = activeLength(s);
    if (active === 0) return { rest: true, value: null, series: s.id, index: null };

    if (head.pos >= active || head.pos < 0) {
      if (head.dir === 1) {
        head.pos = 0;
      } else {
        const prev = nextOfKind(ctx.bank, s.id, -1);
        const linkAt = prev ? prev.cells.slice(0, activeLength(prev)).findIndex((c) => c.t === 'link') : -1;
        if (prev && linkAt !== -1) {
          head.series = prev.id;
          head.pos = linkAt - 1;
          s = prev;
          if (head.pos < 0) continue;
        } else {
          head.pos = active - 1;
        }
      }
      continue;
    }

    const c = s.cells[head.pos]!;
    switch (c.t) {
      case 'v': {
        if (head.skip) {
          head.skip = false;
          head.pos += head.dir;
          continue;
        }
        const index = head.pos;
        head.lastSeries = s.id;
        head.lastIndex = index;
        head.pos += head.dir;
        let value = c.v;
        let randomised = false;
        if (c.r && s.rand.prob > 0 && ctx.rng.next() * 100 < s.rand.prob) {
          const d = randomDelta(s, ctx.rng);
          if (d !== 0) {
            randomised = true;
            const moved = clampToKind(s.kind, Math.min(s.hi, Math.max(s.lo, value + d)));
            if (c.r === 2) {
              c.v = moved;
              ctx.onCellChanged?.(s.id, index);
            }
            value = moved;
          }
        }
        value = clampToKind(s.kind, Math.min(s.hi, Math.max(s.lo, value)));
        if (silentTime) return { rest: true, value, series: s.id, index };
        return { rest: false, value, series: s.id, index, randomised };
      }
      case 'rest': {
        if (head.skip) {
          head.skip = false;
          head.pos += head.dir;
          continue;
        }
        if (head.kind === 'time') {
          silentTime = true;
          head.pos += head.dir;
          continue;
        }
        const index = head.pos;
        head.lastSeries = s.id;
        head.lastIndex = index;
        head.pos += head.dir;
        return { rest: true, value: null, series: s.id, index };
      }
      case 'skip':
        head.skip = true;
        head.pos += head.dir;
        continue;
      case 'open':
      case 'close': {
        const closing = (head.dir === 1 && c.t === 'close') || (head.dir === -1 && c.t === 'open');
        const partner = matchBracket(s.cells, head.pos, active);
        if (!closing || partner === -1) {
          head.pos += head.dir;
          continue;
        }
        const closeIdx = c.t === 'close' ? head.pos : partner;
        const closeCell = s.cells[closeIdx];
        const n = closeCell && closeCell.t === 'close' ? closeCell.n : 1;
        const key = `${s.id}:${closeIdx}`;
        const count = head.loops[key] ?? 1;
        if (count < n) {
          head.loops[key] = count + 1;
          head.pos = partner + head.dir;
        } else {
          delete head.loops[key];
          head.pos += head.dir;
        }
        continue;
      }
      case 'link': {
        if (head.dir === 1) {
          const next = nextOfKind(ctx.bank, s.id, 1);
          if (next) {
            head.series = next.id;
            head.pos = 0;
            continue;
          }
        }
        head.pos += head.dir;
        continue;
      }
      case 'end':
        // Unreachable: the active region stops before END.
        head.pos = head.dir === 1 ? active : -1;
        continue;
    }
  }
  return { rest: true, value: null, series: head.series, index: null };
}

/**
 * Number of reads after which a lone forward head on this series repeats
 * itself (ignoring links and randomisation). Used to explain the overall
 * period of a line: the least common multiple of its heads' cycles.
 */
export function cycleLength(s: Series): number {
  const solo: Series = { ...s, cells: s.cells.filter((c) => c.t !== 'link'), rand: { ...s.rand, prob: 0 } };
  const active = activeLength(solo);
  if (active === 0 || !solo.cells.slice(0, active).some((c) => c.t === 'v' || c.t === 'rest')) return 0;
  const head = newHead(s.kind, solo.id, 0, 1);
  const rng = { next: () => 0.5, int: () => 1, gauss: () => 0 } as unknown as Rng;
  const key = () => `${head.pos >= active ? 0 : head.pos}|${head.skip ? 1 : 0}|${JSON.stringify(head.loops)}`;
  const seen = new Map<string, number>();
  seen.set(key(), 0);
  for (let step = 1; step <= 100000; step++) {
    readHead(head, { bank: [solo], rng });
    const k = key();
    const first = seen.get(k);
    if (first !== undefined) return step - first;
    seen.set(k, step);
  }
  return 0;
}
