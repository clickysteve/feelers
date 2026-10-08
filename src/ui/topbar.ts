/**
 * Top bar: transport, tempo, MIDI, preview, performance memories and the
 * project menu.
 */
import type { App } from '../app';
import { DEMOS } from '../demos/demos';
import { PPQ } from '../engine/types';
import { deleteFromLibrary, listLibrary, loadFromLibrary } from '../persistence/storage';
import { takeToMidi } from '../persistence/takes';
import { download, h, replace, stepper, type Stepper } from './dom';

export class TopBar {
  el: HTMLElement;
  private startBtn!: HTMLButtonElement;
  private pauseBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private tempo!: Stepper;
  private pos!: HTMLElement;
  private midiSel!: HTMLSelectElement;
  private midiNote!: HTMLElement;
  private clockBtn!: HTMLButtonElement;
  private previewBtn!: HTMLButtonElement;
  private mem!: HTMLElement;
  private title!: HTMLInputElement;

  constructor(private app: App, private menu: MenuPanel) {
    this.el = h('header', { class: 'topbar' });
    this.build();
    app.on('transport', () => this.update());
    app.on('midi', () => this.updateMidi());
    app.on('snapshots', () => this.updateMem());
    app.on('project', () => {
      this.update();
      this.updateMem();
    });
  }

  private build(): void {
    const app = this.app;
    this.startBtn = h('button', { class: 'tbtn start', help: 'Start: begin the performance from its defined starting state (heads at their start cells, random seed reset). Space.', 'data-testid': 'start', onclick: () => app.start() }, '▶ START');
    this.pauseBtn = h('button', { class: 'tbtn', help: 'Pause keeps every head, loop count and line timing; Continue carries on from exactly there. Space.', 'data-testid': 'pause', onclick: () => (app.transport === 'paused' ? app.resume() : app.pause()) }, '❚❚ PAUSE');
    this.stopBtn = h('button', { class: 'tbtn', help: 'Stop/Reset: silence everything now and return to the beginning. Esc.', 'data-testid': 'stop', onclick: () => app.stop() }, '■ STOP');
    this.tempo = stepper({ label: 'BPM', value: app.project.tempo, min: 10, max: 400, big: 10, help: 'Tempo in beats per minute. Changes apply within one scheduling window (about 0.1 s).', testid: 'tempo', onChange: (v) => app.setTempo(v) });
    this.pos = h('span', { class: 'readout pos', help: 'Transport position (bar.beat, counting 4/4) as sent to MIDI clock.' }, '1.1');
    this.midiSel = h('select', { 'aria-label': 'MIDI output', help: 'MIDI output device. The four lines send on their own channels.', 'data-testid': 'midi-out' });
    this.midiSel.addEventListener('change', () => app.selectPort(this.midiSel.value || null));
    this.midiNote = h('span', { class: 'midi-note', 'data-testid': 'midi-status' });
    this.clockBtn = h('button', { class: 'small', help: 'Send MIDI Clock (24 per quarter) with Start / Stop / Continue so external sequencers and modules follow Feelers.', 'data-testid': 'clock', onclick: () => app.setOption('clockOut', !app.project.options.clockOut) }, 'CLOCK OUT');
    this.previewBtn = h('button', { class: 'small', help: 'Built-in audio preview: a simple synth that plays whatever is sent to MIDI. It is only a listener; MIDI output is unaffected.', 'data-testid': 'preview', onclick: () => void app.togglePreview() }, '♪ PREVIEW');
    this.mem = h('span', { class: 'mem', role: 'group', 'aria-label': 'Performance memories' });
    this.title = h('input', { class: 'title', value: app.project.name, 'aria-label': 'Project name', help: 'Project name.' });
    this.title.addEventListener('change', () => app.rename(this.title.value));
    this.title.addEventListener('keydown', (e) => e.stopPropagation());

    replace(
      this.el,
      h('div', { class: 'brand', help: 'Feelers: four musical lines, each assembled from independently moving parameter series.' }, h('span', { class: 'logo' }, 'FEELERS'), h('span', { class: 'tag' }, 'put out the feelers')),
      h('div', { class: 'tgroup' }, this.startBtn, this.pauseBtn, this.stopBtn, this.tempo, this.pos),
      h('div', { class: 'tgroup' }, h('span', { class: 'lbl' }, 'MIDI'), this.midiSel, this.clockBtn, h('button', { class: 'small warn', help: 'Panic: release every note and send All Notes Off / All Sound Off on all 16 channels.', 'data-testid': 'panic', onclick: () => app.panic() }, 'PANIC'), this.previewBtn),
      h('div', { class: 'tgroup' }, this.mem),
      h(
        'div',
        { class: 'tgroup right' },
        this.title,
        h('button', { class: 'small', help: 'Demos, files, takes and options.', 'data-testid': 'menu', onclick: () => this.menu.toggle() }, '☰ PROJECT'),
        h('button', { class: 'small', help: 'How Feelers works, and keyboard shortcuts.', 'data-testid': 'help', onclick: () => this.menu.toggle('help') }, '?'),
      ),
      this.midiNote,
    );
    this.update();
    this.updateMidi();
    this.updateMem();
  }

