import { describe, expect, it } from 'vitest';
import { App } from '../../src/app';
import { makeLine, makeProject, makeSeries } from '../../src/engine/factory';
import type { Cell } from '../../src/engine/types';

function app(): App {
  const a = new App();
  a.loadProject(
    makeProject({
      series: [makeSeries('pitch', 1, 'C4 [ D4 E4 ]3 F4'), makeSeries('time', 1, '12 6 6')],
      lines: [0, 1, 2, 3].map((i) => makeLine(i, {})),
    }),
  );
  return a;
}

const show = (cells: Cell[]) => cells.map((c) => (c.t === 'v' ? c.v : c.t === 'close' ? `]${c.n}` : c.t === 'open' ? '[' : c.t));

describe('controller editing operations', () => {
  it('retrograde reverses material and keeps loops intact', () => {
    const a = app();
    a.retrograde('P1');
    expect(show(a.engine.series('P1')!.cells)).toEqual([65, '[', 64, 62, ']3', 60]);
  });

  it('rotate moves material under the heads', () => {
    const a = app();
    a.rotate('T1', 1);
    expect(show(a.engine.series('T1')!.cells)).toEqual([6, 12, 6]);
  });

  it('insert and delete keep heads on the same cells', () => {
    const a = app();
    a.placeHead(0, 'pitch', 'P1', 4); // E4
    a.select({ series: 'P1', index: 0 });
    a.insertCell(false);
    expect(a.engine.lines[0]!.heads.pitch.pos).toBe(5);
    expect(a.project.lines[0]!.heads.pitch.start).toBe(5);
    a.select({ series: 'P1', index: 0 });
    a.deleteCell();
    expect(a.engine.lines[0]!.heads.pitch.pos).toBe(4);
  });

  it('changing an element type and loop count', () => {
    const a = app();
    a.select({ series: 'P1', index: 0 });
    a.setCellType('rest');
    expect(a.cellAt()).toEqual({ t: 'rest' });
    a.setCellType('v');
    expect(a.cellAt()).toEqual({ t: 'v', v: 60 });
    a.select({ series: 'P1', index: 4 });
    a.setLoopCount(5000);
    expect(a.cellAt()).toEqual({ t: 'close', n: 999 });
  });

  it('randomisation flags and series settings', () => {
    const a = app();
    a.select({ series: 'P1', index: 2 });
    a.setRandFlag(2);
    expect(a.cellAt()).toEqual({ t: 'v', v: 62, r: 2 });
    a.setRandFlag(0);
    expect(a.cellAt()).toEqual({ t: 'v', v: 62 });
    a.setSeriesRand('P1', { lo: 70, hi: 50 });
    const s = a.engine.series('P1')!;
    expect(s.lo).toBeLessThanOrEqual(s.hi);
  });

  it('values are clamped to the kind range', () => {
    const a = app();
    a.setValue('P1', 0, 300);
    expect(a.engine.series('P1')!.cells[0]).toEqual({ t: 'v', v: 127 });
    a.setValue('T1', 0, -4);
    expect(a.engine.series('T1')!.cells[0]).toEqual({ t: 'v', v: 1 });
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
});
