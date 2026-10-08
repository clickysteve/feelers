import { describe, expect, it } from 'vitest';
import { BUILT_INS, DEFAULT_PALETTE_ID, PaletteError, PaletteLibrary, ROLES, contrastWarnings, exportPalette, importPalette, normHex, paletteCss, type PaletteStore } from '../../src/ui/palette';

class MemStore implements PaletteStore {
  m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

describe('palettes', () => {
  it('every built-in palette defines every role as a hex colour', () => {
    for (const p of BUILT_INS) for (const r of ROLES) expect(normHex(p.colors[r])).toBe(p.colors[r]);
    expect(BUILT_INS.map((p) => p.id)).toEqual(['feelers', 'classic', 'dark', 'colour']);
    expect(DEFAULT_PALETTE_ID).toBe('feelers');
  });

  it('CSS sets every semantic token, and the colour scheme follows the paper', () => {
    const css = paletteCss(BUILT_INS[0]!.colors);
    for (const t of ['--desktop', '--paper', '--ink', '--dim', '--l1', '--l2', '--l3', '--l4', '--activity', '--selection', '--xform', '--warn']) expect(css).toContain(`${t}:`);
    expect(css).toContain('color-scheme:light');
    expect(paletteCss(BUILT_INS.find((p) => p.id === 'dark')!.colors)).toContain('color-scheme:dark');
  });

  it('the built-ins keep their colours readable on their paper', () => {
    for (const p of BUILT_INS) expect(contrastWarnings(p.colors).map((w) => w.role)).toEqual([]);
  });

  it('is a preference stored apart from any project, under feelers.palette.*', () => {
    const store = new MemStore();
    const lib = new PaletteLibrary(store);
    expect(lib.selected.id).toBe('feelers');
    lib.select('dark');
    expect(store.getItem('feelers.palette.selected')).toBe('dark');
    expect(new PaletteLibrary(store).selected.id).toBe('dark');
  });

  it('editing a built-in makes a copy; built-ins never change', () => {
    const lib = new PaletteLibrary(new MemStore());
    lib.select('classic');
    const p = lib.setColor('transform', '#123');
    expect(p.builtIn).toBe(false);
    expect(p.name).toBe('Classic copy');
    expect(p.colors.transform).toBe('#112233');
    expect(BUILT_INS.find((x) => x.id === 'classic')!.colors.transform).toBe('#000000');
    expect(lib.remove(p.id)).toBe(true);
    expect(lib.selected.id).toBe('feelers');
    expect(lib.remove('dark')).toBe(false);
  });

  it('exports and imports its own files; imports emmm palettes by shared role names', () => {
    const lib = new PaletteLibrary(new MemStore());
    const dark = BUILT_INS.find((x) => x.id === 'dark')!;
    const back = importPalette(exportPalette(dark));
    expect(back.colors).toEqual(dark.colors);
    expect(back.filled).toEqual([]);
    const emmm = importPalette(
      JSON.stringify({ format: 'emmm-palette', version: 1, name: 'From emmm', colors: { desktop: '#23303a', paper: '#fbf8ef', ink: '#202020', dim: '#8c8576', patterns: '#1d6a86', variables: '#8a2f5e', cyclic: '#2c7149', conducting: '#a94f12', midi: '#4e44a0', snapshots: '#7d6208', trajectory: '#8d2fa3', activity: '#d0372a', selection: '#2b78c9' } }),
    );
    expect(emmm.colors.paper).toBe('#fbf8ef');
    expect(emmm.colors.feeler2).toBe('#1d6a86');
    expect(emmm.filled).toEqual([]);
    const added = lib.addImported(emmm);
    expect(lib.selected.id).toBe(added.id);
  });

  it('refuses damaged or foreign palette files with a readable message', () => {
    expect(() => importPalette('nope')).toThrow(PaletteError);
    expect(() => importPalette(JSON.stringify({ format: 'other', version: 1, colors: {} }))).toThrow(/not a Feelers or emmm palette/);
    expect(() => importPalette(JSON.stringify({ format: 'feelers-palette', version: 9, colors: { ink: '#000' } }))).toThrow(/newer/);
    const partial = importPalette(JSON.stringify({ format: 'feelers-palette', version: 1, colors: { ink: 'fff', bogus: '#000' } }));
    expect(partial.colors.ink).toBe('#ffffff');
    expect(partial.filled).toContain('paper');
    expect(partial.ignored).toEqual(['bogus']);
  });

  it('survives damaged storage', () => {
    const store = new MemStore();
    store.setItem('feelers.palette.custom', '{not json');
    store.setItem('feelers.palette.selected', 'gone');
    const lib = new PaletteLibrary(store);
    expect(lib.selected.id).toBe('feelers');
    expect(lib.custom).toEqual([]);
  });
});
