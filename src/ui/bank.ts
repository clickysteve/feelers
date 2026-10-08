/**
 * The series bank: every column drawn as a strip of elements, grouped by
 * kind. Control elements are drawn as marks on the element they belong to
 * (Rest R / rest r and the randomise marks bottom left, Skip bottom right);
 * a Loop fills its own slot; an End of Series leaves a gap, so the separate
 * series of a column are visible; a linked column ends with an arrow to the
 * column it continues into. Each line's heads are numbered tabs on the
 * elements they are reading.
 *
 * Pitch elements that Scale Mode would play as a different note carry a
 * Transform underline and the change (+1, -2) in the corner: the stored value
 * is shown, the effect of the scale is visible, nothing is rewritten.
 */
import type { App, ScaleLens } from '../app';
import type { NoteEvent } from '../engine/engine';
import { noteName, noteNumber } from '../engine/factory';
import { constrain, scaleLabel } from '../engine/scale';
import { Score, cycleLength } from '../engine/series';
import type { Column, El, Kind, RandomSettings, ScaleSpec } from '../engine/types';
import { KINDS, KIND_LABEL, KIND_RANGE } from '../engine/types';
import { h, replace, stepper } from './dom';

export const LINE_COLORS = ['var(--l1)', 'var(--l2)', 'var(--l3)', 'var(--l4)'];

const KIND_HELP: Record<Kind, string> = {
  time: 'TIME columns: the wait before each note, in ticks (24 = quarter note, 12 = eighth, 6 = sixteenth, 8 = triplet eighth).',
  pitch: 'PITCH columns: MIDI notes. Each line adds its own transposition; Scale Mode may then move the note (marked here, never rewritten).',
  velocity: 'VELOCITY columns: how hard each note is struck (1-127; 0 is silent). Each line adds its own offset.',
  artic: 'S/L columns (staccato/legato): note length in sixteenths of the next Time value. 1 = staccato, 15 = just before the next note, 16 = touching, more overlaps.',
};

const ARMARK = ['', '?', '¿', '~'];

export function elText(e: El, kind: Kind): string {
  if (e.loop !== undefined) return e.loop === 0 ? 'L∞' : `L×${e.loop}`;
  if (e.v === null) return '·';
  return kind === 'pitch' ? noteName(e.v) : String(e.v);
}

function elHelp(e: El, kind: Kind): string {
  const parts: string[] = [];
  if (e.loop !== undefined) parts.push(e.loop === 0 ? 'LOOP: repeats everything above it in its series, forever.' : `LOOP: repeats everything above it in its series ${e.loop} more time(s). Ignored by heads moving backwards.`);
  else if (e.v === null) parts.push('Blank element: heads pass over it.');
  else parts.push(kind === 'pitch' ? `${noteName(e.v)} (${e.v}).` : `Value ${e.v}.`);
  if (e.skip) parts.push('SKIP: heads pass over this element (the value is kept).');
  if (e.rest === 'R') parts.push('REST (R): the note is silent; only the Time head and this head move on.');
  if (e.rest === 'r') parts.push('rest (r): the note is silent; every head moves on.');
  if (e.ar === 1) parts.push('? may change this value when read (first probability); the change is kept.');
  if (e.ar === 2) parts.push('¿ may change this value when read (second probability); the change is kept.');
  if (e.ar === 3) parts.push('~ WOBBLE (Feelers extension): may displace the value read; the stored value stays.');
  if (e.end) parts.push('END: its series ends here and wraps to its start.');
  return `${parts.join(' ')} Click to edit.`;
}

/** How Scale Mode, seen through the lens, treats one stored pitch. */
export function lensView(v: number, lens: { spec: ScaleSpec | null; transpose: number }): { pre: number; out: number; delta: number } {
  let pre = v + lens.transpose;
  while (pre > 127) pre -= 12;
  while (pre < 0) pre += 12;
  const c = constrain(pre, lens.spec);
  return { pre, out: c.pitch, delta: c.delta };
}

const signed = (d: number) => (d > 0 ? `+${d}` : `−${-d}`);

interface Strip {
  root: HTMLElement;
  link: HTMLButtonElement;
  cells: HTMLElement;
  sig: string;
  cellEls: HTMLElement[];
  info: HTMLElement;
}

export class BankView {
  el: HTMLElement;
  private strips = new Map<string, Strip>();
  private openRand = new Set<string>();
  private openKind = new Set<Kind>();
  private marked: HTMLElement[] = [];
  private lensBtns: HTMLButtonElement[] = [];
  private lensNote!: HTMLElement;

