/**
 * Original demonstration setups. All material here was written for Feelers;
 * none of it is derived from original Fingers or MIDI-AX example files.
 *
 * Series notation (see engine/factory.ts parseCells):
 *   12 C4   value / note     _  rest      >  skip next
 *   [ ]3    loop (3 times)   |  end       +  link to next series
 *   v? wobble-randomised    v~ drift-randomised
 */
import { makeLine, makeProject, makeSeries } from '../engine/factory';
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
    series: [
      makeSeries('time', 1, '12 12 6 6 12'),
      makeSeries('time', 2, '24 12 12'),
      makeSeries('time', 3, '6'),
      makeSeries('time', 4, '36 12 48'),
      makeSeries('pitch', 1, 'D4 F4 A4 C5 E5 A4 G4'),
      makeSeries('pitch', 2, 'D3 A2 F3 C3'),
      makeSeries('pitch', 3, 'A5 G5 E5 D5 C5'),
      makeSeries('pitch', 4, 'D4 E4 C4'),
      makeSeries('velocity', 1, '96 70 80 64'),
      makeSeries('velocity', 2, '110 90'),
      makeSeries('velocity', 3, '60 40 50 70 45'),
      makeSeries('velocity', 4, '72'),
      makeSeries('artic', 1, '50 80 30'),
      makeSeries('artic', 2, '95'),
      makeSeries('artic', 3, '25 40'),
      makeSeries('artic', 4, '150 100'),
    ],
    lines: [
      makeLine(0, { time: 'T1', pitch: 'P1', velocity: 'V1', artic: 'A1' }, { name: 'Lead' }),
      makeLine(1, { time: 'T2', pitch: 'P2', velocity: 'V2', artic: 'A2' }, { name: 'Bass' }),
      makeLine(2, { time: 'T3', pitch: 'P3', velocity: 'V3', artic: 'A3' }, { name: 'Bells', timeScale: 1.5 }),
      makeLine(3, { time: 'T4', pitch: 'P4', velocity: 'V4', artic: 'A4' }, { name: 'Drone', transpose: -12, legato: true }),
    ],
  });

const phaseGarden = (): Project =>
  makeProject({
    name: 'Phase Garden',
    tempo: 132,
    seed: 7,
    notes:
      'All four lines read the same twelve-note pitch series in steady sixteenths. Only their time adjust differs, by about one percent, ' +
      'so they slide out of unison into shifting canons and slowly back. Nudge a line with the delay buttons to jump the phase.',
    series: [
      makeSeries('time', 1, '6'),
      makeSeries('pitch', 1, 'E4 F#4 B4 C#5 D5 F#4 E4 C#5 B4 F#4 D5 C#5'),
      makeSeries('pitch', 2, 'E3 B3'),
      makeSeries('velocity', 1, '90 60 70 60'),
      makeSeries('velocity', 2, '50 35 40'),
      makeSeries('artic', 1, '60'),
      makeSeries('artic', 2, '90'),
    ],
    lines: [
      makeLine(0, { pitch: 'P1', velocity: 'V1', artic: 'A1' }, { name: 'Pulse' }),
      makeLine(1, { pitch: 'P1', velocity: 'V2', artic: 'A1' }, { name: 'Shadow', timeScale: 1.0125 }),
      makeLine(2, { pitch: ['P1', 6], velocity: 'V2', artic: 'A1' }, { name: 'Echo', timeScale: 0.99, transpose: 12 }),
      makeLine(3, { pitch: 'P2', velocity: 'V1', artic: 'A2' }, { name: 'Ground', timeScale: 8 }),
    ],
  });

const clockwork = (): Project =>
  makeProject({
    name: 'Clockwork',
    tempo: 118,
    seed: 3,
    notes:
      'A tour of the series control elements. P1 loops its middle figure three times, then a SKIP jumps a note. ' +
      'T1 holds a silent step (REST marks the next time as a gap). P2 ends at END; the notes after it are dormant until you move END. ' +
      'P3 LINKs into P4, so line 3 walks both. Reverse a head and watch loops run backwards.',
    series: [
      makeSeries('time', 1, '6 6 12 _ 12 [ 3 3 ]2 6'),
      makeSeries('time', 2, '12 [ 6 ]3 18'),
      makeSeries('time', 3, '24'),
      makeSeries('pitch', 1, 'C4 [ E4 G4 ]3 > B4 C5 D5 G4'),
      makeSeries('pitch', 2, 'C3 C3 G2 Bb2 | F2 Ab2'),
      makeSeries('pitch', 3, 'G5 E5 +'),
      makeSeries('pitch', 4, 'D5 B4 _ C5'),
      makeSeries('velocity', 1, '100 [ 70 ]2 85'),
      makeSeries('velocity', 2, '80'),
      makeSeries('artic', 1, '40 70'),
      makeSeries('artic', 2, '85'),
      makeSeries('artic', 3, '20'),
    ],
    lines: [
      makeLine(0, { time: 'T1', pitch: 'P1', velocity: 'V1', artic: 'A1' }, { name: 'Gears' }),
      makeLine(1, { time: 'T2', pitch: 'P2', velocity: 'V2', artic: 'A2' }, { name: 'Escapement' }),
      makeLine(2, { time: 'T3', pitch: 'P3', velocity: 'V2', artic: 'A3' }, { name: 'Chime' }),
      makeLine(3, {}, { name: 'Spare', mute: true }),
    ],
  });

