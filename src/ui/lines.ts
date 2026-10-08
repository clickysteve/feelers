/**
 * The four line panels: performance controls for each feeler, head
 * assignment and direction, and a live readout of how the current note was
 * assembled from the four heads.
 */
import type { App } from '../app';
import type { NoteEvent } from '../engine/engine';
import { noteName } from '../engine/factory';
import { activeLength } from '../engine/series';
import type { Kind } from '../engine/types';
import { KINDS, KIND_LABEL, KIND_SHORT } from '../engine/types';
import { LINE_COLORS } from './bank';
import { h, replace, stepper, type Stepper } from './dom';

const RATIOS: [string, number][] = [
  ['½', 0.5],
  ['⅔', 2 / 3],
  ['¾', 0.75],
  ['1', 1],
  ['4⁄3', 4 / 3],
  ['1½', 1.5],
  ['2', 2],
];

interface Card {
  root: HTMLElement;
  pause: HTMLButtonElement;
  mute: HTMLButtonElement;
  legato: HTMLButtonElement;
  name: HTMLInputElement;
  channel: HTMLSelectElement;
  steppers: Record<'program' | 'transpose' | 'vel' | 'scale', Stepper>;
  delay: HTMLElement;
  heads: Record<Kind, { select: HTMLSelectElement; dir: HTMLButtonElement; pos: HTMLElement }>;
  assembly: Record<Kind, HTMLElement>;
  result: HTMLElement;
  count: HTMLElement;
}

export class LinesView {
  el: HTMLElement;
  private cards: Card[] = [];

  constructor(private app: App) {
    this.el = h('section', { class: 'lines', 'aria-label': 'Lines' });
    app.on('project', () => this.build());
    app.on('lines', () => this.update());
    app.on('transport', () => this.update());
    app.on('heads', () => this.updateLive());
    this.build();
  }

  build(): void {
    this.cards = [0, 1, 2, 3].map((i) => this.card(i));
    replace(this.el, ...this.cards.map((c) => c.root));
    this.update();
    this.updateLive();
  }

