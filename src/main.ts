import { App } from './app';
import { BankView } from './ui/bank';
import { h } from './ui/dom';
import { EditorView } from './ui/editor';
import { StatusLine, helpContent } from './ui/help';
import { LinesView } from './ui/lines';
import { MonitorView } from './ui/monitor';
import { PaletteLibrary, applyPalette } from './ui/palette';
import { MenuPanel, TopBar } from './ui/topbar';
import './ui/style.css';

// Palette first, so the first paint already has the chosen colours.
const palettes = new PaletteLibrary();
applyPalette(palettes.selected);

const app = new App();
const menu = new MenuPanel(app, helpContent, palettes);
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
document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') {
    e.preventDefault();
    // Do not let a focused button also receive the key as a click.
    if (target instanceof HTMLButtonElement) target.blur();
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
  const c = app.column(sel.col);
  if (!c) return;
  const el = c.els[sel.index];
  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowRight': {
      e.preventDefault();
      const i = Math.min(c.els.length - 1, Math.max(0, sel.index + (e.key === 'ArrowLeft' ? -1 : 1)));
      app.select({ col: c.id, index: i });
      return;
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      e.preventDefault();
      if (!el || el.v === null || el.loop !== undefined) return;
      const big = c.kind === 'pitch' ? 12 : 10;
      app.setValue(c.id, sel.index, el.v + (e.shiftKey ? big : 1) * (e.key === 'ArrowUp' ? 1 : -1));
      return;
    }
    case 'Enter':
      e.preventDefault();
      editor.focusValue();
      return;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      app.deleteEl();
      return;
    case 'Insert':
      e.preventDefault();
      app.insertEl(true);
      return;
  }
  const actions: Record<string, () => void> = {
    s: () => app.toggleSkip(),
    r: () => app.setRest(),
    e: () => app.toggleEnd(),
    l: () => app.setSlot(el?.loop !== undefined ? 'value' : 'loop'),
    b: () => app.setSlot('blank'),
    v: () => app.setSlot('value'),
    a: () => app.setAutoRand(el?.ar === 1 ? 2 : el?.ar === 2 ? 0 : 1),
    w: () => app.setAutoRand(el?.ar === 3 ? 0 : 3),
    k: () => app.toggleLink(c.id),
  };
  const fn = actions[e.key.toLowerCase()];
  if (fn) {
    e.preventDefault();
    fn();
  }
});

// MIDI is requested on load; browsers that need a gesture will prompt.
void app.requestMidi();

// Expose for debugging and browser tests.
(window as unknown as { feelers: App; feelersPalettes: PaletteLibrary }).feelers = app;
(window as unknown as { feelersPalettes: PaletteLibrary }).feelersPalettes = palettes;