const drift = (): Project =>
  makeProject({
    name: 'Drift',
    tempo: 96,
    seed: 2026,
    notes:
      'Randomised cells. P1 is marked DRIFT (~): each read may move a note by a fourth or fifth (amount 5, type 1 gives +/-5; P1 uses limits so it stays in range) ' +
      'and the change is kept, so the melody wanders. P2 is marked WOBBLE (?): octave displacements that never stick. ' +
      'V1 drifts gently with gaussian steps. Press Stop then Start: the seed makes the whole walk repeat exactly.',
    series: [
      makeSeries('time', 1, '12 6 6 12 12'),
      makeSeries('time', 2, '48'),
      makeSeries('time', 3, '18 18 12'),
      makeSeries('pitch', 1, 'A3~ E4~ C4~ G4~ D4~', { rand: { amount: 5, type: 1, prob: 35 }, lo: 52, hi: 81 }),
      makeSeries('pitch', 2, 'A2? E3?', { rand: { amount: 12, type: 1, prob: 40 }, lo: 33, hi: 64 }),
      makeSeries('pitch', 3, 'E5 D5 C5? A4?', { rand: { amount: 2, type: 1, prob: 30 } }),
      makeSeries('velocity', 1, '80~ 70~ 90~ 60~', { rand: { amount: 6, type: 0, prob: 80 }, lo: 40, hi: 120 }),
      makeSeries('velocity', 2, '100'),
      makeSeries('artic', 1, '60? 30?', { rand: { amount: 20, type: 0, prob: 60 }, lo: 10, hi: 120 }),
      makeSeries('artic', 2, '110'),
    ],
    lines: [
      makeLine(0, { time: 'T1', pitch: 'P1', velocity: 'V1', artic: 'A1' }, { name: 'Wanderer' }),
      makeLine(1, { time: 'T2', pitch: 'P2', velocity: 'V2', artic: 'A2' }, { name: 'Root', legato: true }),
      makeLine(2, { time: 'T3', pitch: 'P3', velocity: 'V1', artic: 'A1' }, { name: 'Sparks', timeScale: 0.75 }),
      makeLine(3, { time: 'T1', pitch: 'P1', velocity: 'V1', artic: 'A1' }, { name: 'Twin', delay: 9, transpose: 12, mute: true }),
    ],
  });

const lanes = (): Project => {
  const p = makeProject({
    name: 'Four Lanes (modular)',
    tempo: 100,
    seed: 11,
    notes:
      'Set up for a MIDI-to-CV interface such as a Squarp Hermod+: four lines on channels 1-4, articulation read as gate length, and MIDI clock enabled ' +
      'so the module follows Feelers. Lane 1 is a 3-step bass under a 5-step pitch pattern, lane 2 an accent/gate pattern, lanes 3 and 4 are slow modulation-friendly melodies.',
    series: [
      makeSeries('time', 1, '12 12 24'),
      makeSeries('time', 2, '6 6 6 _ 6 6 _ 6'),
      makeSeries('time', 3, '48 24'),
      makeSeries('time', 4, '96'),
      makeSeries('pitch', 1, 'C2 C2 G2 Bb1 F2'),
      makeSeries('pitch', 2, 'C4'),
      makeSeries('pitch', 3, 'G3 Bb3 C4 Eb4 D4 F4'),
      makeSeries('pitch', 4, 'C3 Ab2 Eb3'),
      makeSeries('velocity', 1, '110 80 95'),
      makeSeries('velocity', 2, '127 60 90 60 100 60'),
      makeSeries('velocity', 3, '70'),
      makeSeries('artic', 1, '45'),
      makeSeries('artic', 2, '30 30 70'),
      makeSeries('artic', 3, '98'),
    ],
    lines: [
      makeLine(0, { time: 'T1', pitch: 'P1', velocity: 'V1', artic: 'A1' }, { name: 'Lane 1' }),
      makeLine(1, { time: 'T2', pitch: 'P2', velocity: 'V2', artic: 'A2' }, { name: 'Lane 2' }),
      makeLine(2, { time: 'T3', pitch: 'P3', velocity: 'V3', artic: 'A3' }, { name: 'Lane 3', legato: true }),
      makeLine(3, { time: 'T4', pitch: 'P4', velocity: 'V3', artic: 'A3' }, { name: 'Lane 4', legato: true }),
    ],
  });
  p.options.clockOut = true;
  return p;
};

export const DEMOS: Demo[] = [
  { id: 'first-contact', title: 'First Contact', blurb: 'Series of different lengths interlock; a 3:2 bell line.', build: firstContact },
  { id: 'phase-garden', title: 'Phase Garden', blurb: 'One melody, four speeds a hair apart: slow phasing canons.', build: phaseGarden },
  { id: 'clockwork', title: 'Clockwork', blurb: 'Loops, skips, rests, END and LINK in action.', build: clockwork },
  { id: 'drift', title: 'Drift', blurb: 'Seeded randomisation: melodies that wander and come home.', build: drift },
  { id: 'lanes', title: 'Four Lanes', blurb: 'Gate-friendly setup for MIDI-to-CV modules, clock on.', build: lanes },
];

export function demo(id: string): Project {
  return (DEMOS.find((d) => d.id === id) ?? DEMOS[0]!).build();
}
