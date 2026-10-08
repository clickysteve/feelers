/**
 * Colour palettes: a purely cosmetic layer, shared in design with emmm.
 *
 * The interface draws with a small set of semantic CSS custom properties.
 * A palette assigns a colour to each role; `paletteCss` turns that into one
 * style sheet. Everything else (rules, wells, inverted text on coloured
 * fills) is derived from the roles in style.css, so any palette applies
 * coherently to the whole instrument.
 *
 * Collection conventions (see docs/DESIGN.md): the role names desktop,
 * paper, ink, dim, activity and selection mean the same as in emmm; palettes
 * are an application preference kept in localStorage (`feelers.palette.*`),
 * never part of a project; built-in palettes are never edited (editing makes
 * a copy); palette files are `{format, version, name, colors}` JSON, and an
 * emmm palette file can be imported directly.
 */

export const ROLES = ['desktop', 'paper', 'ink', 'dim', 'feeler1', 'feeler2', 'feeler3', 'feeler4', 'activity', 'selection', 'transform', 'warning'] as const;
export type Role = (typeof ROLES)[number];
export type Colors = Record<Role, string>;

export const ROLE_INFO: Record<Role, { label: string; help: string; css: string }> = {
  desktop: { label: 'Desktop', help: 'background behind the panels', css: '--desktop' },
  paper: { label: 'Paper', help: 'panel and cell background', css: '--paper' },
  ink: { label: 'Ink', help: 'frames, text, control elements', css: '--ink' },
  dim: { label: 'Dim', help: 'small labels, guides, disabled items', css: '--dim' },
  feeler1: { label: 'Feeler 1', help: 'line 1: its heads, panel and traces', css: '--l1' },
  feeler2: { label: 'Feeler 2', help: 'line 2', css: '--l2' },
  feeler3: { label: 'Feeler 3', help: 'line 3', css: '--l3' },
  feeler4: { label: 'Feeler 4', help: 'line 4', css: '--l4' },
  activity: { label: 'Activity', help: 'playing transport, clock running, MIDI activity', css: '--activity' },
  selection: { label: 'Selection', help: 'the selected element, focus, STORE', css: '--selection' },
  transform: { label: 'Transform', help: 'pitches moved by Scale Mode', css: '--xform' },
  warning: { label: 'Warning', help: 'PANIC, lost clock, errors', css: '--warn' },
};

export interface Palette {
  id: string;
  name: string;
  builtIn: boolean;
  colors: Colors;
}

/** Built-in palettes. "Feelers" is the instrument's own look and the default. */
export const BUILT_INS: Palette[] = [
  {
    id: 'feelers',
    name: 'Feelers',
    builtIn: true,
    colors: {
      desktop: '#ece8dc',
      paper: '#f8f5ec',
      ink: '#15140f',
      dim: '#6d695d',
      feeler1: '#d9480f',
      feeler2: '#1c6dd0',
      feeler3: '#2b8a3e',
      feeler4: '#9c36b5',
      activity: '#2b8a3e',
      selection: '#f2b705',
      transform: '#0b7285',
      warning: '#c92a2a',
    },
  },
  {
    id: 'classic',
    name: 'Classic',
    builtIn: true,
    colors: {
      desktop: '#000000',
      paper: '#ffffff',
      ink: '#000000',
      dim: '#000000',
      feeler1: '#000000',
      feeler2: '#000000',
      feeler3: '#000000',
      feeler4: '#000000',
      activity: '#000000',
      selection: '#000000',
      transform: '#000000',
      warning: '#000000',
    },
  },
  {
    id: 'dark',
    name: 'Dark',
    builtIn: true,
    colors: {
      desktop: '#000000',
      paper: '#17191c',
      ink: '#d9d4c7',
      dim: '#8a857a',
      feeler1: '#f08c4a',
      feeler2: '#7fa7d1',
      feeler3: '#8cc084',
      feeler4: '#c99ad6',
      activity: '#e3b65c',
      selection: '#7fa7d1',
      transform: '#5fc4b8',
      warning: '#e5786d',
    },
  },
  {
    id: 'colour',
    name: 'Colour',
    builtIn: true,
    colors: {
      desktop: '#23303a',
      paper: '#fbf8ef',
      ink: '#202020',
      dim: '#8c8576',
      feeler1: '#a94f12',
      feeler2: '#1d6a86',
      feeler3: '#2c7149',
      feeler4: '#8a2f5e',
      activity: '#d0372a',
      selection: '#2b78c9',
      transform: '#4e44a0',
      warning: '#d0372a',
    },
  },
];
export const DEFAULT_PALETTE_ID = 'feelers';
export const DEFAULT_PALETTE = BUILT_INS[0]!;

