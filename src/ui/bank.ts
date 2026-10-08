/**
 * The series bank: every parameter series drawn as a strip of cells, grouped
 * by kind. Each line's heads are drawn as numbered tabs on the cells they are
 * reading, so the assembly of every note is visible.
 */
import type { App } from '../app';
import type { NoteEvent } from '../engine/engine';
import { noteName, noteNumber } from '../engine/factory';
import { activeLength, cycleLength, nextOfKind } from '../engine/series';
import type { Cell, Kind, Series } from '../engine/types';
import { KINDS, KIND_LABEL, KIND_RANGE } from '../engine/types';
import { h, replace, stepper } from './dom';

export const LINE_COLORS = ['var(--l1)', 'var(--l2)', 'var(--l3)', 'var(--l4)'];

const KIND_HELP: Record<Kind, string> = {
  time: 'TIME series: the gap from the start of one note to the start of the next, in ticks (24 = quarter note, 12 = eighth, 6 = sixteenth, 8 = triplet eighth).',
  pitch: 'PITCH series: MIDI notes. Each line adds its own transposition.',
  velocity: 'VELOCITY series: how hard each note is struck (1-127; 0 is silent). Each line adds its own velocity offset.',
  artic: 'ARTICULATION series: note length as a percentage of the time value. 50 = staccato half, 100 = full, over 100 overlaps the next note (legato).',
};

export function cellText(c: Cell, kind: Kind, s?: Series, bank?: Series[]): string {
  switch (c.t) {
    case 'v':
      return kind === 'pitch' ? noteName(c.v) : String(c.v);
    case 'rest':
      return 'REST';
    case 'skip':
      return 'SKIP';
    case 'open':
      return '[';
    case 'close':
      return `]×${c.n}`;
    case 'end':
      return 'END';
    case 'link': {
      const next = s && bank ? nextOfKind(bank, s.id, 1) : undefined;
      return next ? `→${next.name}` : 'LINK';
    }
  }
}

const CELL_HELP: Record<Cell['t'], string> = {
  v: 'Value. Click to select; arrow keys or the wheel change it; type a number (or a note name like F#3).',
  rest: 'REST: the note read here is silent. In a Time series it makes the next time value a silent gap.',
  skip: 'SKIP: the head jumps over the next value in its direction of travel.',
  open: 'Loop start. Pairs with the next ] bracket.',
  close: 'Loop end: the bracketed section plays this many times in total, then the head moves on.',
  end: 'END: the series stops here and wraps. Cells after END are dormant; move END to change the length live.',
  link: 'LINK: the head continues into the next series of the same kind instead of wrapping.',
};

export class BankView {
  el: HTMLElement;
  private strips = new Map<string, { root: HTMLElement; cells: HTMLElement; sig: string; cellEls: HTMLElement[]; info: HTMLElement }>();
  private openRand = new Set<string>();
  private marked: HTMLElement[] = [];

