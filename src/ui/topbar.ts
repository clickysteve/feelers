/**
 * Top bar: transport, tempo, MIDI, preview, performance memories and the
 * project menu.
 */
import type { App } from '../app';
import { DEMOS } from '../demos/demos';
import { QUANT_DIRS, ROOT_NAMES, SCALES } from '../engine/scale';
import type { QuantDir } from '../engine/types';
import { PPQ } from '../engine/types';
import { deleteFromLibrary, listLibrary, loadFromLibrary } from '../persistence/storage';
import { takeToMidi } from '../persistence/takes';
import { download, h, replace, stepper, type Stepper } from './dom';
import { PaletteError, ROLES, ROLE_INFO, applyPalette, contrastWarnings, exportPalette, importPalette, type PaletteLibrary } from './palette';

const SYNC_LABEL = { internal: '', 'no-input': 'NO INPUT', waiting: 'WAITING', clock: 'CLOCK', running: 'RUNNING', stopped: 'STOPPED', lost: 'LOST' } as const;

const SYNC_HELP = {
  internal: '',
  'no-input': 'Choose the MIDI input that sends clock.',
  waiting: 'No clock arriving. Start the clock source, or check the cable and input.',
  clock: 'Clock arriving; waiting for Start (FA) or Continue (FB) from the device. Clock alone never starts Feelers.',
  running: 'Following the incoming clock.',
  stopped: 'Stopped by the device (FC). Continue (FB) resumes from here; Start (FA) begins afresh.',
  lost: 'Clock stopped arriving while running. Notes released, position held: the next clock pulse carries on.',
} as const;