// ---------------------------------------------------------------------------- colour maths

/** Lenient hex parsing (#rgb, #rrggbb, with or without #) to '#rrggbb', or null. */
export function normHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return `#${s.toLowerCase()}`;
}

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1 to 21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Roles drawn on the paper, and the contrast they need to stay readable. */
const NEEDS: Partial<Record<Role, number>> = {
  ink: 3,
  dim: 1.6,
  feeler1: 2.5,
  feeler2: 2.5,
  feeler3: 2.5,
  feeler4: 2.5,
  activity: 2,
  selection: 1.4,
  transform: 2.5,
  warning: 2.5,
};

export interface ContrastWarning {
  role: Role;
  ratio: number;
}

/** Roles that are hard to see against the paper. Never changes any colour. */
export function contrastWarnings(c: Colors): ContrastWarning[] {
  const out: ContrastWarning[] = [];
  for (const role of ROLES) {
    const need = NEEDS[role];
    if (need === undefined) continue;
    const ratio = contrast(c[role], c.paper);
    if (ratio < need) out.push({ role, ratio });
  }
  if (contrast(c.ink, c.paper) < 3) out.push({ role: 'paper', ratio: contrast(c.ink, c.paper) });
  return out;
}

// ---------------------------------------------------------------------------- CSS

/** One style sheet that sets every role for the whole document. */
export function paletteCss(c: Colors): string {
  const decl = ROLES.map((r) => `${ROLE_INFO[r].css}:${c[r]}`).join(';');
  const scheme = luminance(c.paper) < 0.3 ? 'dark' : 'light';
  return `:root{${decl};color-scheme:${scheme}}`;
}

/** Apply a palette to the document (one <style id="feelers-palette"> element). */
export function applyPalette(p: Palette, doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (!doc) return;
  let el = doc.getElementById('feelers-palette') as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement('style');
    el.id = 'feelers-palette';
    doc.head.appendChild(el);
  }
  el.textContent = paletteCss(p.colors);
  doc.documentElement.dataset.palette = p.builtIn ? p.id : 'custom';
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.colors.desktop);
}

// ---------------------------------------------------------------------------- file format

export const PALETTE_FORMAT = 'feelers-palette';
export const PALETTE_VERSION = 1;

export function exportPalette(p: { name: string; colors: Colors }): string {
  return JSON.stringify({ format: PALETTE_FORMAT, version: PALETTE_VERSION, name: p.name, colors: { ...p.colors } }, null, 2);
}

export class PaletteError extends Error {}

export interface ImportResult {
  name: string;
  colors: Colors;
  /** Roles that were missing or unreadable and were taken from the Feelers palette. */
  filled: Role[];
  /** Unknown keys that were ignored. */
  ignored: string[];
}

/** emmm roles that carry over to Feelers roles (the shared ones keep their names). */
const FROM_EMMM: Partial<Record<Role, string>> = {
  desktop: 'desktop',
  paper: 'paper',
  ink: 'ink',
  dim: 'dim',
  activity: 'activity',
  selection: 'selection',
  feeler1: 'conducting',
  feeler2: 'patterns',
  feeler3: 'cyclic',
  feeler4: 'variables',
  transform: 'snapshots',
  warning: 'activity',
};

/** Parse and validate a palette file (Feelers, or emmm). Throws PaletteError with a readable message. */
export function importPalette(text: string): ImportResult {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new PaletteError('The file is not valid JSON.');
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new PaletteError('The file is not a palette.');
  const o = obj as Record<string, unknown>;
  const emmm = o.format === 'emmm-palette';
  if (o.format !== undefined && o.format !== PALETTE_FORMAT && !emmm) throw new PaletteError('The file is not a Feelers or emmm palette.');
  const version = Number(o.version);
  if (!Number.isInteger(version) || version < 1) throw new PaletteError('The palette file has no valid version number.');
  if (version > PALETTE_VERSION) throw new PaletteError(`This palette was made by a newer version (format v${version}).`);
  if (!o.colors || typeof o.colors !== 'object' || Array.isArray(o.colors)) throw new PaletteError('The palette file has no colours.');
  const src = o.colors as Record<string, unknown>;
  const colors = {} as Colors;
  const filled: Role[] = [];
  let valid = 0;
  for (const r of ROLES) {
    const key = emmm ? FROM_EMMM[r] : r;
    const h = key ? normHex(src[key]) : null;
    if (h) {
      colors[r] = h;
      valid++;
    } else {
      colors[r] = DEFAULT_PALETTE.colors[r];
      filled.push(r);
    }
  }
  if (!valid) throw new PaletteError('None of the palette colours could be read.');
  const known = emmm ? Object.values(FROM_EMMM) : (ROLES as readonly string[]);
  const ignored = Object.keys(src).filter((k) => !known.includes(k));
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : 'Imported palette';
  return { name, colors, filled, ignored };
}

