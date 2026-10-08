/**
 * Series traversal over the column model (Fingers manual, chapter 3).
 *
 *  - A column is split into separate series by End of Series flags. An End
 *    flag marks the *last* element of its series.
 *  - A column whose Link flag is set continues at the top of the next column
 *    of the same kind to the right, wrapping past the rightmost one. The
 *    bottom series of the linked column and the top series of the next one
 *    form one series.
 *  - A head moving forward past the end of its series returns to the start
 *    of that series; moving backward past its start, it goes to its end.
 *  - Skip: heads pass over the element. A Skip overrides a Loop or rest on
 *    the same element; End still applies.
 *  - Loop: an element slot of its own. Moving forward, it repeats everything
 *    from the start of the series (or the previous Loop in it) up to the Loop
 *    point; count 0 repeats forever. Heads moving backward ignore Loops.
 *  - Blank elements (no value, no rest) are passed over (an inferred rule).
 *  - Auto-randomise: `?` and `¿` may change the stored value when read, each
 *    with its own probability; WOBBLE (Feelers extension) changes only the
 *    value read. Limits apply to randomised values only.
 */
import { DEFAULT_CHOICES, type EngineChoices } from './choices';
import type { Rng } from './rng';
import type { Column, ColumnRandom, Direction, El, Kind, Pos, RandomSettings, RestMark } from './types';
import { KIND_RANGE } from './types';

export const posKey = (p: Pos): string => `${p.col}:${p.i}`;
export const samePos = (a: Pos | null | undefined, b: Pos | null | undefined): boolean => !!a && !!b && a.col === b.col && a.i === b.i;

/** Lookup helper over the project's column list (bank order). */
export class Score {
  private byId = new Map<string, Column>();
  constructor(readonly cols: Column[]) {
    for (const c of cols) this.byId.set(c.id, c);
  }
  col(id: string): Column | undefined {
    return this.byId.get(id);
  }
  el(p: Pos): El | undefined {
    return this.byId.get(p.col)?.els[p.i];
  }
  ofKind(kind: Kind): Column[] {
    return this.cols.filter((c) => c.kind === kind);
  }
  /** The next column of the same kind to the right, wrapping (may be the column itself). */
  rightOf(c: Column): Column {
    const same = this.ofKind(c.kind);
    return same[(same.indexOf(c) + 1) % same.length]!;
  }
  /** The previous column of the same kind, wrapping. */
  leftOf(c: Column): Column {
    const same = this.ofKind(c.kind);
    return same[(same.indexOf(c) - 1 + same.length) % same.length]!;
  }
  get size(): number {
    let n = 0;
    for (const c of this.cols) n += c.els.length;
    return n;
  }
}

/** The next element of the same series, or null at its end. */
export function rawNext(sc: Score, p: Pos): Pos | null {
  const c = sc.col(p.col);
  if (!c) return null;
  if (c.els[p.i]?.end) return null;
  if (p.i + 1 < c.els.length) return { col: c.id, i: p.i + 1 };
  let cur = c;
  for (let g = 0; g <= sc.cols.length; g++) {
    if (!cur.link) return null;
    const nx = sc.rightOf(cur);
    if (nx.els.length > 0) return { col: nx.id, i: 0 };
    cur = nx;
  }
  return null;
}

/** The previous element of the same series, or null at its start. */
export function rawPrev(sc: Score, p: Pos): Pos | null {
  const c = sc.col(p.col);
  if (!c) return null;
  if (p.i > 0) return c.els[p.i - 1]?.end ? null : { col: c.id, i: p.i - 1 };
  let cur = c;
  for (let g = 0; g <= sc.cols.length; g++) {
    const src = sc.leftOf(cur);
    if (!src.link) return null;
    if (src.els.length > 0) {
      const last = src.els.length - 1;
      return src.els[last]!.end ? null : { col: src.id, i: last };
    }
    cur = src;
  }
  return null;
}

/** First element of the series containing p; null if the series is a closed ring of links. */
export function seriesStart(sc: Score, p: Pos): Pos | null {
  let cur = p;
  for (let g = 0, n = sc.size; g <= n; g++) {
    const q = rawPrev(sc, cur);
    if (!q) return cur;
    if (samePos(q, p)) return null;
    cur = q;
  }
  return null;
}

/** Last element of the series containing p; null if the series is a closed ring. */
export function seriesEnd(sc: Score, p: Pos): Pos | null {
  let cur = p;
  for (let g = 0, n = sc.size; g <= n; g++) {
    const q = rawNext(sc, cur);
    if (!q) return cur;
    if (samePos(q, p)) return null;
    cur = q;
  }
  return null;
}

