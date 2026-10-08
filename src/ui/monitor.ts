/**
 * Performance monitor: the "field" where the four feelers reach out over
 * time (pitch vertical, time scrolling left, thickness = velocity, length =
 * duration), and a MIDI message log. Purely a view of the output stream.
 */
import type { App } from '../app';
import type { NoteEvent } from '../engine/engine';
import { noteName } from '../engine/factory';
import { h, replace } from './dom';

const COLORS = ['#ff7a45', '#4da3ff', '#4cd07d', '#d27ae6'];
const WINDOW_MS = 9000;

interface Trace {
  line: number;
  on: number;
  off: number;
  pitch: number;
  vel: number;
}

export class MonitorView {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private log: HTMLElement;
  private traces: Trace[] = [];
  private lastLog = -1;
  private logOpen = true;
  private clockEl: HTMLElement;

  constructor(private app: App) {
    this.canvas = h('canvas', { class: 'field', 'aria-label': 'Feeler field: recent notes of all four lines', role: 'img', 'data-testid': 'field' });
    this.log = h('div', { class: 'log', 'aria-label': 'MIDI output log', role: 'log', 'data-testid': 'midi-log' });
    this.clockEl = h('span', { class: 'small-print' });
    const toggle = h('button', { class: 'tiny', help: 'Show or hide the MIDI message log.', onclick: () => { this.logOpen = !this.logOpen; this.el.classList.toggle('nolog', !this.logOpen); } }, 'LOG');
    this.el = h(
      'section',
      { class: 'monitor panel', 'aria-label': 'Performance monitor' },
      h('div', { class: 'panel-title' }, h('span', { help: 'Every note sent, per line: height is pitch, thickness is velocity, length is duration. Newest at the right.' }, 'Field'), h('span', { class: 'legend' }, this.clockEl, ' ', toggle)),
      h('div', { class: 'mon-body' }, h('div', { class: 'field-wrap' }, this.canvas), this.log),
    );
    app.noteListeners.add((ev, offMs) => this.add(ev, offMs));
    app.on('transport', () => {
      if (app.transport === 'stopped') this.traces = [];
    });
  }

  private add(ev: NoteEvent, offMs: number): void {
    if (ev.silent) return;
    const on = performance.now();
    this.traces.push({ line: ev.line, on, off: on + Math.max(30, offMs - on), pitch: ev.pitch, vel: ev.velocity });
    if (this.traces.length > 2000) this.traces.splice(0, 500);
  }

  draw(now: number): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const hgt = c.clientHeight;
    if (w === 0 || hgt === 0) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(hgt * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#10141a';
    g.fillRect(0, 0, w, hgt);
    // octave guides
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    g.font = '9px ui-monospace, Menlo, monospace';
    g.fillStyle = 'rgba(255,255,255,0.25)';
    const lo = 24;
    const hi = 100;
    const y = (p: number) => hgt - 6 - ((Math.min(hi, Math.max(lo, p)) - lo) / (hi - lo)) * (hgt - 12);
    for (let p = 24; p <= 96; p += 12) {
      g.beginPath();
      g.moveTo(0, y(p) + 0.5);
      g.lineTo(w, y(p) + 0.5);
      g.stroke();
      g.fillText(noteName(p), 3, y(p) - 2);
    }
    const x = (t: number) => w - 24 - ((now - t) / WINDOW_MS) * (w - 40);
    this.traces = this.traces.filter((t) => now - t.off < WINDOW_MS);
    // tendrils: connect successive notes of each line
    for (let line = 0; line < 4; line++) {
      const ts = this.traces.filter((t) => t.line === line && t.on <= now);
      if (!ts.length) continue;
      const col = COLORS[line]!;
      g.strokeStyle = col;
      g.globalAlpha = 0.35;
      g.lineWidth = 1;
      g.beginPath();
      ts.forEach((t, i) => {
        const px = x(t.on);
        const py = y(t.pitch);
        if (i === 0) g.moveTo(px, py);
        else {
          const prev = ts[i - 1]!;
          const mx = (x(prev.on) + px) / 2;
          g.bezierCurveTo(mx, y(prev.pitch), mx, py, px, py);
        }
      });
      g.stroke();
      g.globalAlpha = 1;
      for (const t of ts) {
        const x0 = x(t.on);
        const x1 = Math.max(x0 + 2, x(Math.min(now, t.off)));
        const th = 2 + (t.vel / 127) * 6;
        const sounding = now < t.off;
        g.fillStyle = col;
        g.globalAlpha = sounding ? 1 : 0.75;
        g.fillRect(x0, y(t.pitch) - th / 2, x1 - x0, th);
        if (sounding) {
          g.globalAlpha = 0.35;
          g.beginPath();
          g.arc(x1, y(t.pitch), th + 3, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.globalAlpha = 1;
      // tip label
      const last = ts[ts.length - 1]!;
      g.fillStyle = col;
      g.font = 'bold 11px ui-monospace, Menlo, monospace';
      g.fillText(String(line + 1), w - 16, y(last.pitch) + 4);
    }
    this.drawLog();
  }

  private drawLog(): void {
    const m = this.app.monitor;
    this.clockEl.textContent = this.app.clockCount ? `clock ×${this.app.clockCount}` : '';
    if (!this.logOpen || m.length === 0) return;
    const lastT = m[m.length - 1]!.t + m.length;
    if (lastT === this.lastLog) return;
    this.lastLog = lastT;
    const rows = m.slice(-40).reverse();
    replace(this.log, ...rows.map((r) => h('div', { class: 'log-row' }, h('span', { class: 't' }, (r.t / 1000).toFixed(3)), ' ', r.text)));
  }
}
