/**
 * The element editor: acts on the selected element. Everything is reachable
 * by buttons; the keyboard shortcuts are accelerators, listed in the help.
 *
 * As in Fingers, the series control elements are attributes of an element
 * (Skip, Rest / rest, End, the randomise marks) that can be switched on and
 * off without losing its value. Only a Loop replaces the element.
 */
import type { App } from '../app';
import { noteName, noteNumber } from '../engine/factory';
import type { AutoRand, RestMark } from '../engine/types';
import { KIND_LABEL, KIND_RANGE, MAX_LOOP } from '../engine/types';
import { LINE_COLORS } from './bank';
import { h, replace } from './dom';

export class EditorView {
  el: HTMLElement;
  private input: HTMLInputElement | null = null;

  constructor(private app: App) {
    this.el = h('div', { class: 'editor', 'aria-label': 'Element editor', 'data-testid': 'editor' });
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
    const c = sel ? app.column(sel.col) : undefined;
    const e = c && sel ? c.els[sel.index] : undefined;
    if (!sel || !c || !e) {
      this.input = null;
      replace(
        this.el,
        h('span', { class: 'ed-title' }, 'EDIT'),
        h('span', { class: 'hint' }, 'Select an element in the bank to edit it. Edits are heard the next time a head reads it, even while playing.'),
      );
      return;
    }
    const kind = c.kind;
    const r = KIND_RANGE[kind];
    const isLoop = e.loop !== undefined;
    const fmt = (v: number) => (kind === 'pitch' ? noteName(v) : String(v));
    const input = h('input', {
      class: 'num wide',
      value: isLoop ? '' : e.v === null ? '' : fmt(e.v),
      placeholder: isLoop ? 'loop' : 'blank',
      disabled: isLoop,
      'aria-label': 'Element value',
      'data-testid': 'cell-value',
      help: kind === 'pitch' ? 'Type a note name (C4, F#3, Bb2) or a MIDI number, then Enter. Typing into a blank element gives it a value.' : `Type a value ${r.min}-${r.max}, then Enter.`,
    });
    const commit = () => {
      if (isLoop) return;
      const t = input.value.trim();
      if (t === '') return;
      const v = /^-?\d+$/.test(t) ? Number(t) : kind === 'pitch' ? noteNumber(t) : null;
      if (v === null) {
        input.value = e.v === null ? '' : fmt(e.v);
        app.setStatus(`"${t}" is not a valid ${KIND_LABEL[kind].toLowerCase()} value.`);
        return;
      }
      app.setValue(c.id, sel.index, v);
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        commit();
        input.blur();
      } else if (ev.key === 'Escape') input.blur();
      ev.stopPropagation();
    });
    input.addEventListener('change', () => commit());
    this.input = input;
    const bump = (d: number) => {
      const cur = c.els[sel.index];
      if (cur && cur.v !== null && cur.loop === undefined) app.setValue(c.id, sel.index, cur.v + d);
    };
    const big = kind === 'pitch' ? 12 : 10;
    const slot = isLoop ? 'loop' : e.v === null ? 'blank' : 'value';
    const slotBtn = (k: 'value' | 'blank' | 'loop', label: string, help: string) =>
      h('button', { class: `seg ${slot === k ? 'on' : ''}`, 'aria-pressed': String(slot === k), help, 'data-testid': `slot-${k}`, onclick: () => app.setSlot(k) }, label);
    const toggle = (on: boolean, label: string, help: string, testid: string, fn: () => void, disabled = false) =>
      h('button', { class: `seg nocase ${on ? 'on' : ''}`, 'aria-pressed': String(on), disabled, help, 'data-testid': testid, onclick: fn }, label);
    const restBtn = (m: RestMark | null, label: string, help: string) =>
      toggle((e.rest ?? null) === m, label, help, `rest-${m ?? 'none'}`, () => app.setRest(m), isLoop);
    const arBtn = (a: AutoRand | 0, label: string, help: string) => toggle((e.ar ?? 0) === a, label, help, `ar-${a}`, () => app.setAutoRand(a), isLoop);

    replace(
      this.el,
      h('span', { class: 'ed-title' }, 'EDIT ', h('b', {}, `${c.name}·${sel.index + 1}`)),
      h(
        'span',
        { class: 'grp' },
        h('button', { class: 'tiny', disabled: isLoop || e.v === null, 'aria-label': 'Value down', help: `Lower the value (shift-click: by ${big}).`, onclick: (ev: MouseEvent) => bump(ev.shiftKey ? -big : -1) }, '−'),
        input,
        h('button', { class: 'tiny', disabled: isLoop || e.v === null, 'aria-label': 'Value up', help: `Raise the value (shift-click: by ${big}).`, onclick: (ev: MouseEvent) => bump(ev.shiftKey ? big : 1) }, '+'),
      ),
      h(
        'span',
        { class: 'grp seggrp', role: 'group', 'aria-label': 'Element' },
        slotBtn('value', 'VALUE', 'A value (key V).'),
        slotBtn('blank', 'BLANK', 'A blank element: heads pass over it (key B).'),
        slotBtn('loop', 'LOOP', 'A Loop element: it takes this slot and repeats everything above it in its series (from the start, or from the previous Loop). Ignored by heads moving backwards (key L).'),
      ),
      isLoop
        ? h(
            'span',
            { class: 'grp' },
            h('span', { class: 'lbl' }, '×'),
            (() => {
              const n = h('input', { class: 'num', value: String(e.loop), 'aria-label': 'Loop count', 'data-testid': 'loop-count', help: `How many more times the section repeats (0-${MAX_LOOP}; 0 repeats forever).` });
              n.addEventListener('change', () => app.setLoopCount(Number(n.value)));
              n.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') n.blur();
                ev.stopPropagation();
              });
              return n;
            })(),
          )
        : null,
      h(
        'span',
        { class: 'grp seggrp', role: 'group', 'aria-label': 'Marks' },
        toggle(!!e.skip, 'SKIP', 'Skip: heads pass over this element; switch it off and the value is still there (key S).', 'mark-skip', () => app.toggleSkip()),
        toggle(!!e.end, 'END', 'End of Series: this element ends its series; the elements below it form another series (key E).', 'mark-end', () => app.toggleEnd()),
      ),
      h(
        'span',
        { class: 'grp seggrp', role: 'group', 'aria-label': 'Rest' },
        restBtn(null, 'NO REST', 'Not a rest.'),
        restBtn('R', 'REST R', 'Rest: the note is silent; only the Time head and this head move on, the others wait (key R cycles).'),
        restBtn('r', 'rest r', 'rest: the note is silent; every head moves on.'),
      ),
      h(
        'span',
        { class: 'grp seggrp', role: 'group', 'aria-label': 'Randomise' },
        arBtn(0, 'FIXED', 'Never randomised.'),
        arBtn(1, '?', 'Auto-randomise with the first probability: when read it may change, and the change is kept (key A cycles ? and ¿).'),
        arBtn(2, '¿', 'Auto-randomise with the second probability (often set low, for rare changes). The change is kept.'),
        arBtn(3, '~ WOBBLE', 'WOBBLE (Feelers extension): when read the value may be displaced, but the stored value stays (key W).'),
      ),
      h(
        'span',
        { class: 'grp' },
        h('button', { class: 'small', help: 'Insert an element before this one (Insert key). A column holds 16.', onclick: () => app.insertEl(false) }, '+◂'),
        h('button', { class: 'small', help: 'Insert an element after this one.', onclick: () => app.insertEl(true) }, '▸+'),
        h('button', { class: 'small', help: 'Delete this element (Delete key).', 'data-testid': 'delete-cell', onclick: () => app.deleteEl() }, 'DEL'),
      ),
      h(
        'span',
        { class: 'grp' },
        h('span', { class: 'lbl', help: 'Move a line\'s head to this element. While stopped this sets where the head starts.' }, 'HEAD HERE'),
        ...[0, 1, 2, 3].map((l) =>
          h(
            'button',
            {
              class: 'small headbtn',
              style: { '--lc': LINE_COLORS[l] },
              help: `Put line ${l + 1}'s ${KIND_LABEL[kind]} head on this element (switching it to ${c.name} if needed).`,
              'data-testid': `place-${l}`,
              onclick: () => app.placeHead(l, kind, c.id, sel.index),
            },
            String(l + 1),
          ),
        ),
      ),
    );
  }
}
