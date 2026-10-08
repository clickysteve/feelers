/**
 * The Feelers project file format.
 *
 *   {
 *     "format": "feelers.project",
 *     "version": 2,
 *     "savedAt": "2026-10-08T12:00:00.000Z",
 *     "project": { ...Project }
 *   }
 *
 * Version 1 files (cells) are migrated on load (persistence/migrate.ts).
 * Loading is defensive: unknown fields are dropped, numbers are clamped to
 * their legal ranges, missing columns are filled with neutral defaults, and
 * heads pointing at a missing or wrong-kind column fall back to the first
 * column of the right kind. See docs/FORMAT.md.
 */
import { defaultLineScale, defaultRandom, fullBank, makeLine } from '../engine/factory';
import { QUANT_DIRS, SCALES, defaultGlobalScale } from '../engine/scale';
import type { AutoRand, Column, ColumnRandom, Direction, El, GlobalScale, HeadConfig, Kind, LineConfig, LineScale, Overlap, Project, QuantDir, RandomSettings, Snapshot } from '../engine/types';
import { KINDS, KIND_RANGE, LINE_COUNT, MAX_COLUMNS, MAX_ELS, MAX_LOOP, SNAPSHOT_SLOTS } from '../engine/types';
import { migrateV1, type MigrationReport } from './migrate';

export const FORMAT = 'feelers.project';
export const VERSION = 2;

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

export interface LoadResult {
  project: Project;
  /** Version the file was saved in. */
  from: number;
  /** What a migration changed (empty for a current file). */
  migration: string[];
}

/** Parse text (or an already parsed object) into a valid project, with a migration report. */
export function load(input: string | unknown): LoadResult {
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
  const report: MigrationReport = { notes: [] };
  const data = version === 1 ? migrateV1(raw.project, report) : raw.project;
  const project = normalizeProject(data);
  if (version === 1 && report.notes.length) {
    const note = `[Converted from Feelers format 1] ${report.notes.join(' ')}`;
    project.notes = (project.notes ? `${project.notes}\n\n${note}` : note).slice(0, 4000);
  }
  return { project, from: version, migration: report.notes };
}

/** Parse text (or an already parsed object) into a valid project. */
export function deserialize(input: string | unknown): Project {
  return load(input).project;
}

function normalizeEl(e: unknown, kind: Kind): El | null {
  if (!isObj(e)) return null;
  const r = KIND_RANGE[kind];
  const out: El = { v: null };
  if (e.loop !== undefined && e.loop !== null) {
    out.loop = int(e.loop, 0, 0, MAX_LOOP);
  } else if (e.v !== null && e.v !== undefined) {
    out.v = int(e.v, r.min, r.min, r.max);
  }
  if (e.end === true) out.end = true;
  if (e.skip === true) out.skip = true;
  if (out.loop === undefined && (e.rest === 'R' || e.rest === 'r')) out.rest = e.rest;
  if (out.loop === undefined && (e.ar === 1 || e.ar === 2 || e.ar === 3)) out.ar = e.ar as AutoRand;
  return out;
}

function normalizeRandom(v: unknown, kind: Kind): RandomSettings {
  const d = defaultRandom(kind);
  const o = isObj(v) ? v : {};
  return {
    amount: num(o.amount, d.amount, 0, 127),
    type: int(o.type, d.type, 0, 12),
    p1: num(o.p1, d.p1, 0, 100),
    p2: num(o.p2, d.p2, 0, 100),
    pw: num(o.pw, d.pw, 0, 100),
  };
}

function normalizeColumn(c: unknown): Column | null {
  if (!isObj(c) || !isKind(c.kind) || typeof c.id !== 'string' || !c.id) return null;
  const kind = c.kind;
  const els = (Array.isArray(c.els) ? c.els : [])
    .slice(0, MAX_ELS)
    .map((e) => normalizeEl(e, kind))
    .filter((e): e is El => e !== null);
  const out: Column = { id: c.id.slice(0, 16), kind, name: str(c.name, c.id, 24), link: bool(c.link, false), els };
  if (isObj(c.rand)) {
    const r = KIND_RANGE[kind];
    const rand: ColumnRandom = normalizeRandom(c.rand, kind);
    if (c.rand.lo !== undefined) rand.lo = int(c.rand.lo, r.min, r.min, r.max);
    if (c.rand.hi !== undefined) rand.hi = int(c.rand.hi, r.max, r.min, r.max);
    if (rand.lo !== undefined && rand.hi !== undefined && rand.lo > rand.hi) [rand.lo, rand.hi] = [rand.hi, rand.lo];
    out.rand = rand;
  }
  return out;
}

