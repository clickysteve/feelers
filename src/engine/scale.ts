/**
 * Scale Mode: an optional, non-destructive pitch constraint applied at
 * playback (a modern Feelers facility; Fingers had no scale quantiser).
 *
 * Pitch processing order for every note:
 *   stored or randomised Pit value
 *   -> line transposition, folded into 0-127 by octaves
 *   -> scale constraint (this module)
 *   -> MIDI note
 *
 * The stored series are never rewritten. Quantisation is deterministic:
 *   NEAREST - the closest scale note; an exact tie between the note below
 *             and the note above goes UP (C#4 in C major plays D4).
 *   DOWN    - the closest scale note at or below.
 *   UP      - the closest scale note at or above.
 * If the chosen note would leave 0-127, the nearest scale note in the other
 * direction is used instead.
 */
import type { GlobalScale, LineConfig, QuantDir, ScaleSpec } from './types';

export interface ScaleDef {
  id: string;
  name: string;
  /** Semitones above the root, ascending, starting with 0. */
  steps: number[];
}

export const SCALES: ScaleDef[] = [
  { id: 'chromatic', name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: 'major', name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Natural Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonic-minor', name: 'Harmonic Minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'melodic-minor', name: 'Melodic Minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'dorian', name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'locrian', name: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10] },
  { id: 'major-pent', name: 'Major Pentatonic', steps: [0, 2, 4, 7, 9] },
  { id: 'minor-pent', name: 'Minor Pentatonic', steps: [0, 3, 5, 7, 10] },
  { id: 'blues', name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  { id: 'whole-tone', name: 'Whole Tone', steps: [0, 2, 4, 6, 8, 10] },
  { id: 'dim-wh', name: 'Diminished (whole-half)', steps: [0, 2, 3, 5, 6, 8, 9, 11] },
  { id: 'dim-hw', name: 'Diminished (half-whole)', steps: [0, 1, 3, 4, 6, 7, 9, 10] },
];

export const QUANT_DIRS: QuantDir[] = ['nearest', 'down', 'up'];

export const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function scaleDef(id: string): ScaleDef {
  return SCALES.find((s) => s.id === id) ?? SCALES[0]!;
}

const masks = new Map<string, boolean[]>();

/** 12-bit pitch-class mask of a scale on a root. */
export function scaleMask(spec: Pick<ScaleSpec, 'root' | 'scale'>): boolean[] {
  const key = `${spec.root}:${spec.scale}`;
  let mask = masks.get(key);
  if (!mask) {
    mask = Array.from({ length: 12 }, () => false);
    for (const s of scaleDef(spec.scale).steps) mask[(((spec.root + s) % 12) + 12) % 12] = true;
    masks.set(key, mask);
  }
  return mask;
}

const inRange = (n: number) => n >= 0 && n <= 127;

/** Constrain one MIDI pitch (0-127) to a scale. */
export function quantize(pitch: number, spec: ScaleSpec): number {
  const p = Math.round(pitch);
  const mask = scaleMask(spec);
  const ok = (n: number) => inRange(n) && mask[((n % 12) + 12) % 12]!;
  if (ok(p)) return p;
  const below = (): number | null => {
    for (let n = p - 1; n >= p - 12; n--) if (ok(n)) return n;
    return null;
  };
  const above = (): number | null => {
    for (let n = p + 1; n <= p + 12; n++) if (ok(n)) return n;
    return null;
  };
  const dn = below();
  const up = above();
  if (spec.dir === 'down') return dn ?? up ?? p;
  if (spec.dir === 'up') return up ?? dn ?? p;
  if (dn === null) return up ?? p;
  if (up === null) return dn;
  return up - p <= p - dn ? up : dn;
}

/** The scale a line plays in, or null when Scale Mode does not apply to it. */
export function effectiveScale(global: GlobalScale, line: Pick<LineConfig, 'scale'>): ScaleSpec | null {
  const ls = line.scale;
  if (ls.mode === 'off') return null;
  if (ls.mode === 'own') return { root: ls.root, scale: ls.scale, dir: ls.dir };
  return global.on ? { root: global.root, scale: global.scale, dir: global.dir } : null;
}

/** Apply a scale (or none) to a pitch: the emitted pitch and the change made. */
export function constrain(pitch: number, spec: ScaleSpec | null): { pitch: number; delta: number } {
  if (!spec) return { pitch, delta: 0 };
  const q = quantize(pitch, spec);
  return { pitch: q, delta: q - pitch };
}

/** Short label such as "D Dorian ↑". */
export function scaleLabel(spec: ScaleSpec | null): string {
  if (!spec) return 'off';
  const arrow = spec.dir === 'nearest' ? '' : spec.dir === 'up' ? ' ↑' : ' ↓';
  return `${ROOT_NAMES[spec.root]} ${scaleDef(spec.scale).name}${arrow}`;
}

export function defaultGlobalScale(): GlobalScale {
  return { on: false, root: 0, scale: 'major', dir: 'nearest' };
}
