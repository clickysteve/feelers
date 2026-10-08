/**
 * The Feelers project file format.
 *
 *   {
 *     "format": "feelers.project",
 *     "version": 1,
 *     "savedAt": "2026-10-08T12:00:00.000Z",
 *     "project": { ...Project }
 *   }
 *
 * Loading is defensive: unknown fields are dropped, numbers are clamped to
 * their legal ranges, missing series are filled with neutral defaults, and
 * heads pointing at a missing or wrong-kind series fall back to the first
 * series of the right kind. See docs/FORMAT.md.
 */
import { fullBank, makeLine } from '../engine/factory';
import type { Cell, Direction, HeadConfig, Kind, LineConfig, Project, Series, Snapshot } from '../engine/types';
import { KINDS, KIND_RANGE, LINE_COUNT, MAX_CELLS, SNAPSHOT_SLOTS } from '../engine/types';

export const FORMAT = 'feelers.project';
export const VERSION = 1;

export interface ProjectFile {
  format: typeof FORMAT;
  version: number;
  savedAt: string;
  project: Project;
}

export class ProjectFormatError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const int = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number => Math.round(num(v, d, lo, hi));
const str = (v: unknown, d: string, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const dir = (v: unknown): Direction => (v === -1 ? -1 : 1);
const isKind = (v: unknown): v is Kind => typeof v === 'string' && (KINDS as readonly string[]).includes(v);

export function serialize(project: Project): string {
  const file: ProjectFile = { format: FORMAT, version: VERSION, savedAt: new Date().toISOString(), project };
  return JSON.stringify(file, null, 2);
}

/** Parse text (or an already parsed object) into a valid project. */
export function deserialize(input: string | unknown): Project {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new ProjectFormatError('Not a JSON file.');
    }
  }
  if (!isObj(raw) || raw.format !== FORMAT) throw new ProjectFormatError('Not a Feelers project file.');
  const version = int(raw.version, 0);
  if (version < 1) throw new ProjectFormatError('Unknown project version.');
  if (version > VERSION) throw new ProjectFormatError(`This file was saved by a newer Feelers (format v${version}).`);
  return normalizeProject(migrate(raw.project, version));
}

/** Upgrade older formats. Version 1 is current, so this is the identity. */
function migrate(p: unknown, _version: number): unknown {
  return p;
}

function normalizeCell(c: unknown, kind: Kind): Cell | null {
  if (!isObj(c)) return null;
  const r = KIND_RANGE[kind];
  switch (c.t) {
    case 'v': {
      const v = int(c.v, r.min, r.min, r.max);
      const rf = c.r === 1 || c.r === 2 ? c.r : 0;
      return rf ? { t: 'v', v, r: rf } : { t: 'v', v };
    }
    case 'close':
      return { t: 'close', n: int(c.n, 2, 1, 999) };
    case 'skip':
    case 'rest':
    case 'open':
    case 'end':
    case 'link':
      return { t: c.t };
  }
  return null;
}

function normalizeSeries(s: unknown): Series | null {
  if (!isObj(s) || !isKind(s.kind) || typeof s.id !== 'string') return null;
  const kind = s.kind;
  const r = KIND_RANGE[kind];
  const cells = (Array.isArray(s.cells) ? s.cells : [])
    .slice(0, MAX_CELLS)
    .map((c) => normalizeCell(c, kind))
    .filter((c): c is Cell => c !== null);
  const rand = isObj(s.rand) ? s.rand : {};
  const lo = int(s.lo, r.min, r.min, r.max);
  const hi = int(s.hi, r.max, r.min, r.max);
  return {
    id: s.id.slice(0, 16),
    kind,
    name: str(s.name, s.id, 24),
    cells,
    rand: { amount: num(rand.amount, 2, 0, 127), type: int(rand.type, 0, 0, 12), prob: num(rand.prob, 50, 0, 100) },
    lo: Math.min(lo, hi),
    hi: Math.max(lo, hi),
  };
}

