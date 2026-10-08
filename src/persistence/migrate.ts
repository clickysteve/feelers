/**
 * Migration of Feelers project format v1 (cells) to v2 (columns of elements
 * with attributes). See docs/FORMAT.md, "Migrating version 1 projects".
 *
 * Aim: an old project keeps all its material and, wherever the new model can
 * express it, sounds the same. Where it cannot, the conversion is the closest
 * equivalent and is listed in the migration report (which is also appended
 * to the project notes, so nothing changes silently).
 *
 *  - Values keep their order. Articulation percent becomes S/L sixteenths.
 *  - WOBBLE (v1 `?`) stays WOBBLE; DRIFT (v1 `~`) becomes the Fingers `?`
 *    (persistent). Per-series randomisation becomes a per-column setting.
 *  - SKIP marks the value it used to jump. REST in a Pitch / Velocity / S/L
 *    series becomes a blank element with a rest (r); in a Time series it
 *    silences the same note as before.
 *  - Bracket loops become Loop elements when the bracket starts the series
 *    or follows another loop; other loops are written out in full.
 *  - END marks the last active element; later (dormant) cells are kept as a
 *    separate series below it. LINK becomes the column's Link flag.
 *  - Series longer than 16 elements continue in an added, linked column.
 *  - Time heads start one element earlier: v1 read a note's Time value as the
 *    gap *after* it, v2 as the gap *before* it, so this keeps every note's
 *    rhythm and length.
 *  - v1 limits clamped every value read; stored values outside them are
 *    clamped once, and the limits become bounds for randomised values only.
 */
import { DEFAULT_CHOICES } from '../engine/choices';
import { defaultLineScale, defaultRandom } from '../engine/factory';
import { GAUSS_SCALE, Score, cloneHead, newHead, readHead } from '../engine/series';
import type { AutoRand, Column, ColumnRandom, Direction, El, Kind, Pos } from '../engine/types';
import { KINDS, KIND_RANGE, MAX_COLUMNS, MAX_ELS } from '../engine/types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isKind = (v: unknown): v is Kind => typeof v === 'string' && (KINDS as readonly string[]).includes(v);

const V1_PREFIX: Record<Kind, string> = { time: 'T', pitch: 'P', velocity: 'V', artic: 'A' };
const V2_PREFIX: Record<Kind, string> = { time: 'T', pitch: 'P', velocity: 'V', artic: 'S' };

/** Map a v1 series id to its v2 column id (A1-A4 become S1-S4). */
export function v2Id(id: string, kind: Kind): string {
  return id.startsWith(V1_PREFIX[kind]) && kind === 'artic' ? V2_PREFIX[kind] + id.slice(1) : id;
}

/** v1 articulation percent to S/L sixteenths. */
export function articToSL(pct: number): number {
  return Math.min(KIND_RANGE.artic.max, Math.max(KIND_RANGE.artic.min, Math.round((pct * 16) / 100)));
}

interface V1Cell {
  t: string;
  v?: number;
  r?: number;
  n?: number;
}

type Item = { kind: 'cell'; cell: V1Cell; src: number } | { kind: 'loop'; n: number; body: Item[]; src: number };

/** Build a tree of bracket loops from a flat cell list (unmatched brackets dropped, as v1 ignored them). */
function tree(cells: V1Cell[], offset: number): Item[] {
  const root: Item[] = [];
  const stack: { items: Item[]; src: number }[] = [{ items: root, src: -1 }];
  cells.forEach((c, i) => {
    if (c.t === 'open') stack.push({ items: [], src: offset + i });
    else if (c.t === 'close') {
      if (stack.length > 1) {
        const top = stack.pop()!;
        stack[stack.length - 1]!.items.push({ kind: 'loop', n: Math.max(1, Math.round(num(c.n, 2))), body: top.items, src: top.src });
      }
    } else stack[stack.length - 1]!.items.push({ kind: 'cell', cell: c, src: offset + i });
  });
  while (stack.length > 1) {
    const top = stack.pop()!;
    stack[stack.length - 1]!.items.push(...top.items);
  }
  return root;
}

interface Proto {
  el: El;
  /** v1 cell index this element came from (first copy only). */
  src: number;
  /** A v1 time REST preceded this value. */
  silentGap?: boolean;
}

const UNROLL_LIMIT = 48;

function size(items: Item[]): number {
  let n = 0;
  for (const it of items) n += it.kind === 'cell' ? 1 : it.n * size(it.body);
  return n;
}

export interface MigrationReport {
  notes: string[];
}

