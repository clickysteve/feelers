/** Minimal DOM construction helpers. */

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; help?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'help') el.dataset.help = String(v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else (el.style as unknown as Record<string, string>)[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function replace(el: Element, ...children: (Child | Child[])[]): void {
  clear(el);
  append(el, children);
}

/** A labelled numeric field with -/+ steppers and wheel / arrow-key support. */
export function stepper(opts: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  big?: number;
  format?: (v: number) => string;
  parse?: (s: string) => number | null;
  help?: string;
  testid?: string;
  onChange: (v: number) => void;
}): Stepper {
  const step = opts.step ?? 1;
  const fmt = opts.format ?? ((v: number) => String(v));
  let value = opts.value;
  const input = h('input', {
    class: 'num',
    value: fmt(value),
    spellcheck: false,
    'aria-label': opts.label,
    'data-testid': opts.testid,
  });
  const set = (v: number) => {
    const n = Math.min(opts.max, Math.max(opts.min, Math.round(v / step) * step));
    const fixed = Number(n.toFixed(4));
    if (fixed !== value) {
      value = fixed;
      opts.onChange(value);
    }
    input.value = fmt(value);
  };
  input.addEventListener('change', () => {
    const parsed = opts.parse ? opts.parse(input.value) : Number(input.value);
    if (parsed === null || !Number.isFinite(parsed)) input.value = fmt(value);
    else set(parsed);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const d = (e.shiftKey ? (opts.big ?? step * 10) : step) * (e.key === 'ArrowUp' ? 1 : -1);
      set(value + d);
    } else if (e.key === 'Enter') {
      input.blur();
    }
    e.stopPropagation();
  });
  input.addEventListener(
    'wheel',
    (e) => {
      if (document.activeElement !== input) return;
      e.preventDefault();
      set(value + (e.deltaY < 0 ? step : -step));
    },
    { passive: false },
  );
  const el = h(
    'span',
    { class: 'stepper', help: opts.help },
    h('span', { class: 'lbl' }, opts.label),
    h('button', { class: 'tiny', 'aria-label': `${opts.label} down`, onclick: () => set(value - step) }, '−'),
    input,
    h('button', { class: 'tiny', 'aria-label': `${opts.label} up`, onclick: () => set(value + step) }, '+'),
  ) as Stepper;
  /** Update the shown value from outside without firing onChange. */
  el.setValue = (v: number) => {
    value = v;
    if (document.activeElement !== input) input.value = fmt(v);
  };
  return el;
}

export type Stepper = HTMLElement & { setValue(v: number): void };

export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
