/**
 * Helpers for building projects, used by demos, tests and "New".
 */
import type { Cell, Direction, Kind, LineConfig, Project, Series } from './types';
import { KINDS, KIND_RANGE, SNAPSHOT_SLOTS } from './types';

export const SERIES_PER_KIND = 4;

const PREFIX: Record<Kind, string> = { time: 'T', pitch: 'P', velocity: 'V', artic: 'A' };

export function seriesId(kind: Kind, n: number): string {
  return `${PREFIX[kind]}${n}`;
}

/**
 * Parse a compact series notation into cells. Tokens are whitespace separated:
 *   12      value
 *   C4 F#3  note names (pitch series)
 *   12?     value with wobble randomisation, 12~ with drift randomisation
 *   _       rest
 *   >       skip
 *   [ ]3    loop open / close (play 3 times)
 *   |       end of series
 *   +       link to next series
 */
export function parseCells(src: string): Cell[] {
  const cells: Cell[] = [];
  for (const tok of src.trim().split(/\s+/).filter(Boolean)) {
    if (tok === '_') cells.push({ t: 'rest' });
    else if (tok === '>') cells.push({ t: 'skip' });
    else if (tok === '[') cells.push({ t: 'open' });
    else if (tok.startsWith(']')) cells.push({ t: 'close', n: Math.max(1, Number(tok.slice(1) || 2)) });
    else if (tok === '|') cells.push({ t: 'end' });
    else if (tok === '+') cells.push({ t: 'link' });
    else {
      let body = tok;
      let r: 0 | 1 | 2 = 0;
      if (body.endsWith('?')) {
        r = 1;
        body = body.slice(0, -1);
      } else if (body.endsWith('~')) {
        r = 2;
        body = body.slice(0, -1);
      }
      const n = /^-?\d+$/.test(body) ? Number(body) : noteNumber(body);
      if (n === null) throw new Error(`Bad series token: ${tok}`);
      cells.push(r ? { t: 'v', v: n, r } : { t: 'v', v: n });
    }
  }
  return cells;
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

export function makeSeries(kind: Kind, n: number, src: string, opts: Partial<Series> = {}): Series {
  const r = KIND_RANGE[kind];
  return {
    id: seriesId(kind, n),
    kind,
    name: seriesId(kind, n),
    cells: parseCells(src),
    rand: { amount: kind === 'pitch' ? 2 : kind === 'time' ? 6 : 10, type: 0, prob: 50 },
    lo: r.min,
    hi: r.max,
    ...opts,
  };
}

export function makeLine(i: number, heads: Partial<Record<Kind, string | [string, number, Direction?]>>, opts: Partial<LineConfig> = {}): LineConfig {
  const h = {} as LineConfig['heads'];
  for (const k of KINDS) {
    const spec = heads[k] ?? seriesId(k, 1);
    if (typeof spec === 'string') h[k] = { series: spec, start: 0, startDir: 1 };
    else h[k] = { series: spec[0], start: spec[1], startDir: spec[2] ?? 1 };
  }
  return {
    name: `Feeler ${i + 1}`,
    channel: i + 1,
    program: null,
    transpose: 0,
    velOffset: 0,
    timeScale: 1,
    delay: 0,
    legato: false,
    mute: false,
    heads: h,
    ...opts,
  };
}

/**
 * Fill a bank so that every kind has SERIES_PER_KIND series, keeping any
 * provided ones. Missing series get a neutral single value.
 */
export function fullBank(given: Series[]): Series[] {
  const neutral: Record<Kind, string> = { time: '12', pitch: 'C4', velocity: '90', artic: '80' };
  const bank: Series[] = [];
  for (const k of KINDS) {
    for (let n = 1; n <= SERIES_PER_KIND; n++) {
      const id = seriesId(k, n);
      bank.push(given.find((s) => s.id === id) ?? makeSeries(k, n, neutral[k]));
    }
  }
  return bank;
}

export function makeProject(p: Partial<Project> & { series: Series[]; lines: LineConfig[] }): Project {
  return {
    name: 'Untitled',
    notes: '',
    tempo: 110,
    seed: 1988,
    options: { clockOut: false, programOnStart: true, shiftEdit: false },
    snapshots: Array.from({ length: SNAPSHOT_SLOTS }, () => null),
    ...p,
    series: fullBank(p.series),
  };
}