class ColumnBuilder {
  out: Proto[] = [];
  private skip = false;
  private silent = false;
  private seen = new Set<number>();
  constructor(
    private kind: Kind,
    private report: MigrationReport,
    private name: string,
  ) {}

  private value(c: V1Cell, src: number): void {
    const r = KIND_RANGE[this.kind];
    let v = Math.round(num(c.v, r.min));
    if (this.kind === 'artic') v = articToSL(v);
    v = Math.min(r.max, Math.max(r.min, v));
    const el: El = { v };
    const ar: AutoRand | undefined = c.r === 2 ? 1 : c.r === 1 ? 3 : undefined;
    if (ar) el.ar = ar;
    this.push(el, src);
  }

  private push(el: El, src: number): void {
    if (this.skip) {
      el.skip = true;
      this.skip = false;
    }
    const p: Proto = { el, src: this.seen.has(src) ? -1 : src };
    this.seen.add(src);
    if (this.silent) {
      p.silentGap = true;
      this.silent = false;
    }
    this.out.push(p);
  }

  emit(items: Item[]): void {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (it.kind === 'cell') {
        const c = it.cell;
        if (c.t === 'v') this.value(c, it.src);
        else if (c.t === 'skip') this.skip = true;
        else if (c.t === 'rest') {
          if (this.kind === 'time') this.silent = true;
          else this.push({ v: null, rest: 'r' }, it.src);
        }
        continue;
      }
      // A bracket loop.
      if (it.n === 1) {
        this.emit(it.body);
        continue;
      }
      const prev = this.out[this.out.length - 1];
      const atTop = !prev || prev.el.loop !== undefined;
      const flat = it.body.every((b) => b.kind === 'cell');
      if (atTop && flat && size(it.body) > 0) {
        this.emit(it.body);
        this.out.push({ el: { v: null, loop: DEFAULT_CHOICES.loopCount === 'repeats' ? it.n - 1 : it.n }, src: -1 });
      } else if (size([it]) <= UNROLL_LIMIT) {
        for (let k = 0; k < it.n; k++) this.emit(it.body);
      } else {
        this.emit(it.body);
        this.out.push({ el: { v: null, loop: DEFAULT_CHOICES.loopCount === 'repeats' ? it.n - 1 : it.n }, src: -1 });
        this.report.notes.push(`${this.name}: a ${it.n}x loop that did not start its series is now a Loop element, which repeats from the start of the series. Check this passage.`);
      }
    }
  }
}

interface Converted {
  cols: Column[];
  /** v1 cell index -> [column id, element index] of the element a head starting there reads first. */
  map: (cell: number) => Pos;
  silent: Pos[];
}