  update(): void {
    const st = this.app.transport;
    this.startBtn.classList.toggle('on', st === 'playing');
    this.pauseBtn.textContent = st === 'paused' ? '▶ CONTINUE' : '❚❚ PAUSE';
    this.pauseBtn.classList.toggle('on', st === 'paused');
    this.pauseBtn.disabled = st === 'stopped';
    this.tempo.setValue(this.app.sched.bpm);
    this.clockBtn.classList.toggle('on', this.app.project.options.clockOut);
    this.clockBtn.setAttribute('aria-pressed', String(this.app.project.options.clockOut));
    if (document.activeElement !== this.title) this.title.value = this.app.project.name;
    document.body.dataset.transport = st;
  }

  /** Called per animation frame. */
  tick(): void {
    const t = this.app.sched.positionTick();
    const beat = Math.floor(t / PPQ);
    this.pos.textContent = `${Math.floor(beat / 4) + 1}.${(beat % 4) + 1}`;
  }

  updateMidi(): void {
    const app = this.app;
    const opts = [h('option', { value: '' }, app.access.status.state === 'ready' ? '— no output (preview only) —' : '— MIDI off —')];
    for (const p of app.ports) opts.push(h('option', { value: p.id, disabled: !p.connected }, `${p.name}${p.connected ? '' : ' (disconnected)'}`));
    replace(this.midiSel, ...opts);
    this.midiSel.value = app.selectedPort && app.ports.some((p) => p.id === app.selectedPort) ? app.selectedPort : '';
    this.midiNote.textContent = app.midiMessage;
    this.midiNote.className = `midi-note ${app.access.status.state}`;
    this.previewBtn.classList.toggle('on', app.preview.enabled);
    this.previewBtn.setAttribute('aria-pressed', String(app.preview.enabled));
  }

  updateMem(): void {
    const app = this.app;
    replace(
      this.mem,
      h('span', { class: 'lbl', help: 'Performance memories: snapshots of head positions, directions, pauses, mutes, transpositions and time adjust. Click to recall (keys 1-9).' }, 'MEM'),
      ...app.project.snapshots.map((s, i) =>
        h('button', { class: `tiny slot ${s ? 'full' : ''}`, help: s ? `Recall memory ${i + 1}.` : `Memory ${i + 1} is empty.`, 'data-testid': `mem-${i}`, onclick: () => app.snapshotSlot(i) }, String(i + 1)),
      ),
      h(
        'button',
        {
          class: `tiny store ${app.storeMode ? 'on' : ''}`,
          help: 'Store: press, then click a memory slot to keep the current performance state in it (or Shift+1-9).',
          'data-testid': 'mem-store',
          onclick: () => {
            app.storeMode = !app.storeMode;
            this.updateMem();
          },
        },
        'STORE',
      ),
    );
  }
}

/** Slide-out panel for project, demos, takes, options and help. */
export class MenuPanel {
  el: HTMLElement;
  private open: 'menu' | 'help' | null = null;

  constructor(private app: App, private helpContent: () => HTMLElement) {
    this.el = h('aside', { class: 'drawer', 'aria-hidden': 'true', 'data-testid': 'drawer' });
    app.on('takes', () => this.open === 'menu' && this.render());
    app.on('project', () => this.open === 'menu' && this.render());
  }

  toggle(which: 'menu' | 'help' = 'menu'): void {
    this.open = this.open === which ? null : which;
    this.render();
  }

  close(): void {
    this.open = null;
    this.render();
  }

