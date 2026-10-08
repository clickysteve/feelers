/**
 * The four line panels: performance controls for each feeler, head
 * assignment and direction, and a live readout of how the current note was
 * assembled from the four heads.
 */
import type { App } from '../app';
import type { HeadRead, NoteEvent } from '../engine/engine';
import { noteName } from '../engine/factory';
import { QUANT_DIRS, ROOT_NAMES, SCALES, scaleLabel } from '../engine/scale';
import type { Kind, Overlap, QuantDir } from '../engine/types';
import { KINDS, KIND_LABEL, KIND_SHORT } from '../engine/types';
import { LINE_COLORS } from './bank';
import { h, replace, stepper, type Stepper } from './dom';

const OVERLAPS: [Overlap, string, string][] = [
  ['written', 'AS WRITTEN', 'Every note keeps its length from S/L, so S/L over 16 overlaps the next note (as in Fingers). A repeated pitch is always released first.'],
  ['legato', 'LEGATO', 'The previous note is released just after the next one starts, so a mono synth glides.'],
  ['mono', 'MONO', 'Strict monophony: each note ends before the next one starts (safest for CV/gate).'],
];

const DIR_LABEL: Record<QuantDir, string> = { nearest: '≈', down: '↓', up: '↑' };
const DIR_HELP: Record<QuantDir, string> = {
  nearest: 'Nearest scale note; a tie goes up.',
  down: 'The scale note at or below.',
  up: 'The scale note at or above.',
};

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
  overlap: Record<Overlap, HTMLButtonElement>;
  scaleMode: Record<'global' | 'own' | 'off', HTMLButtonElement>;
  scaleOwn: HTMLElement;
  scaleRoot: HTMLSelectElement;
  scaleSel: HTMLSelectElement;
  scaleDir: HTMLSelectElement;
  scaleNote: HTMLElement;
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
    app.on('scale', () => this.update());
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
    const overlap = {} as Card['overlap'];
    for (const [o, label, help] of OVERLAPS) {
      overlap[o] = h('button', { class: 'seg', help, 'data-testid': `overlap-${o}-${i}`, onclick: () => app.setOverlap(i, o) }, label);
    }
    const scaleMode = {} as Card['scaleMode'];
    const modes: ['global' | 'own' | 'off', string, string][] = [
      ['global', 'G', 'Follow the global Scale Mode (top bar).'],
      ['own', 'OWN', 'Use a scale of this line\'s own, whatever the global setting.'],
      ['off', 'OFF', 'Ignore Scale Mode: this line plays its pitches unchanged.'],
    ];
    for (const [m, label, help] of modes) scaleMode[m] = h('button', { class: 'seg', help, 'data-testid': `lscale-${m}-${i}`, onclick: () => app.setLineScale(i, { mode: m }) }, label);
    const scaleRoot = h('select', { 'aria-label': `Line ${i + 1} scale root`, help: 'Root of this line\'s scale.', 'data-testid': `lscale-root-${i}` }, ...ROOT_NAMES.map((n, r) => h('option', { value: String(r) }, n)));
    scaleRoot.addEventListener('change', () => app.setLineScale(i, { root: Number(scaleRoot.value) }));
    const scaleSel = h('select', { 'aria-label': `Line ${i + 1} scale`, help: 'This line\'s scale.', 'data-testid': `lscale-scale-${i}` }, ...SCALES.map((x) => h('option', { value: x.id }, x.name)));
    scaleSel.addEventListener('change', () => app.setLineScale(i, { scale: scaleSel.value }));
    const scaleDir = h('select', { 'aria-label': `Line ${i + 1} quantise direction`, help: 'How out-of-scale pitches move: nearest (ties go up), down or up.', 'data-testid': `lscale-dir-${i}` }, ...QUANT_DIRS.map((d) => h('option', { value: d }, `${DIR_LABEL[d]} ${d}`)));
    scaleDir.addEventListener('change', () => app.setLineScale(i, { dir: scaleDir.value as QuantDir }));
    const scaleOwn = h('span', { class: 'scale-row' }, scaleRoot, scaleSel, scaleDir);
    const scaleNote = h('span', { class: 'scale-note', 'data-testid': `lscale-note-${i}` });
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
        { 'aria-label': `Line ${i + 1} ${KIND_LABEL[k]} column`, help: `Which ${KIND_LABEL[k]} column line ${i + 1} reads (from its top; HEAD HERE in the editor picks any element). Lines may share columns.`, 'data-testid': `assign-${i}-${k}` },
        ...app.project.columns.filter((s) => s.kind === k).map((s) => h('option', { value: s.id }, s.name)),
      );
      select.addEventListener('change', () => app.assign(i, k, select.value));
      const dir = h('button', { class: 'tiny dir', help: `Reverse line ${i + 1}'s ${KIND_LABEL[k]} head. While stopped this sets its starting direction.`, 'data-testid': `dir-${i}-${k}`, onclick: () => app.toggleDir(i, k) }, '→');
      const pos = h('span', { class: 'pos' });
      heads[k] = { select, dir, pos };
      assembly[k] = h('span', { class: 'asm-v', 'data-testid': `asm-${k}-${i}` }, '·');
      return h('div', { class: 'head-row' }, h('span', { class: 'kl' }, KIND_SHORT[k]), select, dir, pos, assembly[k]);
    });
    const result = h('span', { class: 'result', 'data-testid': `result-${i}` }, '·');
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
      h(
        'div',
        { class: 'heads' },
        ...rows,
        h(
          'div',
          { class: 'asm-row', help: 'The note just played. When Scale Mode moved it, the pitch before the scale (after transposition) is shown first: C#4 → D4 +1.' },
          h('span', { class: 'kl' }, 'NOTE'),
          result,
        ),
      ),
      h(
        'div',
        { class: 'perf' },
        steppers.transpose,
        steppers.vel,
        steppers.scale,
        ratios,
        nudges,
        steppers.program,
        h('span', { class: 'grp', help: 'How this line\'s notes may overlap.' }, h('span', { class: 'lbl' }, 'NOTES'), h('span', { class: 'seggrp', role: 'group', 'aria-label': `Line ${i + 1} overlap` }, ...Object.values(overlap))),
        h(
          'span',
          { class: 'grp scale-row', help: 'Scale Mode for this line: follow the global scale, use its own, or ignore it. The stored pitches never change.' },
          h('span', { class: 'lbl' }, 'SCALE'),
          h('span', { class: 'seggrp', role: 'group', 'aria-label': `Line ${i + 1} scale mode` }, ...Object.values(scaleMode)),
          scaleOwn,
          scaleNote,
        ),
      ),
    );
    return { root, pause, mute, overlap, scaleMode, scaleOwn, scaleRoot, scaleSel, scaleDir, scaleNote, name, channel, steppers, delay, heads, assembly, result, count };
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
      for (const [o] of OVERLAPS) {
        c.overlap[o].classList.toggle('on', cfg.overlap === o);
        c.overlap[o].setAttribute('aria-pressed', String(cfg.overlap === o));
      }
      for (const m of ['global', 'own', 'off'] as const) {
        c.scaleMode[m].classList.toggle('on', cfg.scale.mode === m);
        c.scaleMode[m].setAttribute('aria-pressed', String(cfg.scale.mode === m));
      }
      c.scaleOwn.style.display = cfg.scale.mode === 'own' ? '' : 'none';
      c.scaleRoot.value = String(cfg.scale.root);
      c.scaleSel.value = cfg.scale.scale;
      c.scaleDir.value = cfg.scale.dir;
      for (const o of c.scaleDir.options) o.title = DIR_HELP[o.value as QuantDir];
      c.scaleNote.textContent = cfg.scale.mode === 'global' ? scaleLabel(app.lineScale(i)) : cfg.scale.mode === 'off' ? 'unchanged' : '';
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
        c.heads[k].select.value = hd.pos.col;
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
      const sc = app.engine.score;
      for (const k of KINDS) {
        const v = app.headView(i, k);
        const place = app.column(v.col) ? app.seriesPlace({ col: v.col, i: v.index }, sc) : null;
        c.heads[k].pos.textContent = place && place.at > 0 ? `${place.at}/${place.of}` : '';
        c.heads[k].pos.dataset.help = 'Position of the head in its series (End of Series and Column Link decide where a series starts and ends).';
      }
      const ev = app.lastNotes[i] ?? null;
      this.showAssembly(c, ev);
      c.count.textContent = app.transport === 'stopped' ? '' : `#${app.engine.lines[i]!.count}`;
    });
  }

  private showAssembly(c: Card, ev: NoteEvent | null): void {
    if (!ev) {
      for (const k of KINDS) {
        c.assembly[k].textContent = '·';
        c.assembly[k].classList.remove('rnd', 'held');
      }
      c.result.textContent = '·';
      return;
    }
    const show = (k: Kind, x: HeadRead, f: (v: number) => string) => {
      const el = c.assembly[k];
      el.classList.toggle('rnd', x.randomised);
      el.classList.toggle('held', x.held);
      if (x.held) {
        el.textContent = 'hold';
        el.dataset.help = 'This head waited: a Rest (R) on another head held it for this note.';
        return;
      }
      const v = x.value === null ? '·' : f(x.value) + (x.randomised ? '*' : '');
      el.textContent = x.rest ? `${v} ${x.rest}` : v;
      el.dataset.help = x.randomised ? 'Randomised when read (*).' : x.rest ? (x.rest === 'R' ? 'Rest (R): silent; only Time and this head moved on.' : 'rest (r): silent; every head moved on.') : '';
    };
    const r = ev.reads;
    show('time', r.time, (v) => `${v}t`);
    show('pitch', r.pitch, (v) => noteName(v));
    show('velocity', r.velocity, (v) => String(v));
    show('artic', r.artic, (v) => `${v}/16`);
    if (ev.silent) {
      replace(c.result, h('span', { class: 'rest' }, ev.muted ? 'muted' : 'rest'), ` ${fmtTicks(ev.time)}`);
      return;
    }
    const pitch =
      ev.scaleDelta !== 0
        ? [
            h('span', { class: 'src', 'data-testid': 'pre-pitch' }, noteName(ev.prePitch)),
            h('span', { class: 'arr' }, ' → '),
            h('span', { class: 'out' }, noteName(ev.pitch)),
            h('span', { class: 'dl', 'data-testid': 'scale-delta' }, ev.scaleDelta > 0 ? `+${ev.scaleDelta}` : `−${-ev.scaleDelta}`),
          ]
        : [h('span', { class: 'out' }, noteName(ev.pitch))];
    replace(c.result, ...pitch, `  v${ev.velocity}  ${fmtTicks(ev.duration)}/${fmtTicks(ev.time)}`);
    c.result.dataset.help =
      ev.scaleDelta !== 0
        ? `Played ${noteName(ev.pitch)}: the pitch ${noteName(ev.prePitch)} (series value plus transposition) was moved ${ev.scaleDelta > 0 ? 'up' : 'down'} ${Math.abs(ev.scaleDelta)} by Scale Mode. Velocity, then length / time to the next note.`
        : 'The note just played: pitch, velocity, then length / time to the next note.';
  }
}

function fmtTicks(t: number): string {
  return Number.isInteger(t) ? `${t}t` : `${t.toFixed(1)}t`;
}