/** Convert one v1 series to one or more v2 columns (more when it overflows). */
function convertSeries(s: Obj, kind: Kind, report: MigrationReport): Converted | null {
  if (typeof s.id !== 'string') return null;
  const id = v2Id(s.id.slice(0, 16), kind);
  const name = typeof s.name === 'string' ? s.name.slice(0, 24) : id;
  const cells: V1Cell[] = (Array.isArray(s.cells) ? s.cells : []).filter(isObj).map((c) => c as unknown as V1Cell);
  const endAt = cells.findIndex((c) => c.t === 'end');
  const active = endAt === -1 ? cells : cells.slice(0, endAt);
  const dormant = endAt === -1 ? [] : cells.slice(endAt + 1);
  const linkAt = active.findIndex((c) => c.t === 'link');
  const linked = linkAt !== -1;
  const reach = linked ? active.slice(0, linkAt) : active;
  const unreachable = linked ? active.slice(linkAt + 1).filter((c) => c.t !== 'link') : [];

  const main = new ColumnBuilder(kind, report, name);
  main.emit(tree(reach, 0));
  if (main.out.length === 0 && reach.length > 0) report.notes.push(`${name}: held only control cells; it is now empty.`);
  const rest = new ColumnBuilder(kind, report, name);
  rest.emit(tree([...unreachable, ...dormant], linked ? linkAt + 1 : endAt + 1));
  if (main.out.length && (endAt !== -1 || rest.out.length)) main.out[main.out.length - 1]!.el.end = true;
  if (endAt === 0) report.notes.push(`${name}: started with END, so heads read nothing; its dormant cells are now a playable series.`);

  // Randomisation and limits.
  const r = KIND_RANGE[kind];
  const rand = isObj(s.rand) ? s.rand : {};
  // v1 ranges: articulation was a percentage, 1-400.
  const v1max = kind === 'artic' ? 400 : r.max;
  const conv = (v: number) => (kind === 'artic' ? articToSL(v) : Math.round(v));
  const lo = conv(Math.min(v1max, Math.max(r.min, num(s.lo, r.min))));
  const hi = conv(Math.min(v1max, Math.max(r.min, num(s.hi, v1max))));
  const [blo, bhi] = [Math.min(lo, hi), Math.max(lo, hi)];
  let clamped = 0;
  for (const p of [...main.out, ...rest.out]) {
    if (p.el.v !== null && (p.el.v < blo || p.el.v > bhi)) {
      p.el.v = Math.min(bhi, Math.max(blo, p.el.v));
      clamped++;
    }
  }
  if (clamped) report.notes.push(`${name}: ${clamped} value(s) outside the old limits were set to the limit they always played at.`);
  const hasRand = [...main.out, ...rest.out].some((p) => p.el.ar);
  const limited = blo > r.min || bhi < r.max;
  let colRand: ColumnRandom | undefined;
  if (hasRand || limited) {
    const type = Math.max(0, Math.min(12, Math.round(num(rand.type, 0))));
    let amount = Math.max(0, num(rand.amount, 2));
    if (kind === 'artic') amount = Math.max(type > 0 ? 1 : 0, Math.round((amount * 16) / 100 * 100) / 100);
    // Keep the same spread: v1 used Amount as the standard deviation.
    if (type === 0) amount = Math.round((amount / GAUSS_SCALE) * 100) / 100;
    const prob = Math.min(100, Math.max(0, num(rand.prob, 50)));
    colRand = { amount, type, p1: prob, p2: prob, pw: prob };
    if (blo > r.min) colRand.lo = blo;
    if (bhi < r.max) colRand.hi = bhi;
  }

  // Lay the elements out in columns of 16; extra columns are linked in.
  const all = [...main.out, ...rest.out];
  const chunks: Proto[][] = [];
  for (let i = 0; i < all.length; i += MAX_ELS) chunks.push(all.slice(i, i + MAX_ELS));
  if (chunks.length === 0) chunks.push([]);
  if (chunks.length > 1) report.notes.push(`${name}: longer than 16 elements, so it continues in ${chunks.length - 1} added column(s), linked in.`);
  const cols: Column[] = chunks.map((ch, k) => ({
    id: k === 0 ? id : `${id}${String.fromCharCode(96 + k)}`,
    kind,
    name: k === 0 ? name : `${name}${String.fromCharCode(96 + k)}`,
    link: k < chunks.length - 1 ? true : linked,
    els: ch.map((p) => p.el),
    ...(colRand ? { rand: { ...colRand } } : {}),
  }));
  if (linked) {
    report.notes.push(
      `${name}: its LINK is now a Fingers Column Link, which joins it and the next column of the same kind into one series. ` +
        'At the end of that column the head now returns to the top of the first linked column (before, it stayed in the column it had linked into).',
    );
  }
  if (linked && rest.out.length) {
    report.notes.push(`${name}: cells after its LINK or END are kept above the linked part's end; the linked part now ends the column. Check the head start.`);
  }
  const locate = (n: number): Pos => {
    const k = Math.floor(n / MAX_ELS);
    return { col: cols[Math.min(k, cols.length - 1)]!.id, i: n % MAX_ELS };
  };
  const map = (cell: number): Pos => {
    // First element converted from this cell or any later one in the active part.
    for (let j = 0; j < main.out.length; j++) if (main.out[j]!.src >= cell) return locate(j);
    return locate(0);
  };
  const silent = all.map((p, j) => (p.silentGap ? locate(j) : null)).filter((p): p is Pos => p !== null);
  // A linked part with leftovers: put the leftovers first so the linked part ends the column.
  if (linked && rest.out.length && cols.length === 1) {
    const els = [...rest.out.map((p) => p.el), ...main.out.map((p) => p.el)];
    const shift = rest.out.length;
    for (const e of els) delete e.end;
    if (rest.out.length) els[shift - 1]!.end = true;
    cols[0]!.els = els;
    return {
      cols,
      map: (cell) => {
        const p = map(cell);
        return { col: p.col, i: p.i + shift };
      },
      silent: silent.map((p) => ({ col: p.col, i: p.i + shift })),
    };
  }
  return { cols, map, silent };
}

/** The element a head moving against `dir` reads just before `p`. */
function before(sc: Score, kind: Kind, p: Pos, dir: Direction): Pos {
  const h = newHead(kind, p.col, p.i, dir === 1 ? -1 : 1);
  const ctx = { score: sc };
  const first = readHead(h, ctx);
  const second = readHead(cloneHead(h), ctx);
  return second.pos ?? first.pos ?? p;
}