  private card(i: number): Card {
    const app = this.app;
    const cfg = () => app.engine.cfg(i);
    const btn = (label: string, help: string, fn: () => void, testid: string) =>
      h('button', { class: 'small', help, onclick: fn, 'data-testid': `${testid}-${i}` }, label);

    const pause = btn('PAUSE', 'Pause this line: it stops reading and keeps its place. Press again to carry on.', () => app.togglePause(i), 'pause');
    const mute = btn('MUTE', 'Mute this line: its heads keep moving silently.', () => app.toggleMute(i), 'mute');
    const legato = btn('LEGATO', 'Legato: let each note overlap the next one briefly (mono synths can glide). Off: strict monophony, each note ends before the next.', () => {
      cfg().legato = !cfg().legato;
      app.lineChanged();
    }, 'legato');
    const name = h('input', { class: 'name', value: cfg().name, 'aria-label': `Line ${i + 1} name`, help: 'Line name.' });
    name.addEventListener('change', () => {
      cfg().name = name.value.slice(0, 24) || `Feeler ${i + 1}`;
      app.lineChanged();
    });
    name.addEventListener('keydown', (e) => e.stopPropagation());
    const channel = h(
      'select',
      { 'aria-label': `Line ${i + 1} MIDI channel`, help: 'MIDI channel for this line. Changing it releases the sounding note on the old channel.', 'data-testid': `channel-${i}` },
      ...Array.from({ length: 16 }, (_, c) => h('option', { value: String(c + 1) }, `CH ${c + 1}`)),
    );
    channel.addEventListener('change', () => app.setChannel(i, Number(channel.value)));

    const steppers = {
      program: stepper({
        label: 'PROG',
        value: cfg().program ?? -1,
        min: -1,
        max: 127,
        format: (v) => (v < 0 ? 'off' : String(v)),
        parse: (s) => (s.trim() === '' || s.trim().toLowerCase() === 'off' ? -1 : Number(s)),
        help: 'Program change for this line (off for none). Sent when changed and, if enabled, on Start.',
        onChange: (v) => app.setProgram(i, v < 0 ? null : v),
      }),
      transpose: stepper({ label: 'TRANS', value: cfg().transpose, min: -48, max: 48, big: 12, help: 'Transpose this line in semitones (shift: octaves). The series stay unchanged.', testid: `transpose-${i}`, onChange: (v) => { cfg().transpose = v; app.lineChanged(); } }),
      vel: stepper({ label: 'VEL±', value: cfg().velOffset, min: -127, max: 127, big: 10, help: 'Velocity offset added to every note of this line.', onChange: (v) => { cfg().velOffset = v; app.lineChanged(); } }),
      scale: stepper({
        label: 'TIME×',
        value: cfg().timeScale,
        min: 0.05,
        max: 16,
        step: 0.005,
        big: 0.1,
        format: (v) => v.toFixed(3),
        help: 'Time adjust: every time value of this line is multiplied by this. 2 = half speed, 0.5 = double speed; values in between make the line drift against the others.',
        testid: `scale-${i}`,
        onChange: (v) => { cfg().timeScale = v; app.lineChanged(); },
      }),
    };
    const ratios = h(
      'span',
      { class: 'ratios' },
      ...RATIOS.map(([label, v]) =>
        h('button', { class: 'tiny', help: `Set time adjust to ${v.toFixed(3)}.`, onclick: () => { cfg().timeScale = v; app.lineChanged(); } }, label),
      ),
    );
    const delay = h('span', { class: 'readout' });
    const nudges = h(
      'span',
      { class: 'grp', help: 'Advance or delay this line against the others. While stopped this sets its entry delay. Shift: a quarter note.' },
      h('span', { class: 'lbl' }, 'SHIFT'),
      h('button', { class: 'tiny', 'aria-label': `Advance line ${i + 1}`, 'data-testid': `advance-${i}`, onclick: (e: MouseEvent) => app.nudge(i, e.shiftKey ? -24 : -3) }, '◂'),
      delay,
      h('button', { class: 'tiny', 'aria-label': `Delay line ${i + 1}`, 'data-testid': `delay-${i}`, onclick: (e: MouseEvent) => app.nudge(i, e.shiftKey ? 24 : 3) }, '▸'),
    );

    const heads = {} as Card['heads'];
    const assembly = {} as Card['assembly'];
    const rows = KINDS.map((k) => {
      const select = h(
        'select',
        { 'aria-label': `Line ${i + 1} ${KIND_LABEL[k]} series`, help: `Which ${KIND_LABEL[k]} series line ${i + 1} reads. Lines may share series.`, 'data-testid': `assign-${i}-${k}` },
        ...app.project.series.filter((s) => s.kind === k).map((s) => h('option', { value: s.id }, s.name)),
      );
      select.addEventListener('change', () => app.assign(i, k, select.value));
      const dir = h('button', { class: 'tiny dir', help: `Reverse line ${i + 1}'s ${KIND_LABEL[k]} head. While stopped this sets its starting direction.`, 'data-testid': `dir-${i}-${k}`, onclick: () => app.toggleDir(i, k) }, '→');
      const pos = h('span', { class: 'pos' });
      heads[k] = { select, dir, pos };
      assembly[k] = h('span', { class: 'asm-v' }, '·');
      return h('div', { class: 'head-row' }, h('span', { class: 'kl' }, KIND_SHORT[k]), select, dir, pos, assembly[k]);
    });
    const result = h('span', { class: 'result' }, '·');
    const count = h('span', { class: 'count' });

    const root = h(
      'div',
      { class: 'line panel', style: { '--lc': LINE_COLORS[i] }, 'data-testid': `line-${i}` },
      h(
        'div',
        { class: 'line-head' },
        h('span', { class: 'badge', help: `Line ${i + 1}: one monophonic voice assembled from four heads.` }, String(i + 1)),
        name,
        channel,
        count,
      ),
      h(
        'div',
        { class: 'line-btns' },
        pause,
        mute,
        btn('NEXT', 'Play this line\'s next note now instead of waiting out a long time value. While stopped, it auditions the next note.', () => app.next(i), 'next'),
        btn('STEP', 'Step: with the line paused (or the transport stopped), play exactly one note and advance the heads.', () => app.step(i), 'step'),
        btn('RESET', 'Return this line\'s heads to their starting cells and start it again now.', () => app.resetLine(i), 'reset'),
        btn('REV', 'Reverse all four heads of this line.', () => app.reverseLine(i), 'rev'),
      ),
      h('div', { class: 'heads' }, ...rows, h('div', { class: 'asm-row', help: 'The note just assembled: one value from each head, plus this line\'s transposition and offsets.' }, h('span', { class: 'kl' }, 'NOTE'), result)),
      h('div', { class: 'perf' }, steppers.transpose, steppers.vel, steppers.scale, ratios, nudges, steppers.program, legato),
    );
    return { root, pause, mute, legato, name, channel, steppers, delay, heads, assembly, result, count };
  }