  private render(): void {
    this.el.classList.toggle('open', this.open !== null);
    this.el.setAttribute('aria-hidden', String(this.open === null));
    if (!this.open) {
      replace(this.el);
      return;
    }
    const closeBtn = h('button', { class: 'small close', 'aria-label': 'Close panel', onclick: () => this.close() }, '✕');
    if (this.open === 'help') {
      replace(this.el, closeBtn, this.helpContent());
      return;
    }
    const app = this.app;
    const file = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, 'data-testid': 'import-file' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        app.importJson(await f.text());
      } catch (err) {
        app.setStatus(`Could not open ${f.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
      file.value = '';
    });
    const lib = listLibrary();
    const seedIn = h('input', { class: 'num wide', value: String(app.project.seed), 'aria-label': 'Random seed' });
    seedIn.addEventListener('change', () => app.setSeed(Number(seedIn.value) || 0));
    seedIn.addEventListener('keydown', (e) => e.stopPropagation());
    const opt = (k: 'programOnStart' | 'shiftEdit', label: string, help: string) =>
      h('label', { class: 'opt', help }, h('input', { type: 'checkbox', checked: app.project.options[k], onchange: (e: Event) => app.setOption(k, (e.target as HTMLInputElement).checked) }), ' ', label);
    const notes = h('textarea', { class: 'notes', rows: 4, 'aria-label': 'Project notes' }, app.project.notes);
    notes.addEventListener('change', () => {
      app.project.notes = notes.value.slice(0, 4000);
      app.emit('project');
    });
    notes.addEventListener('keydown', (e) => e.stopPropagation());

    replace(
      this.el,
      closeBtn,
      h('h2', {}, 'Demos'),
      h('p', { class: 'small-print' }, 'Original setups written for Feelers. Loading one replaces the current project (it is autosaved in this browser, so save it first if you want to keep it).'),
      h('div', { class: 'demo-list' }, ...DEMOS.map((d) => h('button', { class: 'demo', 'data-testid': `demo-${d.id}`, onclick: () => { app.loadDemo(d.id); this.close(); } }, h('b', {}, d.title), h('span', {}, d.blurb)))),
      h('h2', {}, 'Project'),
      h('p', { class: 'small-print' }, app.project.notes ? '' : 'No notes yet.'),
      notes,
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'small', onclick: () => app.newProject() }, 'NEW'),
        h('button', { class: 'small', 'data-testid': 'save-browser', onclick: () => { app.saveToBrowser(); this.render(); } }, 'SAVE IN BROWSER'),
        h('button', { class: 'small', 'data-testid': 'export', onclick: () => download(`${slug(app.project.name)}.feelers.json`, app.exportJson(), 'application/json') }, 'EXPORT JSON'),
        h('button', { class: 'small', 'data-testid': 'import', onclick: () => file.click() }, 'IMPORT JSON'),
        file,
      ),
      lib.length
        ? h(
            'div',
            { class: 'lib' },
            ...lib.map((e) =>
              h(
                'div',
                { class: 'lib-row' },
                h('button', { class: 'link', onclick: () => { const p = loadFromLibrary(e.name); if (p) { app.loadProject(p); this.close(); } } }, e.name),
                h('span', { class: 'small-print' }, new Date(e.savedAt).toLocaleString()),
                h('button', { class: 'tiny', 'aria-label': `Delete ${e.name}`, onclick: () => { deleteFromLibrary(e.name); this.render(); } }, '✕'),
              ),
            ),
          )
        : h('p', { class: 'small-print' }, 'Nothing saved in this browser yet.'),
      h('h2', {}, 'Options'),
      opt('programOnStart', 'Send program changes on Start', 'Each line with a program number sends it just before the first note.'),
      opt('shiftEdit', 'Shift editing of time values', 'When you change a time value, the next time value in the series changes the opposite way, so the series keeps its total length.'),
      h('label', { class: 'opt', help: 'Seed for the random generator. Start always reseeds, so a performance replays identically.' }, 'Random seed ', seedIn),
      h('h2', {}, 'Takes'),
      h('p', { class: 'small-print' }, 'Each performance from Start to Stop is kept (last nine), ready to download as a Standard MIDI File with one track per line.'),
      app.recorder.takes.length
        ? h(
            'div',
            { class: 'lib' },
            ...app.recorder.takes.map((t, i) =>
              h(
                'div',
                { class: 'lib-row' },
                h('span', {}, `${i + 1}. ${t.name}`),
                h('span', { class: 'small-print' }, `${t.notes.length} notes`),
                h('button', { class: 'small', 'data-testid': `take-${i}`, onclick: () => download(`${slug(t.name)}.mid`, takeToMidi(t) as BlobPart, 'audio/midi') }, '.MID'),
              ),
            ),
          )
        : h('p', { class: 'small-print' }, 'No takes yet: press Start, play, then Stop.'),
    );
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'feelers';
}
