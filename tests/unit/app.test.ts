import { describe, expect, it } from 'vitest';
import { App } from '../../src/app';
import { formatColumn, makeColumn, makeLine, makeProject } from '../../src/engine/factory';
import { serialize } from '../../src/persistence/project';
import golden from '../fixtures/v1-golden.json';

function app(): App {
  const a = new App();
  a.loadProject(
    makeProject({
      columns: [makeColumn('pitch', 1, 'C4 D4 E4 L2 F4| G4'), makeColumn('time', 1, '12 6 6')],
      lines: [0, 1, 2, 3].map((i) => makeLine(i, {})),
    }),
  );
  return a;
}

const fmt = (a: App, id: string) => formatColumn(a.column(id)!);

describe('controller: score editing', () => {
  it('retrograde reverses the values; Loop elements and End flags stay in place', () => {
    const a = app();
    a.retrograde('P1');
    expect(fmt(a, 'P1')).toBe('G4 F4 E4 L2 D4| C4');
  });

  it('rotate moves values under the heads', () => {
    const a = app();
    a.rotate('T1', 1);
    expect(fmt(a, 'T1')).toBe('6 12 6');
  });

  it('Skip is a toggle on an element and keeps its value (prepare Skips, remove them while playing)', () => {
    const a = app();
    a.select({ col: 'P1', index: 1 });
    a.toggleSkip();
    expect(a.elAt()).toEqual({ v: 62, skip: true });
    a.toggleSkip();
    expect(a.elAt()).toEqual({ v: 62 });
  });

  it('Rest cycles Rest, rest, none; randomise marks are attributes', () => {
    const a = app();
    a.select({ col: 'P1', index: 0 });
    a.setRest();
    expect(a.elAt()!.rest).toBe('R');
    a.setRest();
    expect(a.elAt()!.rest).toBe('r');
    a.setRest();
    expect(a.elAt()!.rest).toBeUndefined();
    a.setAutoRand(2);
    expect(a.elAt()).toEqual({ v: 60, ar: 2 });
    a.setAutoRand(0);
    expect(a.elAt()).toEqual({ v: 60 });
  });

  it('a Loop occupies the slot; it can be turned back into a value; counts 0-999', () => {
    const a = app();
    a.select({ col: 'P1', index: 1 });
    a.setSlot('loop', 3);
    expect(a.elAt()).toEqual({ v: null, loop: 3 });
    a.setLoopCount(5000);
    expect(a.elAt()!.loop).toBe(999);
    a.setLoopCount(-2);
    expect(a.elAt()!.loop).toBe(0);
    a.setSlot('value');
    expect(a.elAt()!.v).not.toBeNull();
    expect(a.elAt()!.loop).toBeUndefined();
    a.setSlot('blank');
    expect(a.elAt()).toEqual({ v: null });
  });

  it('End and Column Link', () => {
    const a = app();
    a.select({ col: 'P1', index: 4 });
    a.toggleEnd();
    expect(a.elAt()!.end).toBeUndefined();
    a.toggleLink('P1');
    expect(a.column('P1')!.link).toBe(true);
  });

  it('insert and delete keep heads on the same elements; a column holds 16', () => {
    const a = app();
    a.placeHead(0, 'pitch', 'P1', 2); // E4
    a.select({ col: 'P1', index: 0 });
    a.insertEl(false);
    expect(a.engine.lines[0]!.heads.pitch.pos.i).toBe(3);
    expect(a.project.lines[0]!.heads.pitch.start).toBe(3);
    a.select({ col: 'P1', index: 0 });
    a.deleteEl();
    expect(a.engine.lines[0]!.heads.pitch.pos.i).toBe(2);
    for (let i = 0; i < 20; i++) a.appendEl('P1');
    expect(a.column('P1')!.els).toHaveLength(16);
    a.select({ col: 'P1', index: 3 });
    a.insertEl(true);
    expect(a.column('P1')!.els).toHaveLength(16);
    expect(a.status).toMatch(/16 elements/);
  });

  it('values are clamped to the kind range', () => {
    const a = app();
    a.setValue('P1', 0, 300);
    expect(a.column('P1')!.els[0]!.v).toBe(127);
    a.setValue('T1', 0, -4);
    expect(a.column('T1')!.els[0]!.v).toBe(1);
    a.setValue('P1', 3, 70); // a Loop: no value
    expect(a.column('P1')!.els[3]).toEqual({ v: null, loop: 2 });
  });

  it('randomisation settings per kind, per column (extension) and the limits', () => {
    const a = app();
    a.setKindRandom('pitch', { p2: 7 });
    expect(a.project.random.pitch.p2).toBe(7);
    a.setColumnRandom('P1', { lo: 70, hi: 50 });
    expect(a.column('P1')!.rand).toMatchObject({ lo: 50, hi: 70, p2: 7 });
    a.setColumnRandom('P1', null);
    expect(a.column('P1')!.rand).toBeUndefined();
    a.setLimits({ minTime: 0, pitchLimit: 500 });
    expect([a.project.minTime, a.project.pitchLimit]).toEqual([1, 127]);
  });

  it('direction changes while stopped edit the starting direction', () => {
    const a = app();
    a.toggleDir(2, 'velocity');
    expect(a.project.lines[2]!.heads.velocity.startDir).toBe(-1);
    a.engine.reset();
    expect(a.engine.lines[2]!.heads.velocity.dir).toBe(-1);
  });

  it('shifting a line while stopped sets its entry delay', () => {
    const a = app();
    a.nudge(1, 6);
    a.nudge(1, -12);
    expect(a.project.lines[1]!.delay).toBe(0);
    a.nudge(1, 9);
    expect(a.project.lines[1]!.delay).toBe(9);
  });

  it('overlap mode per line', () => {
    const a = app();
    a.setOverlap(0, 'mono');
    expect(a.project.lines[0]!.overlap).toBe('mono');
  });
});

