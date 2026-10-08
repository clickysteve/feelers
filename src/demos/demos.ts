/**
 * Original demonstration setups. All material here was written for Feelers;
 * none of it is derived from original Fingers or MIDI-AX example files.
 *
 * Column notation (see engine/factory.ts parseColumn):
 *   12 C4   value / note        _   blank         L2  Loop (repeat twice more; L0 forever)
 *   v?      auto-randomise ?    v??  the second ? (¿)   v~  WOBBLE (Feelers extension)
 *   vR vr   Rest / rest         vS  Skip          v|  End of Series     +  Column Link
 * S/L values are sixteenths of the next Time value (16 = touching, 8 = half).
 */
import { makeColumn, makeLine, makeProject } from '../engine/factory';
import type { Project } from '../engine/types';

export interface Demo {
  id: string;
  title: string;
  blurb: string;
  build: () => Project;
}

const firstContact = (): Project =>
  makeProject({
    name: 'First Contact',
    tempo: 104,
    seed: 1988,
    notes:
      'Four feelers with series of different lengths. Line 1 reads a 5-step rhythm against a 7-note melody, so the pairing only repeats every 35 notes. ' +
      'The bells (line 3) run at time adjust 1.5, three against two. Try reversing P1 on line 1, or point line 4 at P3.',
    columns: [
      makeColumn('time', 1, '12 12 6 6 12'),
      makeColumn('time', 2, '24 12 12'),
      makeColumn('time', 3, '6'),
      makeColumn('time', 4, '36 12 48'),
      makeColumn('pitch', 1, 'D4 F4 A4 C5 E5 A4 G4'),
      makeColumn('pitch', 2, 'D3 A2 F3 C3'),
      makeColumn('pitch', 3, 'A5 G5 E5 D5 C5'),
      makeColumn('pitch', 4, 'D4 E4 C4'),
      makeColumn('velocity', 1, '96 70 80 64'),
      makeColumn('velocity', 2, '110 90'),
      makeColumn('velocity', 3, '60 40 50 70 45'),
      makeColumn('velocity', 4, '72'),
      makeColumn('artic', 1, '8 13 5'),
      makeColumn('artic', 2, '15'),
      makeColumn('artic', 3, '4 6'),
      makeColumn('artic', 4, '24 16'),
    ],
    lines: [
      makeLine(0, { time: 'T1', pitch: 'P1', velocity: 'V1', artic: 'S1' }, { name: 'Lead' }),
      makeLine(1, { time: 'T2', pitch: 'P2', velocity: 'V2', artic: 'S2' }, { name: 'Bass' }),
      makeLine(2, { time: 'T3', pitch: 'P3', velocity: 'V3', artic: 'S3' }, { name: 'Bells', timeScale: 1.5 }),
      makeLine(3, { time: 'T4', pitch: 'P4', velocity: 'V4', artic: 'S4' }, { name: 'Drone', transpose: -12, overlap: 'legato' }),
    ],
  });

const phaseGarden = (): Project =>
  makeProject({
    name: 'Phase Garden',
    tempo: 132,
    seed: 7,
    notes:
      'All four lines read the same twelve-note pitch series in steady sixteenths. Only their time adjust differs, by about one percent, ' +
      'so they slide out of unison into shifting canons and slowly back. Nudge a line with the SHIFT buttons to jump the phase.',
    columns: [
      makeColumn('time', 1, '6'),
      makeColumn('pitch', 1, 'E4 F#4 B4 C#5 D5 F#4 E4 C#5 B4 F#4 D5 C#5'),
      makeColumn('pitch', 2, 'E3 B3'),
      makeColumn('velocity', 1, '90 60 70 60'),
      makeColumn('velocity', 2, '50 35 40'),
      makeColumn('artic', 1, '10'),
      makeColumn('artic', 2, '14'),
    ],
    lines: [
      makeLine(0, { pitch: 'P1', velocity: 'V1', artic: 'S1' }, { name: 'Pulse' }),
      makeLine(1, { pitch: 'P1', velocity: 'V2', artic: 'S1' }, { name: 'Shadow', timeScale: 1.0125 }),
      makeLine(2, { pitch: ['P1', 6], velocity: 'V2', artic: 'S1' }, { name: 'Echo', timeScale: 0.99, transpose: 12 }),
      makeLine(3, { pitch: 'P2', velocity: 'V1', artic: 'S2' }, { name: 'Ground', timeScale: 8 }),
    ],
  });