  constructor(private app: App) {
    this.el = h('section', { class: 'bank panel', 'aria-label': 'Series bank' });
    app.on('project', () => this.build());
    app.on('bank', () => this.refresh());
    app.on('scale', () => this.refresh());
    app.on('heads', () => this.drawHeads());
    app.on('lines', () => {
      if (app.lens !== 'global') this.refresh();
      else this.drawHeads();
    });
    app.on('transport', () => this.drawHeads());
    app.on('selection', () => this.drawSelection());
    app.noteListeners.add((ev) => this.flash(ev));
    this.build();
  }

  build(): void {
    this.strips.clear();
    const groups = KINDS.map((k) =>
      h(
        'div',
        { class: `kind-group k-${k}`, dataset: { kind: k } },
        h(
          'div',
          { class: 'kind-label', help: KIND_HELP[k] },
          h('span', {}, KIND_LABEL[k]),
          h(
            'button',
            {
              class: `tiny ${this.openKind.has(k) ? 'on' : ''}`,
              help: `Randomisation for every ${KIND_LABEL[k]} column: Amount, Type and the probabilities of ? and ¿${k === 'time' ? ', and Minimum Time' : k === 'pitch' ? ', and Pitch Limit' : ''}.`,
              'aria-label': `${KIND_LABEL[k]} randomisation`,
              'data-testid': `kind-rand-${k}`,
              onclick: () => {
                if (this.openKind.has(k)) this.openKind.delete(k);
                else this.openKind.add(k);
                this.build();
              },
            },
            '±',
          ),
        ),
        h('div', { class: 'kind-strips' }, this.openKind.has(k) ? this.kindPanel(k) : null, ...this.app.project.columns.filter((s) => s.kind === k).map((s) => this.strip(s))),
      ),
    );
    this.lensBtns = (['global', 0, 1, 2, 3] as ScaleLens[]).map((l) =>
      h(
        'button',
        {
          class: 'tiny',
          'data-testid': `lens-${l}`,
          help: l === 'global' ? 'Mark the pitches the global scale would move.' : `Mark the pitches line ${l + 1} would move (its scale, after its transposition).`,
          onclick: () => this.app.setLens(l),
        },
        l === 'global' ? 'G' : String(l + 1),
      ),
    );
    this.lensNote = h('span', { 'data-testid': 'lens-note' });
    replace(
      this.el,
      h(
        'div',
        { class: 'panel-title' },
        h('span', {}, 'Series bank'),
        h(
          'span',
          { class: 'legend' },
          h('span', { class: 'lg', help: 'Rest (R): only Time and this head move on. rest (r): every head moves on.' }, 'R r'),
          h('span', { class: 'lg', help: 'Skip: heads pass over the element; its value is kept.' }, 'S'),
          h('span', { class: 'lg', help: 'Loop: repeats its series from the start (or the previous Loop).' }, 'L'),
          h('span', { class: 'lg', help: 'End of Series: a gap after the element. Column Link: the arrow at the end of a strip.' }, '| →'),
          h('span', { class: 'lg', help: 'Auto-randomise: ? and ¿ (each with its own probability; the change is kept), ~ WOBBLE (Feelers extension; not kept).' }, '? ¿ ~'),
          h('span', { class: 'lg xf', help: 'Pitches the scale shown would move: underlined, with the change in the corner.' }, 'SCALE'),
          ...this.lensBtns,
          this.lensNote,
          ' ',
          ...[0, 1, 2, 3].map((i) => h('span', { class: 'tab', style: { background: LINE_COLORS[i] } }, String(i + 1))),
          ' heads',
        ),
      ),
      ...groups,
    );
    this.updateLens();
    this.drawHeads();
    this.drawSelection();
  }