const TRANSPORT_BYTE = { Start: 'FA', Continue: 'FB', Stop: 'FC' } as const;

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
  private syncInt!: HTMLButtonElement;
  private syncExt!: HTMLButtonElement;
  private inSel!: HTMLSelectElement;
  private syncChip!: HTMLElement;
  private inBpm!: HTMLElement;
  private pulseEl!: HTMLElement;
  private restoreBtn!: HTMLButtonElement;
  private scaleGrp!: HTMLElement;
  private scaleOn!: HTMLButtonElement;
  private scaleRoot!: HTMLSelectElement;
  private scaleSel!: HTMLSelectElement;
  private scaleDirs!: Record<QuantDir, HTMLButtonElement>;

  constructor(private app: App, private menu: MenuPanel) {
    this.el = h('header', { class: 'topbar' });
    this.build();
    app.on('transport', () => this.update());
    app.on('midi', () => this.updateMidi());
    app.on('snapshots', () => {
      this.updateMem();
      this.updateRestore();
    });
    app.on('scale', () => this.updateScale());
    app.on('project', () => {
      this.update();
      this.updateMem();
      this.updateScale();
      this.updateRestore();
    });
  }

  private build(): void {
    const app = this.app;
    this.startBtn = h('button', { class: 'tbtn start', help: 'Start: begin the performance from its defined starting state (heads at their start cells, random seed reset). Space.', 'data-testid': 'start', onclick: () => app.start() }, '▶ START');
    this.pauseBtn = h('button', { class: 'tbtn', help: 'Pause keeps every head, loop count and line timing; Continue carries on from exactly there. Space.', 'data-testid': 'pause', onclick: () => (app.transport === 'paused' ? app.resume() : app.pause()) }, '❚❚ PAUSE');
    this.stopBtn = h('button', { class: 'tbtn', help: 'Stop/Reset: silence everything now and return to the beginning. Esc.', 'data-testid': 'stop', onclick: () => app.stop() }, '■ STOP');
    this.restoreBtn = h(
      'button',
      {
        class: 'tbtn restore',
        help: 'Restore Last Start: put every series value and line setting back to how it was when Start was last pressed (undoing edits and the changes made by ? and ¿). Press again to undo.',
        'data-testid': 'restore',
        onclick: () => app.restoreLastStart(),
      },
      '⟲ RESTORE',
    );
    this.scaleOn = h('button', { class: 'small', help: 'Scale Mode: constrain every line that follows the global scale to this scale and root. The stored pitches never change; moved notes are marked.', 'data-testid': 'scale-on', onclick: () => app.setGlobalScale({ on: !app.project.scale.on }) }, 'SCALE');
    this.scaleRoot = h('select', { 'aria-label': 'Scale root', help: 'Root of the global scale.', 'data-testid': 'scale-root' }, ...ROOT_NAMES.map((n, r) => h('option', { value: String(r) }, n)));
    this.scaleRoot.addEventListener('change', () => app.setGlobalScale({ root: Number(this.scaleRoot.value) }));
    this.scaleSel = h('select', { 'aria-label': 'Scale', help: 'The global scale.', 'data-testid': 'scale-scale' }, ...SCALES.map((x) => h('option', { value: x.id }, x.name)));
    this.scaleSel.addEventListener('change', () => app.setGlobalScale({ scale: this.scaleSel.value }));
    const dirInfo: Record<QuantDir, [string, string]> = {
      nearest: ['≈', 'Nearest: out-of-scale pitches move to the closest scale note; a tie goes up (C#4 in C major plays D4).'],
      down: ['↓', 'Down: out-of-scale pitches move to the scale note below.'],
      up: ['↑', 'Up: out-of-scale pitches move to the scale note above.'],
    };
    this.scaleDirs = {} as Record<QuantDir, HTMLButtonElement>;
    for (const d of QUANT_DIRS) this.scaleDirs[d] = h('button', { class: 'seg', help: dirInfo[d][1], 'aria-label': `Quantise ${d}`, 'data-testid': `scale-dir-${d}`, onclick: () => app.setGlobalScale({ dir: d }) }, dirInfo[d][0]);
    this.scaleGrp = h(
      'div',
      { class: 'tgroup scale' },
      this.scaleOn,
      this.scaleRoot,
      this.scaleSel,
      h('span', { class: 'seggrp', role: 'group', 'aria-label': 'Quantise direction' }, ...QUANT_DIRS.map((d) => this.scaleDirs[d])),
    );
    this.tempo = stepper({ label: 'BPM', value: app.project.tempo, min: 10, max: 400, big: 10, help: 'Tempo in beats per minute. Changes apply within one scheduling window (about 0.1 s).', testid: 'tempo', onChange: (v) => app.setTempo(v) });
    this.tempo.classList.add('tempo-step');
    this.inBpm = h('span', { class: 'readout in-bpm', help: 'Tempo measured from the incoming MIDI Clock. Display only: the clock pulses themselves drive Feelers.', 'data-testid': 'sync-bpm' }, '---');
    this.pos = h('span', { class: 'readout tpos', help: 'Transport position (bar.beat, counting 4/4). Under external clock it advances one tick per incoming pulse.', 'data-testid': 'position' }, '1.1');
    const seg = (label: string, src: 'internal' | 'external', help: string) =>
      h('button', { class: 'seg', help, 'data-testid': `clock-${src === 'internal' ? 'int' : 'ext'}`, onclick: () => app.setClockSource(src) }, label);
    this.syncInt = seg('INT', 'internal', 'Internal clock: Feelers sets the tempo and runs its own transport (START / PAUSE / STOP).');
    this.syncExt = seg('EXT', 'external', 'External MIDI Clock: follow 24 PPQN clock from a MIDI input. The device sends Start, Stop and Continue; its clock pulses drive every note.');
    this.inSel = h('select', { 'aria-label': 'Clock input', help: 'MIDI input that supplies clock (for example a Squarp Hermod+ over USB).', 'data-testid': 'midi-in' });
    this.inSel.addEventListener('change', () => app.selectInput(this.inSel.value || null));
    this.syncChip = h('span', { class: 'sync-chip', 'data-testid': 'sync-status', role: 'status' }, '');
    this.pulseEl = h('span', { class: 'pulses', 'data-testid': 'sync-pulses', help: 'Clock pulses received from the input, and the last transport message (FA Start, FB Continue, FC Stop).' }, '');
    this.midiSel = h('select', { 'aria-label': 'MIDI output', help: 'MIDI output device. The four lines send on their own channels.', 'data-testid': 'midi-out' });
    this.midiSel.addEventListener('change', () => app.selectPort(this.midiSel.value || null));
    this.midiNote = h('span', { class: 'midi-note', 'data-testid': 'midi-status' });
    this.clockBtn = h('button', { class: 'small', help: 'Send MIDI Clock (24 per quarter) with Start / Stop / Continue so external sequencers and modules follow Feelers.', 'data-testid': 'clock', onclick: () => app.setOption('clockOut', !app.project.options.clockOut) }, 'CLOCK');
    this.previewBtn = h('button', { class: 'small', help: 'Built-in audio preview: a simple synth that plays whatever is sent to MIDI. It is only a listener; MIDI output is unaffected.', 'data-testid': 'preview', onclick: () => void app.togglePreview() }, '♪ PREVIEW');
    this.mem = h('span', { class: 'mem', role: 'group', 'aria-label': 'Performance memories' });
    this.title = h('input', { class: 'title', value: app.project.name, 'aria-label': 'Project name', help: 'Project name.' });
    this.title.addEventListener('change', () => app.rename(this.title.value));
    this.title.addEventListener('keydown', (e) => e.stopPropagation());

    replace(
      this.el,
      h('div', { class: 'brand', help: 'Feelers: four musical lines, each assembled from independently moving parameter series.' }, h('span', { class: 'logo' }, 'FEELERS'), h('span', { class: 'tag' }, 'put out the feelers')),
      h('div', { class: 'tgroup' }, this.startBtn, this.pauseBtn, this.stopBtn, this.restoreBtn, this.tempo, this.inBpm, this.pos),
      h(
        'div',
        { class: 'tgroup sync' },
        h('span', { class: 'lbl', help: 'Clock source.' }, 'SYNC'),
        h('span', { class: 'seggrp', role: 'group', 'aria-label': 'Clock source' }, this.syncInt, this.syncExt),
        this.inSel,
        this.syncChip,
        this.pulseEl,
      ),
      h('div', { class: 'tgroup' }, h('span', { class: 'lbl' }, 'MIDI'), this.midiSel, this.clockBtn, h('button', { class: 'small warn', help: 'Panic: release every note and send All Notes Off / All Sound Off on all 16 channels.', 'data-testid': 'panic', onclick: () => app.panic() }, 'PANIC'), this.previewBtn),
      this.scaleGrp,
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
    this.updateScale();
    this.updateRestore();
  }

  updateScale(): void {
    const sc = this.app.project.scale;
    this.scaleOn.classList.toggle('on', sc.on);
    this.scaleOn.setAttribute('aria-pressed', String(sc.on));
    this.scaleGrp.classList.toggle('off', !sc.on);
    this.scaleRoot.value = String(sc.root);
    this.scaleSel.value = sc.scale;
    for (const d of QUANT_DIRS) {
      this.scaleDirs[d].classList.toggle('on', sc.dir === d);
      this.scaleDirs[d].setAttribute('aria-pressed', String(sc.dir === d));
    }
  }

  updateRestore(): void {
    const e = this.app.engine;
    this.restoreBtn.disabled = !e.canRestore;
    this.restoreBtn.classList.toggle('on', e.restored);
    this.restoreBtn.setAttribute('aria-pressed', String(e.restored));
  }

  update(): void {
    const st = this.app.transport;
    const ext = this.app.external;
    this.el.classList.toggle('ext', ext);
    this.startBtn.classList.toggle('on', st === 'playing');
    this.startBtn.disabled = ext;
    this.pauseBtn.textContent = st === 'paused' ? '▶ CONTINUE' : '❚❚ PAUSE';
    this.pauseBtn.classList.toggle('on', st === 'paused');
    this.pauseBtn.disabled = ext || st === 'stopped';
    this.tempo.setValue(this.app.sched.bpm);
    this.syncInt.classList.toggle('on', !ext);
    this.syncExt.classList.toggle('on', ext);
    this.syncInt.setAttribute('aria-pressed', String(!ext));
    this.syncExt.setAttribute('aria-pressed', String(ext));
    const clockOn = this.app.project.options.clockOut && !ext;
    this.clockBtn.disabled = ext;
    this.clockBtn.classList.toggle('on', clockOn);
    this.clockBtn.setAttribute('aria-pressed', String(clockOn));
    this.clockBtn.dataset.help = ext
      ? 'Clock out is off while following an external clock, so clock is never echoed back to its source. It returns when you switch to INT.'
      : 'Send MIDI Clock (24 per quarter) with Start / Stop / Continue so external sequencers and modules follow Feelers.';
    this.startBtn.dataset.help = ext
      ? 'Following external clock: the device sends Start (FA). STOP here still stops and resets.'
      : 'Start: begin the performance from its defined starting state (heads at their start cells, random seed reset). Space.';
    this.tick();
    if (document.activeElement !== this.title) this.title.value = this.app.project.name;
    document.body.dataset.transport = st;
  }

  /** Called per animation frame. */
  tick(): void {
    const t = this.app.sched.positionTick();
    const beat = Math.floor(t / PPQ);
    this.pos.textContent = `${Math.floor(beat / 4) + 1}.${(beat % 4) + 1}`;
    if (!this.app.external) return;
    const sched = this.app.sched;
    const bpm = sched.pulses.bpm();
    const recent = performance.now() - sched.ext.lastPulseMs < 500;
    this.inBpm.textContent = bpm !== null && recent ? bpm.toFixed(1) : '---';
    const status = sched.syncStatus();
    const label = SYNC_LABEL[status];
    if (this.syncChip.textContent !== label) {
      this.syncChip.textContent = label;
      this.syncChip.dataset.state = status;
      this.syncChip.dataset.help = SYNC_HELP[status];
    }
    const last = sched.ext.lastTransport;
    this.pulseEl.textContent = `F8×${sched.ext.pulseCount}${last ? ` · ${TRANSPORT_BYTE[last]}` : ''}`;
  }

  updateMidi(): void {
    const app = this.app;
    const ins = [h('option', { value: '' }, app.inputs.length ? 'Choose clock input…' : app.access.status.state === 'ready' ? 'No MIDI inputs' : 'MIDI unavailable')];
    for (const p of app.inputs) ins.push(h('option', { value: p.id, disabled: !p.connected }, `${p.name}${p.connected ? '' : ' (disconnected)'}`));
    replace(this.inSel, ...ins);
    this.inSel.value = app.selectedInput && app.inputs.some((p) => p.id === app.selectedInput) ? app.selectedInput : '';
    const opts = [h('option', { value: '' }, app.access.status.state === 'ready' ? 'No output (preview only)' : 'MIDI unavailable')];
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

  private palMsg = '';
  private delArmed = false;

  constructor(
    private app: App,
    private helpContent: () => HTMLElement,
    private palettes: PaletteLibrary,
  ) {
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
      app.scheduleSave();
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
                h('button', { class: 'linkbtn', onclick: () => { const p = loadFromLibrary(e.name); if (p) { app.loadProject(p); this.close(); } } }, e.name),
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
      h('h2', {}, 'Palette'),
      h('p', { class: 'small-print' }, 'Colours for the whole instrument. A palette is kept in this browser, not in the project. Built-in palettes are never changed: editing one makes a copy. Feelers palette files and emmm palette files can be imported.'),
      this.paletteEditor(),
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

  private paletteEditor(): HTMLElement {
    const lib = this.palettes;
    const p = lib.selected;
    const redraw = (msg = '') => {
      applyPalette(lib.selected);
      this.palMsg = msg;
      this.render();
    };
    const file = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, 'data-testid': 'palette-file' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const r = importPalette(await f.text());
        const np = lib.addImported(r);
        redraw(`Imported "${np.name}".${r.filled.length ? ` Missing or unreadable: ${r.filled.map((x) => ROLE_INFO[x].label).join(', ')} (Feelers colours used).` : ''}`);
      } catch (err) {
        redraw(`Could not import: ${err instanceof PaletteError ? err.message : String(err)}`);
      }
      file.value = '';
    });
    const name = h('input', { value: p.name, disabled: p.builtIn, 'aria-label': 'Palette name', help: p.builtIn ? 'Built-in palettes cannot be renamed: duplicate first.' : 'Palette name.' });
    name.addEventListener('change', () => {
      if (lib.rename(p.id, name.value)) redraw();
    });
    name.addEventListener('keydown', (e) => e.stopPropagation());
    const warnings = new Map(contrastWarnings(p.colors).map((w) => [w.role, w.ratio]));
    const roles = ROLES.map((r) => {
      const hex = h('input', { class: 'hex', value: p.colors[r], maxLength: 7, 'aria-label': `${ROLE_INFO[r].label} colour`, 'data-testid': `pal-hex-${r}` });
      const pick = h('input', { type: 'color', value: p.colors[r], 'aria-label': `${ROLE_INFO[r].label} colour picker` });
      const apply = (v: string) => {
        lib.setColor(r, v);
        applyPalette(lib.selected);
      };
      hex.addEventListener('input', () => {
        if (/^#?[0-9a-fA-F]{6}$/.test(hex.value.trim())) apply(hex.value);
      });
      hex.addEventListener('change', () => {
        if (!/^#?([0-9a-fA-F]{3}){1,2}$/.test(hex.value.trim())) redraw(`"${hex.value}" is not a colour. Use a hex value such as #1d6a86.`);
        else redraw();
      });
      hex.addEventListener('keydown', (e) => e.stopPropagation());
      pick.addEventListener('input', () => apply(pick.value));
      pick.addEventListener('change', () => redraw());
      const ratio = warnings.get(r);
      return h(
        'div',
        { class: 'pal-role', help: `${ROLE_INFO[r].label}: ${ROLE_INFO[r].help}.` },
        h('span', {}, ROLE_INFO[r].label),
        h('span', { class: 'swatch', style: { background: p.colors[r] } }, pick),
        hex,
        ratio !== undefined ? h('span', { class: 'warnmark', help: `Low contrast against Paper (${ratio.toFixed(1)}:1): may be hard to see.` }, '!') : h('span', {}),
      );
    });
    return h(
      'div',
      { class: 'pal', 'data-testid': 'palette' },
      h(
        'div',
        {},
        h(
          'div',
          { class: 'pal-list', role: 'listbox', 'aria-label': 'Palettes' },
          ...lib.all().map((x) =>
            h(
              'button',
              { class: x.id === p.id ? 'on' : '', role: 'option', 'aria-selected': String(x.id === p.id), 'data-testid': `palette-${x.id}`, onclick: () => { lib.select(x.id); this.delArmed = false; redraw(); } },
              x.name + (x.builtIn ? '' : ' *'),
            ),
          ),
        ),
        h('div', { class: 'row' }, name),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'small', help: 'Make an editable copy of this palette.', 'data-testid': 'palette-duplicate', onclick: () => { const np = lib.duplicate(p.id); redraw(`Made "${np.name}".`); } }, 'DUPLICATE'),
          h(
            'button',
            {
              class: 'small',
              disabled: p.builtIn,
              help: 'Delete this palette (click twice).',
              onclick: () => {
                if (!this.delArmed) {
                  this.delArmed = true;
                  this.render();
                  setTimeout(() => { if (this.delArmed) { this.delArmed = false; this.render(); } }, 3000);
                  return;
                }
                this.delArmed = false;
                lib.remove(p.id);
                redraw(`Deleted "${p.name}".`);
              },
            },
            this.delArmed ? 'SURE?' : 'DELETE',
          ),
          h('button', { class: 'small', help: 'Load a palette file (.feelers-palette.json or .emmm-palette.json).', onclick: () => file.click() }, 'IMPORT…'),
          h('button', { class: 'small', help: 'Save this palette as a file.', onclick: () => download(`${slug(p.name)}.feelers-palette.json`, exportPalette(p), 'application/json') }, 'EXPORT…'),
          h('button', { class: 'small', help: 'Use the Feelers palette.', onclick: () => { lib.resetToDefault(); redraw(); } }, 'DEFAULT'),
          file,
        ),
      ),
      h('div', { class: 'pal-roles' }, ...roles, h('div', { class: 'small-print pal-status', role: 'status', 'aria-live': 'polite' }, this.palMsg)),
    );
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'feelers';
}