  constructor(private app: App) {
    this.el = h('section', { class: 'bank panel', 'aria-label': 'Series bank' });
    app.on('project', () => this.build());
    app.on('bank', () => this.refresh());
    app.on('heads', () => this.drawHeads());
    app.on('lines', () => this.drawHeads());
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
        h('div', { class: 'kind-label', help: KIND_HELP[k] }, h('span', {}, KIND_LABEL[k])),
        h('div', { class: 'kind-strips' }, ...this.app.project.series.filter((s) => s.kind === k).map((s) => this.strip(s))),
      ),
    );
    replace(
      this.el,
      h(
        'div',
        { class: 'panel-title' },
        h('span', {}, 'Series bank'),
        h(
          'span',
          { class: 'legend' },
          h('span', { class: 'lg ctl' }, 'REST SKIP [ ] END LINK'),
          ' control elements   ',
          h('span', { class: 'lg r1' }, '?'),
          ' wobble   ',
          h('span', { class: 'lg r2' }, '~'),
          ' drift   ',
          ...[0, 1, 2, 3].map((i) => h('span', { class: 'tab', style: { background: LINE_COLORS[i] } }, String(i + 1))),
          ' heads',
        ),
      ),
      ...groups,
    );
    this.drawHeads();
    this.drawSelection();
  }

  private strip(s: Series): HTMLElement {
    const cells = h('div', { class: 'cells', role: 'list' });
    const info = h('span', { class: 'cyc' });
    const tools = h(
      'span',
      { class: 'strip-tools' },
      h('button', { class: 'tiny', help: 'Rotate the series one step left (material moves under the heads).', 'aria-label': `Rotate ${s.name} left`, onclick: () => this.app.rotate(s.id, -1) }, '◂'),
      h('button', { class: 'tiny', help: 'Rotate the series one step right.', 'aria-label': `Rotate ${s.name} right`, onclick: () => this.app.rotate(s.id, 1) }, '▸'),
      h('button', { class: 'tiny', help: 'Retrograde: reverse the order of the active cells (loops are kept intact).', 'aria-label': `Retrograde ${s.name}`, onclick: () => this.app.retrograde(s.id) }, '⇆'),
      h('button', { class: 'tiny', help: s.kind === 'pitch' ? 'Shift every value down a semitone (shift-click: an octave).' : 'Lower every value (shift-click: by 10).', 'aria-label': `${s.name} values down`, onclick: (e: MouseEvent) => this.app.offsetSeries(s.id, -(e.shiftKey ? (s.kind === 'pitch' ? 12 : 10) : 1)) }, '−'),
      h('button', { class: 'tiny', help: s.kind === 'pitch' ? 'Shift every value up a semitone (shift-click: an octave).' : 'Raise every value (shift-click: by 10).', 'aria-label': `${s.name} values up`, onclick: (e: MouseEvent) => this.app.offsetSeries(s.id, e.shiftKey ? (s.kind === 'pitch' ? 12 : 10) : 1) }, '+'),
      h(
        'button',
        {
          class: `tiny ${this.openRand.has(s.id) ? 'on' : ''}`,
          help: 'Randomisation settings and limits for this series.',
          'aria-label': `${s.name} randomisation settings`,
          'data-testid': `rand-${s.id}`,
          onclick: () => {
            if (this.openRand.has(s.id)) this.openRand.delete(s.id);
            else this.openRand.add(s.id);
            this.build();
          },
        },
        '±',
      ),
    );
    const root = h(
      'div',
      { class: 'strip', dataset: { series: s.id }, 'data-testid': `strip-${s.id}` },
      h('div', { class: 'strip-head' }, h('b', { help: `Series ${s.name}. ${KIND_HELP[s.kind]}` }, s.name), info, tools),
      cells,
    );
    const entry = { root, cells, sig: '', cellEls: [] as HTMLElement[], info };
    this.strips.set(s.id, entry);
    this.fillCells(s, entry);
    if (this.openRand.has(s.id)) root.appendChild(this.randPanel(s));
    return root;
  }

  private randPanel(s: Series): HTMLElement {
    const r = KIND_RANGE[s.kind];
    const fmt = s.kind === 'pitch' ? (v: number) => noteName(v) : (v: number) => String(v);
    const parse = s.kind === 'pitch' ? (t: string) => (/^\d+$/.test(t) ? Number(t) : noteNumber(t)) : undefined;
    return h(
      'div',
      { class: 'rand-panel' },
      stepper({ label: 'Amount', value: s.rand.amount, min: 0, max: 64, help: 'Size of a random step. With Type 0 it is the spread of a gaussian (bell curve): most changes are smaller than Amount.', onChange: (v) => this.app.setSeriesRand(s.id, { amount: v }) }),
      stepper({ label: 'Type', value: s.rand.type, min: 0, max: 12, help: 'Type 0: gaussian steps. Type n: steps are exact multiples of Amount, from 1 to n times, up or down.', onChange: (v) => this.app.setSeriesRand(s.id, { type: v }) }),
      stepper({ label: 'Prob %', value: s.rand.prob, min: 0, max: 100, step: 5, help: 'Chance that a ? or ~ cell is randomised each time it is read.', onChange: (v) => this.app.setSeriesRand(s.id, { prob: v }) }),
      stepper({ label: 'Low', value: s.lo, min: r.min, max: r.max, format: fmt, parse, big: 12, help: 'Lower limit for every value read from this series (randomised or not).', onChange: (v) => this.app.setSeriesRand(s.id, { lo: v }) }),
      stepper({ label: 'High', value: s.hi, min: r.min, max: r.max, format: fmt, parse, big: 12, help: 'Upper limit for every value read from this series.', onChange: (v) => this.app.setSeriesRand(s.id, { hi: v }) }),
    );
  }

  private fillCells(s: Series, entry: { cells: HTMLElement; sig: string; cellEls: HTMLElement[]; info: HTMLElement }): void {
    const bank = this.app.project.series;
    const sig = JSON.stringify(s.cells) + (s.cells.some((c) => c.t === 'link') ? bank.map((b) => b.name).join() : '');
    if (sig === entry.sig) return;
    entry.sig = sig;
    const act = activeLength(s);
    entry.cellEls = s.cells.map((c, i) => {
      const cls = ['cell', c.t === 'v' ? 'val' : 'ctl', `c-${c.t}`, i > act ? 'dormant' : '', c.t === 'v' && c.r ? `r${c.r}` : ''].filter(Boolean).join(' ');
      return h(
        'button',
        {
          class: cls,
          role: 'listitem',
          help: CELL_HELP[c.t],
          dataset: { index: String(i) },
          'aria-label': `${s.name} cell ${i + 1}: ${cellText(c, s.kind, s, bank)}`,
          onclick: () => this.app.select({ series: s.id, index: i }),
          onwheel: (e: WheelEvent) => {
            if (c.t !== 'v') return;
            e.preventDefault();
            const cur = s.cells[i];
            if (cur && cur.t === 'v') this.app.setValue(s.id, i, cur.v + (e.deltaY < 0 ? 1 : -1));
          },
        },
        h('span', { class: 'marks' }),
        h('span', { class: 'txt' }, cellText(c, s.kind, s, bank)),
      );
    });
    replace(
      entry.cells,
      ...entry.cellEls,
      h('button', { class: 'cell add', help: 'Add a cell at the end of this series.', 'aria-label': `Add cell to ${s.name}`, onclick: () => this.app.appendCell(s.id) }, '+'),
    );
    const cyc = cycleLength(s);
    entry.info.textContent = cyc ? `×${cyc}` : '∅';
    entry.info.dataset.help = `A lone head repeats this series every ${cyc} reads (counting loops and skips). Lines combine series of different lengths, so their notes repeat only after the least common multiple.`;
  }

  refresh(): void {
    for (const s of this.app.project.series) {
      const e = this.strips.get(s.id);
      if (e) this.fillCells(s, e);
    }
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
        const el = this.strips.get(v.series)?.cellEls[v.index];
        if (!el) continue;
        const marks = el.querySelector('.marks')!;
        const dir = this.app.dirOf(line, k);
        const tab = h(
          'span',
          { class: `tab ${v.live ? 'live' : 'ghost'}`, style: { background: v.live ? LINE_COLORS[line] : 'transparent', borderColor: LINE_COLORS[line], color: v.live ? '#fff' : LINE_COLORS[line] } },
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
      if (r.index === null) continue;
      const el = this.strips.get(r.series)?.cellEls[r.index];
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
    const el = this.strips.get(sel.series)?.cellEls[sel.index];
    el?.classList.add('sel');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