/** Every element of the series containing p, in forward order (a ring starts at p). */
export function seriesPositions(sc: Score, p: Pos): Pos[] {
  const start = seriesStart(sc, p) ?? p;
  const out: Pos[] = [start];
  let cur = start;
  for (let g = 0, n = sc.size; g < n; g++) {
    const q = rawNext(sc, cur);
    if (!q || samePos(q, start)) break;
    out.push(q);
    cur = q;
  }
  return out;
}

/** A stable identity for the series containing p. */
export function seriesKey(sc: Score, p: Pos): string {
  const all = seriesPositions(sc, p).map(posKey);
  return seriesStart(sc, p) ? all[0]! : `ring:${[...all].sort()[0]}`;
}

/** One step in direction `dir`, wrapping within the series. */
export function step(sc: Score, p: Pos, dir: Direction): Pos {
  if (dir === 1) return rawNext(sc, p) ?? seriesStart(sc, p) ?? p;
  return rawPrev(sc, p) ?? seriesEnd(sc, p) ?? p;
}

const isLoop = (e: El | undefined): boolean => !!e && e.loop !== undefined && !e.skip;

/** Where a Loop at p jumps back to: after the previous Loop in its series, or the series start. */
export function loopTop(sc: Score, p: Pos): Pos {
  let cur = p;
  for (let g = 0, n = sc.size; g <= n; g++) {
    const q = rawPrev(sc, cur);
    if (!q) return cur;
    if (samePos(q, p)) return rawNext(sc, p) ?? p;
    if (isLoop(sc.el(q))) return cur;
    cur = q;
  }
  return cur;
}

export interface HeadState {
  kind: Kind;
  /** The next element to examine. */
  pos: Pos;
  dir: Direction;
  /** Loop passes made, keyed by the Loop element's position. */
  loops: Record<string, number>;
  /** The element most recently read (for display, reversal and snapshots). */
  last: Pos | null;
}

export function newHead(kind: Kind, col: string, start: number, dir: Direction): HeadState {
  return { kind, pos: { col, i: start }, dir, loops: {}, last: null };
}

export function cloneHead(h: HeadState): HeadState {
  return { kind: h.kind, pos: { ...h.pos }, dir: h.dir, loops: { ...h.loops }, last: h.last ? { ...h.last } : null };
}

export interface Read {
  /** The element read, or null if the head found nothing readable. */
  pos: Pos | null;
  el: El | null;
  /** The value used (after randomisation), or null for a blank rest or nothing. */
  value: number | null;
  rest: RestMark | null;
  randomised: boolean;
}

export const NOTHING: Read = { pos: null, el: null, value: null, rest: null, randomised: false };

export interface ReadContext {
  score: Score;
  /** Absent for a peek: no randomisation and nothing is written. */
  rng?: Rng;
  choices?: EngineChoices;
  random?: Record<Kind, RandomSettings>;
  minTime?: number;
  pitchLimit?: number;
  /** Range of a Pit series at Start, for Pitch Limit. */
  pitchRange?: (p: Pos) => { lo: number; hi: number } | null;
  /** Called when auto-randomisation rewrites a stored value. */
  onChange?: (p: Pos) => void;
}

const ITERATION_GUARD = 4096;

/** Bring a head back inside the score after edits (deleted elements or columns). */
export function normalizeHead(head: HeadState, sc: Score): boolean {
  let c = sc.col(head.pos.col);
  if (!c || c.kind !== head.kind) {
    c = sc.ofKind(head.kind)[0];
    if (!c) return false;
    head.pos = { col: c.id, i: 0 };
    head.loops = {};
  }
  if (c.els.length === 0) {
    const nx = rawNext(sc, { col: c.id, i: -1 });
    if (!nx) return false;
    head.pos = nx;
  } else if (head.pos.i < 0 || head.pos.i >= c.els.length) {
    head.pos = { col: c.id, i: head.dir === 1 ? 0 : c.els.length - 1 };
  }
  return true;
}

/**
 * Read the next element under the head and advance it. Mutates the head
 * and, for `?` and `¿` elements, the stored value.
 */
