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
      'Feelers plays four lines. Every note of a line is assembled from four parameter columns: ',
      h('b', {}, 'Time'),
      ' (the wait before the note), ',
      h('b', {}, 'Pitch'),
      ', ',
      h('b', {}, 'Velocity'),
      ' and ',
      h('b', {}, 'S/L'),
      ' (staccato/legato: the note\'s length in sixteenths of the next Time value). Each line has one head in a column of each kind. The heads move independently, one element per note, so series of different lengths slide against each other and the combinations keep changing.',
    ),
    h('p', {}, 'Watch the numbered tabs in the series bank: they show which element each line\'s heads just read. The line panels show the four values and the note they made.'),
    h('h3', {}, 'Things to try'),
    h(
      'ul',
      {},
      h('li', {}, 'Press START (or Space). Click ♪ PREVIEW to hear it without MIDI hardware.'),
      h('li', {}, 'Click a pitch element and press ↑ / ↓ while it plays: the next time a head reads it, the new note is heard.'),
      h('li', {}, 'Click → next to a head to reverse it. Reverse only pitch, and the melody runs backwards against an unchanged rhythm.'),
      h('li', {}, 'Change TIME× on one line (try 1.5, or 1.01) and hear it drift against the others.'),
      h('li', {}, 'Put Skips (key S) on every C# of a column before you start, then take them off one by one while it plays.'),
      h('li', {}, 'Mark an element END (key E): the column splits into two series. Use HEAD HERE to move a line into the second one.'),
      h('li', {}, 'Turn on SCALE and pick a scale: notes outside it move, and you can see which ones and by how much.'),
      h('li', {}, 'Press STORE then 1 to remember the current state; wander off; press 1 to come back.'),
    ),
    h('h3', {}, 'Series control elements'),
    h('p', { class: 'small-print' }, 'As in Fingers, these are marks on an element: switching one off leaves the value in place. Only a Loop takes a slot of its own.'),
    h(
      'dl',
      {},
      h('dt', {}, 'S  Skip'),
      h('dd', {}, 'Heads pass over the element, in either direction. Its value stays, ready for when the Skip is removed. A Skip overrides a Loop or rest on the same element; an END there still applies.'),
      h('dt', {}, 'R  Rest,  r  rest'),
      h('dd', {}, 'The note is silent. With R only the Time head and the head that read the Rest move on; the others wait, which shifts the line against itself. With r every head moves on.'),
      h('dt', {}, 'L  Loop'),
      h('dd', {}, 'Repeats everything above it in its series (from the start, or from the previous Loop) the given number of extra times; 0 repeats forever. Heads moving backwards ignore Loops.'),
      h('dt', {}, '|  End of Series'),
      h('dd', {}, 'The element is the last of its series; the elements below it form a separate series. A gap in the strip shows the split.'),
      h('dt', {}, '→  Column Link'),
      h('dd', {}, 'Set on a column: its bottom continues at the top of the next column of the same kind to the right (the rightmost wraps to the leftmost), so linked columns play as one long series.'),
      h('dt', {}, '?  and  ¿'),
      h('dd', {}, 'Auto-randomise: when read, the value may change by the Amount and Type of its kind (± beside each kind). Each mark has its own probability. The change is kept, so the music wanders; RESTORE brings everything back to the last Start.'),
      h('dt', {}, '~  WOBBLE (Feelers extension)'),
      h('dd', {}, 'Like ? but the stored value is never changed: the value read is displaced, then the element returns to itself.'),
    ),
    h('h3', {}, 'Scale Mode'),
    h(
      'p',
      {},
      'A modern Feelers facility, not part of Fingers. When SCALE is on, each line that follows it (G in its panel) plays its pitches moved into the chosen scale: nearest (a tie goes up), down or up. A line can use its own scale (OWN) or ignore Scale Mode (OFF). ' +
        'The order is: series value, then line transposition, then the scale. The stored series never change. A moved note shows in its line panel as source → output (C#4 → D4 +1); in the bank, Pitch elements the scale would move are underlined with the change in the corner, for the global scale (G) or for one line (1-4).',
    ),
    h('h3', {}, 'Transport'),
    h(
      'dl',
      {},
      h('dt', {}, 'START'),
      h('dd', {}, 'Begins from the defined starting state: heads on their start elements and directions, loops cleared, random seed reset. Each line\'s first note sounds after its delay; from then on every note waits its own Time value.'),
      h('dt', {}, 'RESTORE'),
      h('dd', {}, 'Restore Last Start: every series value and line setting goes back to how it was at the last Start, undoing edits and the changes made by ? and ¿. Press again to undo the restore.'),
      h('dt', {}, 'PAUSE / CONTINUE'),
      h('dd', {}, 'Pause keeps everything, including how long each line still has to wait. With CLOCK OUT on, Pause sends MIDI Stop and Continue sends MIDI Continue.'),
      h('dt', {}, 'STOP'),
      h('dd', {}, 'Silences immediately and returns to the beginning (MIDI Stop + Song Position 0 with CLOCK OUT).'),
      h('dt', {}, 'While stopped'),
      h('dd', {}, 'Direction changes, HEAD HERE and the SHIFT buttons edit the starting state. While playing they act on the performance.'),
      h('dt', {}, 'NOTES: AS WRITTEN / LEGATO / MONO'),
      h('dd', {}, 'AS WRITTEN keeps every note\'s length, so S/L over 16 overlaps the next note (as in Fingers). LEGATO overlaps only for an instant (glide on mono synths). MONO is strict monophony. A repeated pitch is always released before it sounds again.'),
    ),
    h('h3', {}, 'External clock (SYNC)'),
    h(
      'dl',
      {},
      h('dt', {}, 'INT / EXT'),
      h('dd', {}, 'INT: Feelers sets tempo and transport. EXT: follow 24 PPQN MIDI Clock from the chosen MIDI input; each clock pulse advances Feelers one tick, so the device drives every note.'),
      h('dt', {}, 'Start / Stop / Continue'),
      h('dd', {}, 'From the device: Start begins afresh, Stop releases notes and keeps the position, Continue resumes from there. Clock alone never starts Feelers.'),
      h('dt', {}, 'Status'),
      h('dd', {}, 'WAITING (no clock), CLOCK (clock, not started), RUNNING, STOPPED, LOST (clock vanished: notes released, position held, carries on with the next pulse). IN shows the measured tempo, for information only.'),
      h('dt', {}, 'Clock out'),
      h('dd', {}, 'Off while following, so clock is never echoed back. Local STOP still works; START and PAUSE come from the device.'),
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
      h('dt', {}, '← → (element selected)'),
      h('dd', {}, 'Move selection; ↑ ↓ change value (Shift: octave / 10)'),
      h('dt', {}, 'Enter'),
      h('dd', {}, 'Type a value for the selected element'),
      h('dt', {}, 'S  E  R'),
      h('dd', {}, 'Skip on/off, End of Series on/off, Rest → rest → none'),
      h('dt', {}, 'A  W'),
      h('dd', {}, 'Auto-randomise ? → ¿ → none, WOBBLE on/off'),
      h('dt', {}, 'L  B  V  K'),
      h('dd', {}, 'Loop / value, blank, value, Column Link of the column'),
      h('dt', {}, 'Insert / Delete'),
      h('dd', {}, 'Insert an element / delete the selected element'),
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