describe('controller: Restore Last Start', () => {
  it('restores values and line settings from the last Start; a second press undoes', () => {
    const a = app();
    a.restoreLastStart();
    expect(a.status).toMatch(/Nothing to restore/);
    a.engine.captureStart();
    a.setValue('P1', 0, 72);
    a.project.lines[0]!.transpose = 4;
    a.restoreLastStart();
    expect(a.column('P1')!.els[0]!.v).toBe(60);
    expect(a.project.lines[0]!.transpose).toBe(0);
    a.restoreLastStart();
    expect(a.column('P1')!.els[0]!.v).toBe(72);
    expect(a.project.lines[0]!.transpose).toBe(4);
  });
});

describe('controller: Scale Mode', () => {
  it('global and per-line settings, and the preview lens', () => {
    const a = app();
    let fired = 0;
    a.on('scale', () => fired++);
    expect(a.lensScale().spec).toBeNull();
    a.setGlobalScale({ on: true, root: 2, scale: 'dorian' });
    expect(a.lensScale().spec).toEqual({ root: 2, scale: 'dorian', dir: 'nearest' });
    a.setLineScale(1, { mode: 'own', root: 9, scale: 'minor-pent', dir: 'down' });
    a.project.lines[1]!.transpose = 3;
    a.setLens(1);
    expect(a.lensScale()).toEqual({ spec: { root: 9, scale: 'minor-pent', dir: 'down' }, transpose: 3 });
    a.setLineScale(1, { mode: 'off' });
    expect(a.lensScale().spec).toBeNull();
    expect(a.lineScale(0)).toEqual({ root: 2, scale: 'dorian', dir: 'nearest' });
    expect(fired).toBeGreaterThanOrEqual(4);
  });
});

describe('controller: files', () => {
  it('importing a v1 file converts it and says so', () => {
    const a = app();
    a.importJson(JSON.stringify((golden as Record<string, { file: unknown }>).controls!.file));
    expect(a.project.name).toBe('v1 controls');
    expect(a.status).toMatch(/older Feelers format/);
    a.importJson(serialize(a.project));
    expect(a.status).toMatch(/Loaded/);
  });
});