export function readHead(head: HeadState, ctx: ReadContext): Read {
  const sc = ctx.score;
  if (!normalizeHead(head, sc)) return NOTHING;
  const choices = ctx.choices ?? DEFAULT_CHOICES;
  let p = head.pos;
  for (let g = 0; g < ITERATION_GUARD; g++) {
    const e = sc.el(p);
    if (!e) return NOTHING;
    if (e.skip) {
      p = step(sc, p, head.dir);
      continue;
    }
    if (e.loop !== undefined) {
      if (head.dir === -1) {
        p = step(sc, p, -1);
        continue;
      }
      const key = posKey(p);
      const done = head.loops[key] ?? 0;
      const limit = e.loop === 0 ? Infinity : choices.loopCount === 'repeats' ? e.loop : e.loop - 1;
      if (done < limit) {
        head.loops[key] = done + 1;
        p = loopTop(sc, p);
      } else {
        delete head.loops[key];
        p = step(sc, p, 1);
      }
      continue;
    }
    if (e.v === null && !e.rest) {
      p = step(sc, p, head.dir);
      continue;
    }
    head.last = p;
    head.pos = step(sc, p, head.dir);
    let value = e.v;
    let randomised = false;
    if (ctx.rng && e.ar && value !== null) {
      const col = sc.col(p.col)!;
      const set = col.rand ?? ctx.random?.[head.kind];
      if (set) {
        const prob = e.ar === 1 ? set.p1 : e.ar === 2 ? set.p2 : set.pw;
        if (prob > 0 && ctx.rng.next() * 100 < prob) {
          const d = randomDelta(set, ctx.rng);
          const moved = limitRandom(head.kind, value + d, ctx, p, col.rand);
          if (moved !== value) {
            randomised = true;
            value = moved;
            if (e.ar !== 3) {
              e.v = moved;
              ctx.onChange?.(p);
            }
          }
        }
      }
    }
    return { pos: p, el: e, value, rest: e.rest ?? null, randomised };
  }
  head.pos = p;
  return NOTHING;
}

/** The element the head would read next, without moving it or randomising. */
export function peekHead(head: HeadState, ctx: ReadContext): Read {
  return readHead(cloneHead(head), { score: ctx.score, choices: ctx.choices });
}

/**
 * Gaussian steps are scaled so that their average size is about Amount
 * (Fingers manual, chapter 6): mean |N(0, s)| = s * sqrt(2 / pi).
 */
export const GAUSS_SCALE = Math.sqrt(Math.PI / 2);

/** Random change according to Amount and Type. */
export function randomDelta(s: RandomSettings, rng: Rng): number {
  const { amount, type } = s;
  if (amount <= 0) return 0;
  if (type <= 0) return Math.round(rng.gauss() * amount * GAUSS_SCALE);
  const k = rng.int(1, Math.max(1, Math.floor(type)));
  return (rng.next() < 0.5 ? -1 : 1) * amount * k;
}

export function clampToKind(kind: Kind, v: number): number {
  const r = KIND_RANGE[kind];
  return Math.min(r.max, Math.max(r.min, Math.round(v)));
}

/** Limits for a randomised value: Minimum Time, Pitch Limit, column bounds, kind range. */
export function limitRandom(kind: Kind, v: number, ctx: ReadContext, p: Pos, col?: ColumnRandom): number {
  let x = Math.round(v);
  if (kind === 'time') x = Math.max(x, ctx.minTime ?? 1);
  if (kind === 'pitch') {
    const r = ctx.pitchRange?.(p);
    const lim = ctx.pitchLimit ?? 12;
    if (r) x = Math.min(r.hi + lim, Math.max(r.lo - lim, x));
  }
  if (col?.lo !== undefined) x = Math.max(x, col.lo);
  if (col?.hi !== undefined) x = Math.min(x, col.hi);
  return clampToKind(kind, x);
}

/** Value range of every Pit series, keyed by seriesKey (taken at Start, for Pitch Limit). */
export function pitchRanges(sc: Score): Map<string, { lo: number; hi: number }> {
  const out = new Map<string, { lo: number; hi: number }>();
  const seen = new Set<string>();
  for (const c of sc.ofKind('pitch')) {
    for (let i = 0; i < c.els.length; i++) {
      const p = { col: c.id, i };
      if (seen.has(posKey(p))) continue;
      const all = seriesPositions(sc, p);
      for (const q of all) seen.add(posKey(q));
      const vals = all.map((q) => sc.el(q)).filter((e): e is El => !!e && e.v !== null && e.loop === undefined).map((e) => e.v!);
      if (vals.length) out.set(seriesKey(sc, p), { lo: Math.min(...vals), hi: Math.max(...vals) });
    }
  }
  return out;
}

/**
 * Number of reads after which a lone forward head starting at the top of
 * this column repeats itself (ignoring randomisation and other heads). The
 * overall period of a line is the least common multiple of its heads' cycles.
 */
export function cycleLength(sc: Score, colId: string, choices: EngineChoices = DEFAULT_CHOICES): number {
  const c = sc.col(colId);
  if (!c || c.els.length === 0) return 0;
  const head = newHead(c.kind, colId, 0, 1);
  const key = () => `${posKey(head.pos)}|${JSON.stringify(head.loops)}`;
  const seen = new Map<string, number>();
  seen.set(key(), 0);
  for (let n = 1; n <= 20000; n++) {
    const r = readHead(head, { score: sc, choices });
    if (!r.pos) return 0;
    const k = key();
    const first = seen.get(k);
    if (first !== undefined) return n - first;
    seen.set(k, n);
  }
  return 0;
}