function normalizeHead(h: unknown, kind: Kind, bank: Column[]): HeadConfig {
  const fallback = bank.find((s) => s.kind === kind)!.id;
  if (!isObj(h)) return { col: fallback, start: 0, startDir: 1 };
  const c = typeof h.col === 'string' ? bank.find((x) => x.id === h.col && x.kind === kind) : undefined;
  return { col: c ? c.id : fallback, start: c ? int(h.start, 0, 0, Math.max(0, c.els.length - 1)) : 0, startDir: dir(h.startDir) };
}

const scaleId = (v: unknown, d: string): string => (typeof v === 'string' && SCALES.some((s) => s.id === v) ? v : d);
const quantDir = (v: unknown, d: QuantDir): QuantDir => (QUANT_DIRS.includes(v as QuantDir) ? (v as QuantDir) : d);

function normalizeLineScale(v: unknown): LineScale {
  const d = defaultLineScale();
  const o = isObj(v) ? v : {};
  return {
    mode: o.mode === 'own' || o.mode === 'off' ? o.mode : 'global',
    root: int(o.root, d.root, 0, 11),
    scale: scaleId(o.scale, d.scale),
    dir: quantDir(o.dir, d.dir),
  };
}

function normalizeGlobalScale(v: unknown): GlobalScale {
  const d = defaultGlobalScale();
  const o = isObj(v) ? v : {};
  return { on: bool(o.on, d.on), root: int(o.root, d.root, 0, 11), scale: scaleId(o.scale, d.scale), dir: quantDir(o.dir, d.dir) };
}

const OVERLAPS: Overlap[] = ['written', 'legato', 'mono'];

function normalizeLine(l: unknown, i: number, bank: Column[]): LineConfig {
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
    overlap: OVERLAPS.includes(l.overlap as Overlap) ? (l.overlap as Overlap) : d.overlap,
    mute: bool(l.mute, false),
    scale: normalizeLineScale(l.scale),
    heads: {} as LineConfig['heads'],
  };
  for (const k of KINDS) out.heads[k] = normalizeHead(heads[k], k, bank);
  return out;
}

function normalizeSnapshot(s: unknown, bank: Column[]): Snapshot | null {
  if (!isObj(s) || !Array.isArray(s.lines)) return null;
  const lines = s.lines.slice(0, LINE_COUNT).map((l) => {
    const o = isObj(l) ? l : {};
    const hs = isObj(o.heads) ? o.heads : {};
    const heads = {} as Snapshot['lines'][number]['heads'];
    for (const k of KINDS) {
      const h = isObj(hs[k]) ? (hs[k] as Obj) : {};
      const c = typeof h.col === 'string' ? bank.find((x) => x.id === h.col && x.kind === k) : undefined;
      heads[k] = { col: c ? c.id : bank.find((x) => x.kind === k)!.id, pos: c ? int(h.pos, 0, 0, Math.max(0, c.els.length - 1)) : 0, dir: dir(h.dir) };
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
  const given = (Array.isArray(p.columns) ? p.columns : []).map(normalizeColumn).filter((s): s is Column => s !== null);
  // Keep unique ids only; then make sure every standard column exists.
  const seen = new Set<string>();
  const unique = given.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  const bank = fullBank(unique).slice(0, MAX_COLUMNS);
  const lines = Array.from({ length: LINE_COUNT }, (_, i) => normalizeLine(Array.isArray(p.lines) ? p.lines[i] : null, i, bank));
  const opts = isObj(p.options) ? p.options : {};
  const snaps = Array.isArray(p.snapshots) ? p.snapshots : [];
  const random = isObj(p.random) ? p.random : {};
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
    columns: bank,
    random: { time: normalizeRandom(random.time, 'time'), pitch: normalizeRandom(random.pitch, 'pitch'), velocity: normalizeRandom(random.velocity, 'velocity'), artic: normalizeRandom(random.artic, 'artic') },
    minTime: int(p.minTime, 1, 1, 999),
    pitchLimit: int(p.pitchLimit, 12, 0, 127),
    scale: normalizeGlobalScale(p.scale),
    lines,
    snapshots: Array.from({ length: SNAPSHOT_SLOTS }, (_, i) => normalizeSnapshot(snaps[i], bank)),
  };
}