// ---------------------------------------------------------------------------- persistence

const KEY_SELECTED = 'feelers.palette.selected';
const KEY_CUSTOM = 'feelers.palette.custom';

export interface PaletteStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function defaultStore(): PaletteStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Palette preferences: the custom palettes and which palette is selected. */
export class PaletteLibrary {
  custom: Palette[] = [];
  selectedId = DEFAULT_PALETTE_ID;

  constructor(private store: PaletteStore | null = defaultStore()) {
    this.load();
  }

  load(): void {
    try {
      const raw = this.store?.getItem(KEY_CUSTOM);
      const list = raw ? (JSON.parse(raw) as unknown[]) : [];
      this.custom = [];
      for (const item of Array.isArray(list) ? list : []) {
        try {
          const r = importPalette(JSON.stringify({ format: PALETTE_FORMAT, version: 1, ...(item as object) }));
          const id = typeof (item as Palette).id === 'string' ? (item as Palette).id : this.newId();
          this.custom.push({ id, name: r.name, builtIn: false, colors: r.colors });
        } catch {
          /* skip a damaged entry */
        }
      }
      const sel = this.store?.getItem(KEY_SELECTED);
      this.selectedId = sel && this.find(sel) ? sel : DEFAULT_PALETTE_ID;
    } catch {
      this.custom = [];
      this.selectedId = DEFAULT_PALETTE_ID;
    }
  }

  private save(): void {
    try {
      this.store?.setItem(KEY_CUSTOM, JSON.stringify(this.custom.map((p) => ({ id: p.id, name: p.name, colors: p.colors }))));
      this.store?.setItem(KEY_SELECTED, this.selectedId);
    } catch {
      /* storage full or blocked: palettes still work for this session */
    }
  }

  private newId(): string {
    let i = this.custom.length + 1;
    while (this.find(`custom-${i}`)) i++;
    return `custom-${i}`;
  }

  all(): Palette[] {
    return [...BUILT_INS, ...this.custom];
  }

  find(id: string): Palette | undefined {
    return this.all().find((p) => p.id === id);
  }

  get selected(): Palette {
    return this.find(this.selectedId) ?? DEFAULT_PALETTE;
  }

  select(id: string): Palette {
    if (this.find(id)) this.selectedId = id;
    this.save();
    return this.selected;
  }

  private uniqueName(base: string): string {
    const names = new Set(this.all().map((p) => p.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  /** A custom copy of any palette, selected. */
  duplicate(id: string, name?: string): Palette {
    const src = this.find(id) ?? DEFAULT_PALETTE;
    const p: Palette = { id: this.newId(), name: this.uniqueName(name ?? `${src.name} copy`), builtIn: false, colors: { ...src.colors } };
    this.custom.push(p);
    this.selectedId = p.id;
    this.save();
    return p;
  }

  /** Change one colour. Built-ins are never modified: editing one makes a custom copy first. */
  setColor(role: Role, value: string): Palette {
    const hex = normHex(value);
    let p = this.selected;
    if (!hex) return p;
    if (p.builtIn) p = this.duplicate(p.id);
    p.colors[role] = hex;
    this.save();
    return p;
  }

  rename(id: string, name: string): boolean {
    const p = this.custom.find((x) => x.id === id);
    const n = name.trim().slice(0, 40);
    if (!p || !n) return false;
    p.name = n;
    this.save();
    return true;
  }

  remove(id: string): boolean {
    const i = this.custom.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.custom.splice(i, 1);
    if (this.selectedId === id) this.selectedId = DEFAULT_PALETTE_ID;
    this.save();
    return true;
  }

  addImported(r: ImportResult): Palette {
    const p: Palette = { id: this.newId(), name: this.uniqueName(r.name), builtIn: false, colors: { ...r.colors } };
    this.custom.push(p);
    this.selectedId = p.id;
    this.save();
    return p;
  }

  resetToDefault(): Palette {
    return this.select(DEFAULT_PALETTE_ID);
  }
}