/** Upgrade a v1 project object to the v2 shape (to be normalised afterwards). */
export function migrateV1(p: unknown, report: MigrationReport): unknown {
  if (!isObj(p)) return p;
  const series = (Array.isArray(p.series) ? p.series : []).filter(isObj).filter((s) => isKind(s.kind));
  const maps = new Map<string, Converted>();
  const byKind: Record<Kind, Column[]> = { time: [], pitch: [], velocity: [], artic: [] };
  const seen = new Set<string>();
  for (const s of series) {
    const kind = s.kind as Kind;
    if (typeof s.id !== 'string' || seen.has(s.id)) continue;
    seen.add(s.id);
    const c = convertSeries(s, kind, report);
    if (!c) continue;
    maps.set(s.id, c);
    byKind[kind].push(...c.cols);
  }
  let columns = KINDS.flatMap((k) => byKind[k]);
  if (columns.length > MAX_COLUMNS) {
    report.notes.push(`More than ${MAX_COLUMNS} columns after conversion; the last ones were dropped.`);
    columns = columns.slice(0, MAX_COLUMNS);
  }
  const sc = new Score(columns);

  // A Time REST silenced the note whose gap-after was the next value; in v2
  // the note before that value's note carries the rest.
  for (const c of maps.values()) {
    for (const p of c.silent) {
      const k = sc.col(p.col)?.kind;
      if (k !== 'time') continue;
      const prev = before(sc, 'time', p, 1);
      const e = sc.el(prev);
      if (e && e.loop === undefined) e.rest = 'r';
    }
  }

  const headPos = (kind: Kind, v1series: unknown, cell: unknown, dir: Direction): { col: string; i: number } => {
    const conv = typeof v1series === 'string' ? maps.get(v1series) : undefined;
    const fallback = columns.find((c) => c.kind === kind);
    if (!conv || conv.cols[0]!.kind !== kind) return { col: fallback?.id ?? `${V2_PREFIX[kind]}1`, i: 0 };
    let pos = conv.map(Math.max(0, Math.round(num(cell, 0))));
    if (kind === 'time') pos = before(sc, 'time', pos, dir);
    return pos;
  };

  const lines = (Array.isArray(p.lines) ? p.lines : []).map((l) => {
    const o = isObj(l) ? l : {};
    const heads = isObj(o.heads) ? o.heads : {};
    const out: Obj = { ...o };
    delete out.legato;
    out.overlap = o.legato === true ? 'legato' : 'mono';
    out.scale = defaultLineScale();
    const hs: Obj = {};
    for (const k of KINDS) {
      const h = isObj(heads[k]) ? (heads[k] as Obj) : {};
      const dir: Direction = h.startDir === -1 ? -1 : 1;
      const pos = headPos(k, h.series, h.start, dir);
      hs[k] = { col: pos.col, start: pos.i, startDir: dir };
    }
    out.heads = hs;
    return out;
  });

  const snapshots = (Array.isArray(p.snapshots) ? p.snapshots : []).map((s) => {
    if (!isObj(s) || !Array.isArray(s.lines)) return null;
    return {
      ...s,
      lines: s.lines.map((l) => {
        const o = isObj(l) ? l : {};
        const hs = isObj(o.heads) ? o.heads : {};
        const heads: Obj = {};
        for (const k of KINDS) {
          const h = isObj(hs[k]) ? (hs[k] as Obj) : {};
          const dir: Direction = h.dir === -1 ? -1 : 1;
          const pos = headPos(k, h.series, h.pos, dir);
          heads[k] = { col: pos.col, pos: pos.i, dir };
        }
        return { ...o, heads };
      }),
    };
  });

  if (series.some((s) => (Array.isArray(s.cells) ? s.cells : []).some((c) => isObj(c) && (c.t === 'open' || c.t === 'close')))) {
    report.notes.push('Loops now follow Fingers: they are ignored by heads moving backwards.');
  }
  if (series.some((s) => (Array.isArray(s.cells) ? s.cells : []).some((c) => isObj(c) && c.r === 2))) {
    report.notes.push('DRIFT cells are now Fingers ? cells (the change is kept); use RESTORE to return to the values at Start.');
  }
  report.notes.push('Time is now the wait before each note: Time heads start one element earlier so the rhythm is unchanged.');

  return {
    ...p,
    columns,
    random: { time: defaultRandom('time'), pitch: defaultRandom('pitch'), velocity: defaultRandom('velocity'), artic: defaultRandom('artic') },
    minTime: 1,
    // v1 had no Pitch Limit; per-column bounds carry the old limits.
    pitchLimit: 127,
    lines,
    snapshots,
  };
}