  update(): void {
    const app = this.app;
    this.cards.forEach((c, i) => {
      const cfg = app.engine.cfg(i);
      const rt = app.engine.lines[i]!;
      c.pause.classList.toggle('on', rt.paused);
      c.pause.setAttribute('aria-pressed', String(rt.paused));
      c.mute.classList.toggle('on', cfg.mute);
      c.mute.setAttribute('aria-pressed', String(cfg.mute));
      c.legato.classList.toggle('on', cfg.legato);
      c.legato.setAttribute('aria-pressed', String(cfg.legato));
      c.root.classList.toggle('muted', cfg.mute);
      c.root.classList.toggle('paused', rt.paused);
      if (document.activeElement !== c.name) c.name.value = cfg.name;
      c.channel.value = String(cfg.channel);
      c.steppers.program.setValue(cfg.program ?? -1);
      c.steppers.transpose.setValue(cfg.transpose);
      c.steppers.vel.setValue(cfg.velOffset);
      c.steppers.scale.setValue(cfg.timeScale);
      const sh = app.shifts[i] ?? 0;
      c.delay.textContent = app.transport === 'stopped' ? `${cfg.delay}t` : `${sh > 0 ? '+' : ''}${sh}t`;
      c.delay.dataset.help =
        app.transport === 'stopped' ? 'Entry delay in ticks after Start.' : 'Live shift since Start. Each press moves the line 3 ticks (shift: 24) against the others.';
      for (const k of KINDS) {
        const hd = rt.heads[k];
        c.heads[k].select.value = hd.series;
        c.heads[k].dir.textContent = hd.dir === 1 ? '→' : '←';
        c.heads[k].dir.classList.toggle('on', hd.dir === -1);
        c.heads[k].dir.setAttribute('aria-label', `Line ${i + 1} ${KIND_LABEL[k]} direction: ${hd.dir === 1 ? 'forward' : 'reverse'}`);
      }
    });
    this.updateLive();
  }

  updateLive(): void {
    const app = this.app;
    this.cards.forEach((c, i) => {
      for (const k of KINDS) {
        const v = app.headView(i, k);
        const s = app.engine.series(v.series);
        c.heads[k].pos.textContent = s ? `${v.index + 1}/${activeLength(s)}` : '';
      }
      const ev = app.lastNotes[i] ?? null;
      this.showAssembly(c, ev);
      c.count.textContent = app.transport === 'stopped' ? '' : `#${app.engine.lines[i]!.count}`;
    });
  }

  private showAssembly(c: Card, ev: NoteEvent | null): void {
    if (!ev) {
      for (const k of KINDS) c.assembly[k].textContent = '·';
      c.result.textContent = '·';
      return;
    }
    const r = ev.reads;
    const show = (k: Kind, f: (v: number) => string) => {
      const x = r[k];
      c.assembly[k].textContent = x.rest ? 'rest' : x.value === null ? '·' : f(x.value) + (x.randomised ? '*' : '');
      c.assembly[k].classList.toggle('rnd', x.randomised);
    };
    show('time', (v) => `${v}t`);
    show('pitch', (v) => noteName(v));
    show('velocity', (v) => String(v));
    show('artic', (v) => `${v}%`);
    c.result.textContent = ev.silent
      ? ev.muted
        ? 'muted'
        : 'rest'
      : `${noteName(ev.pitch)}  vel ${ev.velocity}  len ${fmtTicks(ev.duration)} of ${fmtTicks(ev.time)}`;
  }
}

function fmtTicks(t: number): string {
  return Number.isInteger(t) ? `${t}t` : `${t.toFixed(1)}t`;
}