const clockwork = (): Project =>
  makeProject({
    name: 'Clockwork',
    tempo: 118,
    seed: 3,
    notes:
      'A tour of the series control elements. P1 plays its first figure three times (Loop L2), skips B4 (Skip), then ends at G4 (End); ' +
      'below the End sits a second series, F4 A4 C5: use HEAD HERE on it to move line 1 there. ' +
      'T1 loops its opening and makes one silent step (r on its Time). V2 carries a Rest (R): when it is read only Time and Velocity move on, ' +
      'so line 2 slips against its pitches. P3 has the Column Link (→) set, so line 3 runs on into P4.',
    columns: [
      makeColumn('time', 1, '6 6 12 12 L1 6 6r 12'),
      makeColumn('time', 2, '12 6 6 6 18'),
      makeColumn('time', 3, '24'),
      makeColumn('pitch', 1, 'C4 E4 G4 L2 B4S C5 D5 G4| F4 A4 C5'),
      makeColumn('pitch', 2, 'C3 C3 G2 Bb2| F2 Ab2'),
      makeColumn('pitch', 3, 'G5 E5 +'),
      makeColumn('pitch', 4, 'D5 B4 _r C5'),
      makeColumn('velocity', 1, '100 70 70 85'),
      makeColumn('velocity', 2, '80 80 60R'),
      makeColumn('artic', 1, '6 11'),
      makeColumn('artic', 2, '14'),
      makeColumn('artic', 3, '3'),
    ],
    lines: [
      makeLine(0, { time: 'T1', pitch: 'P1', velocity: 'V1', artic: 'S1' }, { name: 'Gears' }),
      makeLine(1, { time: 'T2', pitch: 'P2', velocity: 'V2', artic: 'S2' }, { name: 'Escapement' }),
      makeLine(2, { time: 'T3', pitch: 'P3', velocity: 'V2', artic: 'S3' }, { name: 'Chime' }),
      makeLine(3, {}, { name: 'Spare', mute: true }),
    ],
  });

const drift = (): Project => {
  const p = makeProject({
    name: 'Drift',
    tempo: 96,
    seed: 2026,
    notes:
      'Auto-randomised elements. Every ? in P1 may move its note up or down a fourth when read (Amount 5, Type 1), and the change is kept, ' +
      'so the melody wanders; Pitch Limit 7 keeps it within a fifth of where it started. P3 carries the second mark (¿), set rarely, ' +
      'so its tonal centre creeps over minutes. Press RESTORE (Restore Last Start) to bring every value back to how it was at Start, and again to undo. ' +
      'P2 uses WOBBLE (~), a Feelers extension: octave leaps that are never kept.',
    columns: [
      makeColumn('time', 1, '12 6 6 12 12'),
      makeColumn('time', 2, '48'),
      makeColumn('time', 3, '18 18 12'),
      makeColumn('pitch', 1, 'A3? E4? C4? G4? D4?'),
      makeColumn('pitch', 2, 'A2~ E3~', { rand: { amount: 12, type: 1, p1: 0, p2: 0, pw: 40 } }),
      makeColumn('pitch', 3, 'E5 D5 C5?? A4??'),
      makeColumn('velocity', 1, '80? 70? 90? 60?', { rand: { amount: 5, type: 0, p1: 80, p2: 0, pw: 0, lo: 40, hi: 120 } }),
      makeColumn('velocity', 2, '100'),
      makeColumn('artic', 1, '10? 5?'),
      makeColumn('artic', 2, '18'),
    ],
    lines: [
      makeLine(0, { time: 'T1', pitch: 'P1', velocity: 'V1', artic: 'S1' }, { name: 'Wanderer' }),
      makeLine(1, { time: 'T2', pitch: 'P2', velocity: 'V2', artic: 'S2' }, { name: 'Root', overlap: 'legato' }),
      makeLine(2, { time: 'T3', pitch: 'P3', velocity: 'V1', artic: 'S1' }, { name: 'Sparks', timeScale: 0.75 }),
      makeLine(3, { time: 'T1', pitch: 'P1', velocity: 'V1', artic: 'S1' }, { name: 'Twin', delay: 9, transpose: 12, mute: true }),
    ],
  });
  p.random.pitch = { amount: 5, type: 1, p1: 35, p2: 8, pw: 40 };
  p.random.artic = { amount: 3, type: 0, p1: 60, p2: 5, pw: 50 };
  p.pitchLimit = 7;
  return p;
};

