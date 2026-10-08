/**
 * Helpers for building projects, used by demos, tests and "New".
 */
import { defaultGlobalScale } from './scale';
import type { AutoRand, Column, Direction, El, Kind, LineConfig, LineScale, Project, RandomSettings } from './types';
import { KINDS, MAX_ELS, SNAPSHOT_SLOTS } from './types';

export const COLUMNS_PER_KIND = 4;

const PREFIX: Record<Kind, string> = { time: 'T', pitch: 'P', velocity: 'V', artic: 'S' };

export function columnId(kind: Kind, n: number): string {
  return `${PREFIX[kind]}${n}`;
}

const TOKEN = /^(-?\d+|[A-Ga-g][#b]?-?\d|_|L\d+)([?¿~RrS|]*)$/;

/**
 * Parse a compact column notation into elements. Tokens are separated by
 * whitespace. Each is a value, a blank or a Loop, followed by any marks:
 *
 *   12  C4  F#3     value (Time / Velocity / S/L number, or a note name)
 *   _               blank element
 *   L2  L0          Loop element (repeat count; 0 = forever)
 *   ?   ??  (or ¿)  auto-randomise with the first / second probability
 *   ~               WOBBLE (Feelers extension: the stored value is kept)
 *   R   r           Rest (only Tim and this head advance) / rest (all advance)
 *   S               Skip this element
 *   |               End of Series after this element
 *   +               (a token on its own) Column Link to the next column of this kind
 *
 * For example `C4 E4R G4? L1 D4S B3|` or `12 12 6 6 +`.
 */
export function parseColumn(src: string): { els: El[]; link: boolean } {
  const els: El[] = [];
  let link = false;
  for (const tok of src.trim().split(/\s+/).filter(Boolean)) {
    if (tok === '+') {
      link = true;
      continue;
    }
    const m = TOKEN.exec(tok);
    if (!m) throw new Error(`Bad column token: ${tok}`);
    const core = m[1]!;
    let marks = m[2]!;
    const el: El = { v: null };
    if (core === '_') el.v = null;
    else if (core.startsWith('L')) el.loop = Number(core.slice(1));
    else {
      const n = /^-?\d+$/.test(core) ? Number(core) : noteNumber(core);
      if (n === null) throw new Error(`Bad column token: ${tok}`);
      el.v = n;
    }
    let ar: AutoRand | undefined;
    if (marks.includes('??') || marks.includes('¿')) ar = 2;
    else if (marks.includes('?')) ar = 1;
    else if (marks.includes('~')) ar = 3;
    marks = marks.replace(/[?¿~]/g, '');
    if (ar && el.loop === undefined) el.ar = ar;
    if (marks.includes('R')) el.rest = 'R';
    else if (marks.includes('r')) el.rest = 'r';
    if (marks.includes('S')) el.skip = true;
    if (marks.includes('|')) el.end = true;
    if (el.loop !== undefined) delete el.rest;
    els.push(el);
  }
  if (els.length > MAX_ELS) throw new Error(`A column holds at most ${MAX_ELS} elements (got ${els.length}).`);
  return { els, link };
}

/** Write elements back in the notation of parseColumn. */
export function formatColumn(c: Pick<Column, 'els' | 'link' | 'kind'>): string {
  const toks = c.els.map((e) => {
    let s = e.loop !== undefined ? `L${e.loop}` : e.v === null ? '_' : c.kind === 'pitch' ? noteName(e.v) : String(e.v);
    if (e.ar === 1) s += '?';
    else if (e.ar === 2) s += '??';
    else if (e.ar === 3) s += '~';
    if (e.rest) s += e.rest;
    if (e.skip) s += 'S';
    if (e.end) s += '|';
    return s;
  });
  if (c.link) toks.push('+');
  return toks.join(' ');
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI note number to name, with C4 = 60. */
export function noteName(n: number): string {
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

/** Note name (C4 = 60, sharps or flats) to MIDI number, or null. */
export function noteNumber(name: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name.trim());
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]!.toUpperCase() as 'C'];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const n = (Number(m[3]) + 1) * 12 + base + acc;
  return n >= 0 && n <= 127 ? n : null;
}

export function makeColumn(kind: Kind, n: number, src: string, opts: Partial<Column> = {}): Column {
  const parsed = parseColumn(src);
  return { id: columnId(kind, n), kind, name: columnId(kind, n), link: parsed.link, els: parsed.els, ...opts };
}

export function defaultRandom(kind: Kind): RandomSettings {
  const amount = { time: 6, pitch: 2, velocity: 10, artic: 2 }[kind];
  return { amount, type: 0, p1: 50, p2: 5, pw: 50 };
}

export function defaultLineScale(): LineScale {
  return { mode: 'global', root: 0, scale: 'major', dir: 'nearest' };
}

type HeadSpec = string | [string, number, Direction?];

export function makeLine(i: number, heads: Partial<Record<Kind, HeadSpec>>, opts: Partial<LineConfig> = {}): LineConfig {
  const h = {} as LineConfig['heads'];
  for (const k of KINDS) {
    const spec = heads[k] ?? columnId(k, 1);
    if (typeof spec === 'string') h[k] = { col: spec, start: 0, startDir: 1 };
    else h[k] = { col: spec[0], start: spec[1], startDir: spec[2] ?? 1 };
  }
  return {
    name: `Feeler ${i + 1}`,
    channel: i + 1,
    program: null,
    transpose: 0,
    velOffset: 0,
    timeScale: 1,
    delay: 0,
    overlap: 'written',
    mute: false,
    scale: defaultLineScale(),
    heads: h,
    ...opts,
  };
}

/**
 * Fill a bank so that every kind has COLUMNS_PER_KIND columns, keeping any
 * provided ones (and any extra columns, after the standard ones).
 */
export function fullBank(given: Column[]): Column[] {
  const neutral: Record<Kind, string> = { time: '12', pitch: 'C4', velocity: '90', artic: '13' };
  const bank: Column[] = [];
  for (const k of KINDS) {
    const ofKind = given.filter((c) => c.kind === k);
    const std = Array.from({ length: COLUMNS_PER_KIND }, (_, n) => columnId(k, n + 1));
    // Extra columns keep their place after the column they followed (links run left to right).
    const isStd = (c: Column) => std.includes(c.id);
    let i = 0;
    while (i < ofKind.length && !isStd(ofKind[i]!)) bank.push(ofKind[i++]!);
    for (let n = 1; n <= COLUMNS_PER_KIND; n++) {
      const id = columnId(k, n);
      const at = ofKind.findIndex((c) => c.id === id);
      bank.push(at === -1 ? makeColumn(k, n, neutral[k]) : ofKind[at]!);
      if (at !== -1) for (let j = at + 1; j < ofKind.length && !isStd(ofKind[j]!); j++) bank.push(ofKind[j]!);
    }
  }
  return bank;
}

export function makeProject(p: Partial<Project> & { columns: Column[]; lines: LineConfig[] }): Project {
  return {
    name: 'Untitled',
    notes: '',
    tempo: 110,
    seed: 1988,
    options: { clockOut: false, programOnStart: true, shiftEdit: false },
    random: { time: defaultRandom('time'), pitch: defaultRandom('pitch'), velocity: defaultRandom('velocity'), artic: defaultRandom('artic') },
    minTime: 1,
    pitchLimit: 12,
    scale: defaultGlobalScale(),
    snapshots: Array.from({ length: SNAPSHOT_SLOTS }, () => null),
    ...p,
    columns: fullBank(p.columns),
  };
}
