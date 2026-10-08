/**
 * Contextual help: a status line that explains whatever the pointer is over
 * (every control carries a data-help text), and the full help panel.
 */
import type { App } from '../app';
import { h } from './dom';

export class StatusLine {
  el: HTMLElement;
  private hovering = '';

  constructor(private app: App) {
    this.el = h('footer', { class: 'status', role: 'status', 'aria-live': 'polite', 'data-testid': 'status' });
    document.addEventListener('mouseover', (e) => {
      const t = (e.target as Element | null)?.closest?.('[data-help]') as HTMLElement | null;
      this.hovering = t?.dataset.help ?? '';
      this.render();
    });
    document.addEventListener('focusin', (e) => {
      const t = (e.target as Element | null)?.closest?.('[data-help]') as HTMLElement | null;
      if (t?.dataset.help) {
        this.hovering = t.dataset.help;
        this.render();
      }
    });
    app.on('status', () => {
      this.hovering = '';
      this.render();
    });
    this.render();
  }

  private render(): void {
    this.el.textContent = this.hovering || this.app.status || 'Hover over anything for an explanation. Space: start / pause / continue. Esc: stop.';
    this.el.classList.toggle('hint', !!this.hovering);
  }
}

export function helpContent(): HTMLElement {
  return h(
    'div',
    { class: 'help' },
    h('h2', {}, 'How Feelers works'),
    h(
      'p',
      {},
      'Feelers plays four monophonic lines. Every note of a line is assembled from four separate parameter series: ',
      h('b', {}, 'Time'),
      ' (when the next note starts), ',
      h('b', {}, 'Pitch'),
      ', ',
      h('b', {}, 'Velocity'),
      ' and ',
      h('b', {}, 'Articulation'),
      ' (how much of the time the note sounds). Each line has one head on a series of each kind. The heads move independently, one cell per note, so series of different lengths slide against each other and the combinations keep changing.',
    ),
    h('p', {}, 'Watch the numbered tabs in the series bank: they show which cell each line\'s heads just read. The NOTE row in each line panel shows the four values and the note they made.'),
    h('h3', {}, 'Things to try'),
    h(
      'ul',
      {},
      h('li', {}, 'Press START (or Space). Click ♪ PREVIEW to hear it without MIDI hardware.'),
      h('li', {}, 'Click a pitch cell and press ↑ / ↓ while it plays: the next time a head reads it, the new note is heard.'),
      h('li', {}, 'Click → next to a head to reverse it. Reverse only pitch, and the melody runs backwards against an unchanged rhythm.'),
      h('li', {}, 'Change TIME× on one line (try 1.5, or 1.01) and hear it drift against the others.'),
      h('li', {}, 'Point two lines at the same pitch series with different time series: a canon.'),
      h('li', {}, 'Put an END cell into a long series to shorten it on the fly; delete it to bring the rest back.'),
      h('li', {}, 'Press STORE then 1 to remember the current state; wander off; press 1 to come back.'),
    ),
    h('h3', {}, 'Series control elements'),
    h(
      'dl',
      {},
      h('dt', {}, 'REST'),
      h('dd', {}, 'The note read here is silent. In a Time series it marks the following time value as a silent gap.'),
      h('dt', {}, 'SKIP'),
      h('dd', {}, 'The head jumps over the next value in its direction of travel.'),
      h('dt', {}, '[ ... ]×n'),
      h('dd', {}, 'Loop: the section plays n times in total. Loops also work when a head runs backwards.'),
      h('dt', {}, 'END'),
      h('dd', {}, 'The series wraps here; later cells are dormant.'),
      h('dt', {}, 'LINK'),
      h('dd', {}, 'The head continues into the next series of the same kind, so two strips can act as one long series.'),
      h('dt', {}, '? WOBBLE / ~ DRIFT'),
      h('dd', {}, 'Randomised values. Wobble displaces the value read; Drift keeps the displacement. Set the step (Amount, Type), probability and limits with the ⚄ button on each series.'),
    ),
    h('h3', {}, 'Transport'),
    h(
      'dl',
      {},
      h('dt', {}, 'START'),
      h('dd', {}, 'Begins from the defined starting state: heads on their start cells and directions, loops cleared, random seed reset. A performance replays identically.'),
      h('dt', {}, 'PAUSE / CONTINUE'),
      h('dd', {}, 'Pause keeps everything, including how long each line still has to wait. With CLOCK OUT on, Pause sends MIDI Stop and Continue sends MIDI Continue.'),
      h('dt', {}, 'STOP'),
      h('dd', {}, 'Silences immediately and returns to the beginning (MIDI Stop + Song Position 0 with CLOCK OUT).'),
      h('dt', {}, 'While stopped'),
      h('dd', {}, 'Direction changes, HEAD HERE and the SHIFT buttons edit the starting state. While playing they act on the performance.'),
    ),
    h('h3', {}, 'Keyboard'),
    h(
      'dl',
      { class: 'keys' },
      h('dt', {}, 'Space'),
      h('dd', {}, 'Start / Pause / Continue'),
      h('dt', {}, 'Esc'),
      h('dd', {}, 'Stop'),
      h('dt', {}, '1-9 / Shift+1-9'),
      h('dd', {}, 'Recall / store performance memory'),
      h('dt', {}, '← → (cell selected)'),
      h('dd', {}, 'Move selection; ↑ ↓ change value (Shift: octave / 10)'),
      h('dt', {}, 'Enter'),
      h('dd', {}, 'Type a value for the selected cell'),
      h('dt', {}, 'R S E L [ ]'),
      h('dd', {}, 'Make the selected cell REST, SKIP, END, LINK, loop start, loop end'),
      h('dt', {}, 'V'),
      h('dd', {}, 'Make it a value again'),
      h('dt', {}, 'Insert / Delete'),
      h('dd', {}, 'Insert a cell / delete the selected cell'),
    ),
    h('h3', {}, 'About'),
    h(
      'p',
      { class: 'small-print' },
      'Feelers is an independent browser-based interactive MIDI composition instrument inspired by the musical concepts explored in Dr. T’s Fingers and MIDI-AX, developed by Emile Tobenfeld. ' +
        'Feelers is not an official port or continuation of either application and is not affiliated with or endorsed by Emile Tobenfeld or any historical publisher or distributor. ' +
        'Feelers is independently implemented and does not distribute the original software or its associated assets.',
    ),
  );
}
