/**
 * Browser-local persistence. Every access is guarded: storage can be
 * unavailable (private windows, blocked site data) and Feelers must still run.
 */
import type { Project } from '../engine/types';
import { deserialize, serialize } from './project';

const CURRENT = 'feelers.current.v1';
const LIBRARY = 'feelers.library.v1';

export interface LibraryEntry {
  name: string;
  savedAt: string;
  data: string;
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveCurrent(p: Project): boolean {
  try {
    store()?.setItem(CURRENT, serialize(p));
    return true;
  } catch {
    return false;
  }
}

export function loadCurrent(): Project | null {
  try {
    const t = store()?.getItem(CURRENT);
    return t ? deserialize(t) : null;
  } catch {
    return null;
  }
}

export function listLibrary(): LibraryEntry[] {
  try {
    const t = store()?.getItem(LIBRARY);
    const v: unknown = t ? JSON.parse(t) : [];
    return Array.isArray(v) ? (v.filter((e) => e && typeof e.name === 'string' && typeof e.data === 'string') as LibraryEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveToLibrary(p: Project): boolean {
  try {
    const list = listLibrary().filter((e) => e.name !== p.name);
    list.unshift({ name: p.name, savedAt: new Date().toISOString(), data: serialize(p) });
    store()?.setItem(LIBRARY, JSON.stringify(list.slice(0, 50)));
    return true;
  } catch {
    return false;
  }
}

export function deleteFromLibrary(name: string): void {
  try {
    store()?.setItem(LIBRARY, JSON.stringify(listLibrary().filter((e) => e.name !== name)));
  } catch {
    /* ignore */
  }
}

export function loadFromLibrary(name: string): Project | null {
  const e = listLibrary().find((x) => x.name === name);
  if (!e) return null;
  try {
    return deserialize(e.data);
  } catch {
    return null;
  }
}
