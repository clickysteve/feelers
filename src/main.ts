import { App } from './app';
import type { Cell } from './engine/types';
import { BankView } from './ui/bank';
import { h } from './ui/dom';
import { EditorView } from './ui/editor';
import { StatusLine, helpContent } from './ui/help';
import { LinesView } from './ui/lines';
import { MonitorView } from './ui/monitor';
import { MenuPanel, TopBar } from './ui/topbar';
import './ui/style.css';

const app = new App();
const menu = new MenuPanel(app, helpContent);
const top = new TopBar(app, menu);
const editor = new EditorView(app);
const bank = new BankView(app);
const lines = new LinesView(app);
const monitor = new MonitorView(app);
const status = new StatusLine(app);

const root = document.getElementById('app')!;
root.append(
  top.el,
  h('main', { class: 'layout' }, h('div', { class: 'bank-wrap' }, editor.el, bank.el), lines.el, monitor.el),
  status.el,
  menu.el,
);

// Keep sticky elements below the (wrapping) top bar.
new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${top.el.offsetHeight}px`)).observe(top.el);

// Animation loop: visual feedback is driven from the sounding times of notes.
const loop = (t: number) => {
  app.frame(t);
  top.tick();
  monitor.draw(t);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

// Keyboard shortcuts (inputs stop propagation of their own keys).
const typeKeys: Record<string, Cell['t']> = { r: 'rest', s: 'skip', e: 'end', l: 'link', '[': 'open', ']': 'close', v: 'v' };
document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') {
    e.preventDefault();
    app.togglePlay();
    return;
  }
  if (e.key === 'Escape') {
    if (app.selection) app.select(null);
    else app.stop();
    menu.close();
    return;
  }
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit) {
    e.preventDefault();
    if (e.shiftKey) app.storeMode = true;
    app.snapshotSlot(Number(digit[1]) - 1);
    return;
  }
  const sel = app.selection;
  if (!sel) return;
  const s = app.engine.series(sel.series);
  if (!s) return;
  const c = s.cells[sel.index];
  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowRight': {
      e.preventDefault();
      const i = Math.min(s.cells.length - 1, Math.max(0, sel.index + (e.key === 'ArrowLeft' ? -1 : 1)));
      app.select({ series: s.id, index: i });
      return;
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      e.preventDefault();
      if (c?.t !== 'v') return;
      const big = s.kind === 'pitch' ? 12 : 10;
      app.setValue(s.id, sel.index, c.v + (e.shiftKey ? big : 1) * (e.key === 'ArrowUp' ? 1 : -1));
      return;
    }
    case 'Enter':
      e.preventDefault();
      editor.focusValue();
      return;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      app.deleteCell();
      return;
    case 'Insert':
      e.preventDefault();
      app.insertCell(true);
      return;
  }
  const t = typeKeys[e.key.toLowerCase()];
  if (t) {
    e.preventDefault();
    app.setCellType(t);
  }
});

// MIDI is requested on load; browsers that need a gesture will prompt.
void app.requestMidi();

// Expose for debugging and browser tests.
(window as unknown as { feelers: App }).feelers = app;