const lanes = (): Project => {
  const p = makeProject({
    name: 'Four Lanes (modular)',
    tempo: 100,
    seed: 11,
    notes:
      'Set up for a MIDI-to-CV interface such as a Squarp Hermod+: four lines on channels 1-4, S/L read as gate length, strict monophony, and MIDI clock enabled ' +
      'so the module follows Feelers. Lane 1 is a 3-step bass under a 5-step pitch pattern, lane 2 an accent/gate pattern with silent steps, lanes 3 and 4 are slow modulation-friendly melodies.',
    columns: [
      makeColumn('time', 1, '12 12 24'),
      makeColumn('time', 2, '6 6 6 6r 6 6 6r 6'),
      makeColumn('time', 3, '48 24'),
      makeColumn('time', 4, '96'),
      makeColumn('pitch', 1, 'C2 C2 G2 Bb1 F2'),
      makeColumn('pitch', 2, 'C4'),
      makeColumn('pitch', 3, 'G3 Bb3 C4 Eb4 D4 F4'),
      makeColumn('pitch', 4, 'C3 Ab2 Eb3'),
      makeColumn('velocity', 1, '110 80 95'),
      makeColumn('velocity', 2, '127 60 90 60 100 60'),
      makeColumn('velocity', 3, '70'),
      makeColumn('artic', 1, '7'),
      makeColumn('artic', 2, '5 5 11'),
      makeColumn('artic', 3, '15'),
    ],
    lines: [
      makeLine(0, { time: 'T1', pitch: 'P1', velocity: 'V1', artic: 'S1' }, { name: 'Lane 1', overlap: 'mono' }),
      makeLine(1, { time: 'T2', pitch: 'P2', velocity: 'V2', artic: 'S2' }, { name: 'Lane 2', overlap: 'mono' }),
      makeLine(2, { time: 'T3', pitch: 'P3', velocity: 'V3', artic: 'S3' }, { name: 'Lane 3', overlap: 'legato' }),
      makeLine(3, { time: 'T4', pitch: 'P4', velocity: 'V3', artic: 'S3' }, { name: 'Lane 4', overlap: 'legato' }),
    ],
  });
  p.options.clockOut = true;
  return p;
};

const scaleLens = (): Project => {
  const p = makeProject({
    name: 'Scale Lens',
    tempo: 112,
    seed: 5,
    notes:
      'Chromatic material seen through Scale Mode. The global scale is D Dorian: every note a line plays is moved to the nearest Dorian note, ' +
      'and the line panels show what changed (C#4 → D4 +1). The Pitch columns mark the notes the scale moves. Line 2 uses its own scale ' +
      '(minor pentatonic, rounding down); line 3 ignores Scale Mode and plays the stored pitches. The stored series never change: switch SCALE off to hear them.',
    columns: [
      makeColumn('time', 1, '6 6 12 6 6 12'),
      makeColumn('time', 2, '24 12'),
      makeColumn('time', 3, '18'),
      makeColumn('pitch', 1, 'D4 D#4 F4 F#4 G4 G#4 A4 C5 C#5'),
      makeColumn('pitch', 2, 'D3 E3 F#3 A3 B3'),
      makeColumn('pitch', 3, 'A5 G#5 F5 D5'),
      makeColumn('velocity', 1, '96 64 80 64'),
      makeColumn('velocity', 2, '100 80'),
      makeColumn('artic', 1, '10 6'),
      makeColumn('artic', 2, '14'),
    ],
    lines: [
      makeLine(0, { time: 'T1', pitch: 'P1', velocity: 'V1', artic: 'S1' }, { name: 'Climber' }),
      makeLine(1, { time: 'T2', pitch: 'P2', velocity: 'V2', artic: 'S2' }, { name: 'Pent', overlap: 'legato', scale: { mode: 'own', root: 2, scale: 'minor-pent', dir: 'down' } }),
      makeLine(2, { time: 'T3', pitch: 'P3', velocity: 'V1', artic: 'S1' }, { name: 'Raw', scale: { mode: 'off', root: 0, scale: 'major', dir: 'nearest' } }),
      makeLine(3, {}, { name: 'Spare', mute: true }),
    ],
  });
  p.scale = { on: true, root: 2, scale: 'dorian', dir: 'nearest' };
  return p;
};

export const DEMOS: Demo[] = [
  { id: 'first-contact', title: 'First Contact', blurb: 'Series of different lengths interlock; a 3:2 bell line.', build: firstContact },
  { id: 'phase-garden', title: 'Phase Garden', blurb: 'One melody, four speeds a hair apart: slow phasing canons.', build: phaseGarden },
  { id: 'clockwork', title: 'Clockwork', blurb: 'Loop, Skip, Rest and rest, End and Column Link in action.', build: clockwork },
  { id: 'drift', title: 'Drift', blurb: 'Auto-randomised values that wander; RESTORE brings them home.', build: drift },
  { id: 'lanes', title: 'Four Lanes', blurb: 'Gate-friendly setup for MIDI-to-CV modules, clock on.', build: lanes },
  { id: 'scale-lens', title: 'Scale Lens', blurb: 'Chromatic material through Scale Mode, with every change shown.', build: scaleLens },
];

export function demo(id: string): Project {
  return (DEMOS.find((d) => d.id === id) ?? DEMOS[0]!).build();
}