  private updateLens(): void {
    const app = this.app;
    const l = app.lens;
    this.lensBtns.forEach((b, i) => {
      const on = (i === 0 && l === 'global') || l === i - 1;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const lens = app.lensScale();
    this.lensNote.textContent = lens.spec ? ` ${scaleLabel(lens.spec)}${lens.transpose ? ` ${lens.transpose > 0 ? '+' : ''}${lens.transpose}` : ''}` : ' off';
  }

  private kindPanel(k: Kind): HTMLElement {
    const app = this.app;
    const r: RandomSettings = app.project.random[k];
    return h(
      'div',
      { class: 'rand-panel kind-rand', 'data-testid': `kind-rand-panel-${k}` },
      h('span', { class: 'lbl' }, `${KIND_LABEL[k]} randomisation`),
      ...this.randSteppers(r, (patch) => app.setKindRandom(k, patch)),
      k === 'time'
        ? stepper({ label: 'Min time', value: app.project.minTime, min: 1, max: 999, help: 'Minimum Time: randomised Time values never go below this.', testid: 'min-time', onChange: (v) => app.setLimits({ minTime: v }) })
        : null,
      k === 'pitch'
        ? stepper({ label: 'Pitch limit', value: app.project.pitchLimit, min: 0, max: 127, help: 'Pitch Limit: randomised pitches stay within this many semitones of the range each Pitch series had at Start.', testid: 'pitch-limit', onChange: (v) => app.setLimits({ pitchLimit: v }) })
        : null,
    );
  }

  private randSteppers(r: RandomSettings, set: (p: Partial<RandomSettings>) => void): HTMLElement[] {
    return [
      stepper({ label: 'Amount', value: r.amount, min: 0, max: 64, help: 'Size of a random change. With Type 0 the change follows a bell curve whose average size is about Amount.', onChange: (v) => set({ amount: v }) }),
      stepper({ label: 'Type', value: r.type, min: 0, max: 12, help: 'Type 0: bell-curve changes. Type n: changes are exact multiples of Amount, 1 to n times, up or down, all equally likely.', onChange: (v) => set({ type: v }) }),
      stepper({ label: '? %', value: r.p1, min: 0, max: 100, step: 1, big: 10, help: 'Probability that a ? element is randomised when read. The change is kept.', onChange: (v) => set({ p1: v }) }),
      stepper({ label: '¿ %', value: r.p2, min: 0, max: 100, step: 1, big: 10, help: 'Probability for ¿ elements: a second, independent setting (for example a rare one).', onChange: (v) => set({ p2: v }) }),
      h(
        'span',
        { class: 'grp' },
        stepper({ label: '~ %', value: r.pw, min: 0, max: 100, step: 1, big: 10, help: 'WOBBLE (Feelers extension): probability that a ~ element is displaced when read. The stored value is never changed.', onChange: (v) => set({ pw: v }) }),
        h('span', { class: 'ext-tag', help: 'A Feelers extension, not part of Fingers.' }, 'EXT'),
      ),
    ];
  }

  private strip(c: Column): HTMLElement {
    const app = this.app;
    const cells = h('div', { class: 'cells', role: 'list' });
    const info = h('span', { class: 'cyc' });
    const bank = app.project.columns;
    const tools = h(
      'span',
      { class: 'strip-tools' },
      h('button', { class: 'tiny', help: 'Rotate the values one step left (Loops and End stay in place; the material moves under the heads).', 'aria-label': `Rotate ${c.name} left`, onclick: () => app.rotate(c.id, -1) }, '◂'),
      h('button', { class: 'tiny', help: 'Rotate the values one step right.', 'aria-label': `Rotate ${c.name} right`, onclick: () => app.rotate(c.id, 1) }, '▸'),
      h('button', { class: 'tiny', help: 'Retrograde: reverse the order of the values (Loops and End stay in place).', 'aria-label': `Retrograde ${c.name}`, onclick: () => app.retrograde(c.id) }, '⇆'),
      h('button', { class: 'tiny', help: c.kind === 'pitch' ? 'Every value down a semitone (shift-click: an octave).' : 'Lower every value (shift-click: by 10).', 'aria-label': `${c.name} values down`, onclick: (e: MouseEvent) => app.offsetColumn(c.id, -(e.shiftKey ? (c.kind === 'pitch' ? 12 : 10) : 1)) }, '−'),
      h('button', { class: 'tiny', help: c.kind === 'pitch' ? 'Every value up a semitone (shift-click: an octave).' : 'Raise every value (shift-click: by 10).', 'aria-label': `${c.name} values up`, onclick: (e: MouseEvent) => app.offsetColumn(c.id, e.shiftKey ? (c.kind === 'pitch' ? 12 : 10) : 1) }, '+'),
      h(
        'button',
        {
          class: `tiny ${this.openRand.has(c.id) ? 'on' : ''} ${c.rand ? 'own' : ''}`,
          help: c.rand ? 'This column has its own randomisation settings (Feelers extension). Click to see them.' : 'Randomisation for this column (it follows its kind unless given its own).',
          'aria-label': `${c.name} randomisation settings`,
          'data-testid': `rand-${c.id}`,
          onclick: () => {
            if (this.openRand.has(c.id)) this.openRand.delete(c.id);
            else this.openRand.add(c.id);
            this.build();
          },
        },
        c.rand ? '±*' : '±',
      ),
    );
    const linkBtn = h('button', { class: 'tiny link', 'aria-label': `${c.name} column link`, 'data-testid': `link-${c.id}`, onclick: () => app.toggleLink(c.id) }, '→');
    const root = h(
      'div',
      { class: 'strip', dataset: { col: c.id }, 'data-testid': `strip-${c.id}` },
      h('div', { class: 'strip-head' }, h('b', { help: `Column ${c.name}. ${KIND_HELP[c.kind]}` }, c.name), linkBtn, info, tools),
      cells,
    );
    const entry: Strip = { root, link: linkBtn, cells, sig: '', cellEls: [], info };
    this.strips.set(c.id, entry);
    this.fillCells(c, entry, new Score(bank));
    if (this.openRand.has(c.id)) root.appendChild(this.colPanel(c));
    return root;
  }

  private colPanel(c: Column): HTMLElement {
    const app = this.app;
    const r = KIND_RANGE[c.kind];
    const fmt = c.kind === 'pitch' ? (v: number) => noteName(v) : (v: number) => String(v);
    const parse = c.kind === 'pitch' ? (t: string) => (/^\d+$/.test(t) ? Number(t) : noteNumber(t)) : undefined;
    const own = h(
      'button',
      {
        class: `small ${c.rand ? 'on' : ''}`,
        'aria-pressed': String(!!c.rand),
        'data-testid': `own-rand-${c.id}`,
        help: c.rand ? 'Return this column to the settings of its kind.' : 'Give this column its own randomisation settings and bounds (a Feelers extension; Fingers has one set per kind).',
        onclick: () => app.setColumnRandom(c.id, c.rand ? null : {}),
      },
      'OWN SETTINGS',
    );
    if (!c.rand) return h('div', { class: 'rand-panel' }, own, h('span', { class: 'small-print' }, `Follows the ${KIND_LABEL[c.kind]} settings (± on the left).`), h('span', { class: 'ext-tag' }, 'EXT'));
    const rr = c.rand;
    return h(
      'div',
      { class: 'rand-panel' },
      own,
      h('span', { class: 'ext-tag', help: 'A Feelers extension, not part of Fingers.' }, 'EXT'),
      ...this.randSteppers(rr, (patch) => app.setColumnRandom(c.id, patch)),
      stepper({ label: 'Low', value: rr.lo ?? r.min, min: r.min, max: r.max, format: fmt, parse, big: 12, help: 'Lowest value a randomised element may take (values as written are never limited).', onChange: (v) => app.setColumnRandom(c.id, { lo: v }) }),
      stepper({ label: 'High', value: rr.hi ?? r.max, min: r.min, max: r.max, format: fmt, parse, big: 12, help: 'Highest value a randomised element may take.', onChange: (v) => app.setColumnRandom(c.id, { hi: v }) }),
    );
  }

  private fillCells(c: Column, entry: Strip, sc: Score, force = false): void {
    const app = this.app;
    const bank = app.project.columns;
    const same = bank.filter((x) => x.kind === c.kind);
    const target = same[(same.indexOf(c) + 1) % same.length]!;
    const lens = c.kind === 'pitch' ? app.lensScale() : null;
    const sig = JSON.stringify(c.els) + c.link + target.name + (lens ? JSON.stringify(lens) : '');
    if (sig === entry.sig && !force) return;
    entry.sig = sig;
    entry.link.classList.toggle('on', c.link);
    entry.link.setAttribute('aria-pressed', String(c.link));
    entry.link.dataset.help = c.link
      ? `Column Link on: the bottom of ${c.name} continues at the top of ${target.name}, as one series. Click to unlink.`
      : `Column Link: join the bottom of ${c.name} to the top of ${target.name} (the next ${KIND_LABEL[c.kind]} column to the right, wrapping).`;
    entry.cellEls = c.els.map((e, i) => {
      let xf: { pre: number; out: number; delta: number } | null = null;
      if (lens && lens.spec && e.v !== null && e.loop === undefined) {
        const v = lensView(e.v, lens);
        if (v.delta !== 0) xf = v;
      }
      const cls = ['cell', e.loop !== undefined ? 'loop' : e.v === null ? 'blank' : 'val', e.skip ? 'skipped' : '', e.rest ? 'rest' : '', e.end ? 'end' : '', xf ? 'xf' : ''].filter(Boolean).join(' ');
      const marks = `${e.rest ?? ''}${e.ar ? ARMARK[e.ar] : ''}`;
      const text = elText(e, c.kind);
      const xfText = xf ? ` Plays ${noteName(xf.out)} (${xf.pre !== e.v ? `transposed to ${noteName(xf.pre)}, ` : ''}scale ${signed(xf.delta)}).` : '';
      return h(
        'button',
        {
          class: cls,
          role: 'listitem',
          help: elHelp(e, c.kind) + xfText,
          dataset: { index: String(i) },
          'aria-label': `${c.name} element ${i + 1}: ${text}${e.skip ? ', skipped' : ''}${e.rest ? `, ${e.rest === 'R' ? 'Rest' : 'rest'}` : ''}${e.end ? ', end of series' : ''}${xf ? `, plays ${noteName(xf.out)}` : ''}`,
          onclick: () => app.select({ col: c.id, index: i }),
          onwheel: (ev: WheelEvent) => {
            const cur = c.els[i];
            if (!cur || cur.v === null || cur.loop !== undefined) return;
            ev.preventDefault();
            app.setValue(c.id, i, cur.v + (ev.deltaY < 0 ? 1 : -1));
          },
        },
        h('span', { class: 'marks' }),
        h('span', { class: 'txt' }, text),
        marks ? h('span', { class: 'am' }, marks) : null,
        e.skip ? h('span', { class: 'sk' }, 'S') : null,
        xf ? h('span', { class: 'xd', 'data-testid': 'xf-delta' }, signed(xf.delta)) : null,
      );
    });
    replace(
      entry.cells,
      ...entry.cellEls,
      c.link ? h('span', { class: 'link-tail', help: `Continues at the top of ${target.name}.` }, `→${target.name}`) : null,
      c.els.length < 16 ? h('button', { class: 'cell add', help: 'Add an element at the end of this column (16 at most).', 'aria-label': `Add element to ${c.name}`, onclick: () => app.appendEl(c.id) }, '+') : null,
    );
    const cyc = cycleLength(sc, c.id, app.engine.choices);
    entry.info.textContent = cyc ? `×${cyc}` : '∅';
    entry.info.dataset.help = `A lone head starting at the top of ${c.name} repeats every ${cyc} reads (counting Loops, Skips and links). Lines combine series of different lengths, so their notes repeat only after the least common multiple.`;
  }

  refresh(force = false): void {
    const sc = new Score(this.app.project.columns);
    for (const c of this.app.project.columns) {
      const e = this.strips.get(c.id);
      if (e) this.fillCells(c, e, sc, force);
    }
    this.updateLens();
    this.drawHeads();
    this.drawSelection();
  }

  drawHeads(): void {
    for (const m of this.marked) {
      const marks = m.querySelector('.marks');
      if (marks) marks.textContent = '';
      m.classList.remove('headed');
    }
    this.marked = [];
    for (let line = 0; line < 4; line++) {
      for (const k of KINDS) {
        const v = this.app.headView(line, k);
        const el = this.strips.get(v.col)?.cellEls[v.index];
        if (!el) continue;
        const marks = el.querySelector('.marks')!;
        const dir = this.app.dirOf(line, k);
        const tab = h(
          'span',
          { class: `tab ${v.live ? 'live' : 'ghost'}`, style: { background: v.live ? LINE_COLORS[line] : 'transparent', borderColor: LINE_COLORS[line], color: v.live ? 'var(--paper)' : LINE_COLORS[line] } },
          `${line + 1}${dir === -1 ? '‹' : ''}`,
        );
        marks.appendChild(tab);
        el.classList.add('headed');
        this.marked.push(el);
      }
    }
  }

  private flash(ev: NoteEvent): void {
    for (const k of KINDS) {
      const r = ev.reads[k];
      if (!r.pos || r.held) continue;
      const el = this.strips.get(r.pos.col)?.cellEls[r.pos.i];
      if (!el) continue;
      el.classList.remove('hit');
      void el.offsetWidth;
      el.classList.add('hit');
      el.style.setProperty('--hit', LINE_COLORS[ev.line] ?? 'var(--ink)');
    }
  }

  private drawSelection(): void {
    this.el.querySelectorAll('.cell.sel').forEach((e) => e.classList.remove('sel'));
    const sel = this.app.selection;
    if (!sel) return;
    const el = this.strips.get(sel.col)?.cellEls[sel.index];
    el?.classList.add('sel');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