function normalizeHead(h: unknown, kind: Kind, bank: Series[]): HeadConfig {
  const fallback = bank.find((s) => s.kind === kind)!.id;
  if (!isObj(h)) return { series: fallback, start: 0, startDir: 1 };
  const s = typeof h.series === 'string' ? bank.find((x) => x.id === h.series && x.kind === kind) : undefined;
  return { series: s ? s.id : fallback, start: int(h.start, 0, 0, MAX_CELLS - 1), startDir: dir(h.startDir) };
}

function normalizeLine(l: unknown, i: number, bank: Series[]): LineConfig {
  const d = makeLine(i, {});
  if (!isObj(l)) {
    for (const k of KINDS) d.heads[k] = normalizeHead(null, k, bank);
    return d;
  }
  const heads = isObj(l.heads) ? l.heads : {};
  const out: LineConfig = {
    name: str(l.name, d.name, 24),
    channel: int(l.channel, d.channel, 1, 16),
    program: l.program === null || l.program === undefined ? null : int(l.program, 0, 0, 127),
    transpose: int(l.transpose, 0, -48, 48),
    velOffset: int(l.velOffset, 0, -127, 127),
    timeScale: num(l.timeScale, 1, 0.05, 16),
    delay: num(l.delay, 0, 0, 9999),
    legato: bool(l.legato, false),
    mute: bool(l.mute, false),
    heads: {} as LineConfig['heads'],
  };
  for (const k of KINDS) out.heads[k] = normalizeHead(heads[k], k, bank);
  return out;
}

function normalizeSnapshot(s: unknown, bank: Series[]): Snapshot | null {
  if (!isObj(s) || !Array.isArray(s.lines)) return null;
  const lines = s.lines.slice(0, LINE_COUNT).map((l) => {
    const o = isObj(l) ? l : {};
    const hs = isObj(o.heads) ? o.heads : {};
    const heads = {} as Snapshot['lines'][number]['heads'];
    for (const k of KINDS) {
      const h = isObj(hs[k]) ? (hs[k] as Obj) : {};
      const ok = typeof h.series === 'string' && bank.some((x) => x.id === h.series && x.kind === k);
      heads[k] = { series: ok ? (h.series as string) : bank.find((x) => x.kind === k)!.id, pos: int(h.pos, 0, 0, MAX_CELLS - 1), dir: dir(h.dir) };
    }
    return {
      heads,
      paused: bool(o.paused, false),
      mute: bool(o.mute, false),
      transpose: int(o.transpose, 0, -48, 48),
      velOffset: int(o.velOffset, 0, -127, 127),
      timeScale: num(o.timeScale, 1, 0.05, 16),
    };
  });
  if (lines.length !== LINE_COUNT) return null;
  return { tempo: num(s.tempo, 120, 10, 400), lines };
}

export function normalizeProject(p: unknown): Project {
  if (!isObj(p)) throw new ProjectFormatError('Project data is missing.');
  const given = (Array.isArray(p.series) ? p.series : []).map(normalizeSeries).filter((s): s is Series => s !== null);
  // Keep unique ids only; then make sure every standard slot exists.
  const seen = new Set<string>();
  const unique = given.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  const standard = fullBank(unique);
  const extras = unique.filter((s) => !standard.some((x) => x.id === s.id));
  const bank = [...standard, ...extras];
  const lines = Array.from({ length: LINE_COUNT }, (_, i) => normalizeLine(Array.isArray(p.lines) ? p.lines[i] : null, i, bank));
  const opts = isObj(p.options) ? p.options : {};
  const snaps = Array.isArray(p.snapshots) ? p.snapshots : [];
  return {
    name: str(p.name, 'Untitled', 80),
    notes: str(p.notes, '', 4000),
    tempo: num(p.tempo, 110, 10, 400),
    seed: int(p.seed, 1988, 0, 2 ** 32 - 1),
    options: {
      clockOut: bool(opts.clockOut, false),
      programOnStart: bool(opts.programOnStart, true),
      shiftEdit: bool(opts.shiftEdit, false),
    },
    series: bank,
    lines,
    snapshots: Array.from({ length: SNAPSHOT_SLOTS }, (_, i) => normalizeSnapshot(snaps[i], bank)),
  };
}

