/**
 * The cell editor: acts on the selected cell. Everything is reachable by
 * buttons; the keyboard shortcuts are accelerators, listed in the help.
 */
import type { App } from '../app';
import { noteName, noteNumber } from '../engine/factory';
import type { Cell } from '../engine/types';
import { KIND_LABEL, KIND_RANGE } from '../engine/types';
import { LINE_COLORS } from './bank';
import { h, replace } from './dom';

export class EditorView {
  el: HTMLElement;
  private input: HTMLInputElement | null = null;

  constructor(private app: App) {
    this.el = h('div', { class: 'editor', 'aria-label': 'Cell editor', 'data-testid': 'editor' });
    app.on('selection', () => this.render());
    app.on('bank', () => this.render());
    app.on('project', () => this.render());
    this.render();
  }

  focusValue(): void {
    this.input?.focus();
    this.input?.select();
  }

  render(): void {
    const app = this.app;
    const sel = app.selection;
    const s = sel ? app.engine.series(sel.series) : undefined;
    const c = s && sel ? s.cells[sel.index] : undefined;
    if (!sel || !s || !c) {
      this.input = null;
      replace(
        this.el,
        h('span', { class: 'ed-title' }, 'EDIT'),
        h('span', { class: 'hint' }, 'Select a cell in the bank to edit it. Edits are heard the next time a head reads that cell, even while playing.'),
      );
      return;
    }
    const kind = s.kind;
    const r = KIND_RANGE[kind];
    const isVal = c.t === 'v';
    const fmt = (v: number) => (kind === 'pitch' ? noteName(v) : String(v));
    const input = h('input', {
      class: 'num wide',
      value: isVal ? fmt(c.v) : '',
      disabled: !isVal,
      'aria-label': 'Cell value',
      'data-testid': 'cell-value',
      help: kind === 'pitch' ? 'Type a note name (C4, F#3, Bb2) or a MIDI number, then Enter.' : `Type a value ${r.min}-${r.max}, then Enter.`,
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        commit();
        input.blur();
      } else if (e.key === 'Escape') input.blur();
      e.stopPropagation();
    });
    input.addEventListener('change', () => commit());
    const commit = () => {
      if (!isVal) return;
      const t = input.value.trim();
      const v = /^-?\d+$/.test(t) ? Number(t) : kind === 'pitch' ? noteNumber(t) : null;
      if (v === null) {
        input.value = fmt((c as { v: number }).v);
        app.setStatus(`"${t}" is not a valid ${KIND_LABEL[kind].toLowerCase()} value.`);
        return;
      }
      app.setValue(s.id, sel.index, v);
    };
    this.input = input;
    const bump = (d: number) => {
      const cur = s.cells[sel.index];
      if (cur && cur.t === 'v') app.setValue(s.id, sel.index, cur.v + d);
    };
    const big = kind === 'pitch' ? 12 : 10;
    const typeBtn = (t: Cell['t'], label: string, help: string) =>
      h('button', { class: `seg ${c.t === t ? 'on' : ''}`, help, 'data-testid': `el-${t}`, onclick: () => app.setCellType(t) }, label);
    const randBtn = (rf: 0 | 1 | 2, label: string, help: string) =>
      h('button', { class: `seg ${isVal && (c.r ?? 0) === rf ? 'on' : ''}`, disabled: !isVal, help, 'data-testid': `rand-flag-${rf}`, onclick: () => app.setRandFlag(rf) }, label);

    replace(
      this.el,
      h('span', { class: 'ed-title' }, 'EDIT ', h('b', {}, `${s.name}·${sel.index + 1}`)),
      h(
        'span',
        { class: 'grp' },
        h('button', { class: 'tiny', disabled: !isVal, 'aria-label': 'Value down', help: `Lower the value (shift-click: by ${big}).`, onclick: (e: MouseEvent) => bump(e.shiftKey ? -big : -1) }, '−'),
        input,
        h('button', { class: 'tiny', disabled: !isVal, 'aria-label': 'Value up', help: `Raise the value (shift-click: by ${big}).`, onclick: (e: MouseEvent) => bump(e.shiftKey ? big : 1) }, '+'),
      ),
      h(
        'span',
        { class: 'grp seggrp', role: 'group', 'aria-label': 'Element type' },
        typeBtn('v', 'VALUE', 'Make this cell a value.'),
        typeBtn('rest', 'REST', 'Make this cell a rest: the note read here is silent.'),
        typeBtn('skip', 'SKIP', 'Make this cell a skip: the head jumps the next value.'),
        typeBtn('open', '[', 'Loop start bracket.'),
        typeBtn('close', ']', 'Loop end bracket (set the repeat count next to it).'),
        typeBtn('end', 'END', 'End of series: later cells are dormant.'),
        typeBtn('link', 'LINK', 'Link: continue into the next series of the same kind.'),
      ),
      c.t === 'close'
        ? h(
            'span',
            { class: 'grp' },
            h('span', { class: 'lbl' }, '×'),
            (() => {
              const n = h('input', { class: 'num', value: String(c.n), 'aria-label': 'Loop count', 'data-testid': 'loop-count', help: 'How many times the bracketed section plays in total (1-999).' });
              n.addEventListener('change', () => app.setLoopCount(Number(n.value)));
              n.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') n.blur();
                e.stopPropagation();
              });
              return n;
            })(),
          )
        : null,
      h(
        'span',
        { class: 'grp seggrp', role: 'group', 'aria-label': 'Randomisation' },
        randBtn(0, 'FIXED', 'This value is never randomised.'),
        randBtn(1, '? WOBBLE', 'Wobble: when read, the value may be displaced (see the series ⚄ settings); the stored value stays.'),
        randBtn(2, '~ DRIFT', 'Drift: when read, the value may be displaced and the change is kept, so it wanders.'),
      ),
      h(
        'span',
        { class: 'grp' },
        h('button', { class: 'small', help: 'Insert a cell before this one (Insert key).', onclick: () => app.insertCell(false) }, '+◂'),
        h('button', { class: 'small', help: 'Insert a cell after this one.', onclick: () => app.insertCell(true) }, '▸+'),
        h('button', { class: 'small', help: 'Delete this cell (Delete key).', 'data-testid': 'delete-cell', onclick: () => app.deleteCell() }, 'DEL'),
      ),
      h(
        'span',
        { class: 'grp' },
        h('span', { class: 'lbl', help: 'Move a line\'s head to this cell. While stopped this sets where the head starts.' }, 'HEAD HERE'),
        ...[0, 1, 2, 3].map((l) =>
          h(
            'button',
            {
              class: 'small headbtn',
              style: { borderColor: LINE_COLORS[l], color: LINE_COLORS[l] },
              help: `Put line ${l + 1}'s ${KIND_LABEL[kind]} head on this cell (switching it to ${s.name} if needed).`,
              'data-testid': `place-${l}`,
              onclick: () => app.placeHead(l, kind, s.id, sel.index),
            },
            String(l + 1),
          ),
        ),
      ),
    );
  }
}
