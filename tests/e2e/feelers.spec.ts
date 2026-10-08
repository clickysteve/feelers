import { expect, test, type Page } from '@playwright/test';
import { installFakeMidi } from './fake-midi';

type Msg = { bytes: number[]; t: number; at: number };

async function sent(page: Page): Promise<Msg[]> {
  return page.evaluate(() => (window as unknown as { __midi: { sent: Msg[] } }).__midi.sent.slice());
}

const isOn = (m: Msg) => (m.bytes[0]! & 0xf0) === 0x90 && m.bytes[2]! > 0;
const isOff = (m: Msg) => (m.bytes[0]! & 0xf0) === 0x80 || ((m.bytes[0]! & 0xf0) === 0x90 && m.bytes[2] === 0);
const chan = (m: Msg) => (m.bytes[0]! & 0x0f) + 1;

/** Every note-on followed by a note-off, nothing left hanging (in timestamp order). */
function paired(msgs: Msg[]): string[] {
  const held = new Map<string, number>();
  const sorted = msgs.map((m, i) => ({ m, i })).sort((a, b) => a.m.t - b.m.t || a.i - b.i).map((x) => x.m);
  for (const m of sorted) {
    const k = `${chan(m)}:${m.bytes[1]}`;
    if (isOn(m)) held.set(k, (held.get(k) ?? 0) + 1);
    else if (isOff(m)) held.set(k, 0);
  }
  return [...held].filter(([, v]) => v > 0).map(([k]) => k);
}

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(installFakeMidi);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.getByTestId('line-3')).toBeVisible();
  return errors;
}

async function pickDevice(page: Page) {
  await page.getByTestId('midi-out').selectOption('fake-out-1');
  await expect(page.getByTestId('midi-status')).toContainText('Feelers Test Device');
}

test('opens playable with a default setup and no errors', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator('.strip')).toHaveCount(16);
  await expect(page.locator('.line')).toHaveCount(4);
  await expect(page.getByTestId('start')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('start sends four independent lines to MIDI, stop leaves nothing hanging', async ({ page }) => {
  await boot(page);
  await pickDevice(page);
  await page.getByTestId('start').click();
  await page.waitForTimeout(3000);
  // heads are visibly moving: live tabs in the bank
  await expect(page.locator('.cell .tab.live').first()).toBeVisible();
  await page.getByTestId('stop').click();
  const msgs = await sent(page);
  const chans = new Set(msgs.filter(isOn).map(chan));
  expect([...chans].sort()).toEqual([1, 2, 3, 4]);
  expect(paired(msgs)).toEqual([]);
});

test('editing pitch material while playing changes what is heard', async ({ page }) => {
  await boot(page);
  await pickDevice(page);
  await page.getByTestId('start').click();
  await page.waitForTimeout(600);
  // P1 is line 1's pitch series; set every cell to a note not in the demo
  const cells = page.locator('[data-testid=strip-P1] .cell.val');
  const n = await cells.count();
  for (let i = 0; i < n; i++) {
    await cells.nth(i).click();
    const input = page.getByTestId('cell-value');
    await input.fill('C#2');
    await input.press('Enter');
  }
  await page.evaluate(() => (window as unknown as { __midi: { reset(): void } }).__midi.reset());
  await page.waitForTimeout(2500);
  const ch1 = (await sent(page)).filter((m) => isOn(m) && chan(m) === 1).map((m) => m.bytes[1]);
  expect(ch1.length).toBeGreaterThan(3);
  expect(new Set(ch1)).toEqual(new Set([37]));
  await page.getByTestId('stop').click();
});

test('reversing a head flips its direction and the melody order', async ({ page }) => {
  await boot(page);
  await page.getByTestId('dir-0-pitch').click();
  await expect(page.getByTestId('dir-0-pitch')).toHaveText('←');
  const dir = await page.evaluate(() => (window as unknown as { feelers: { engine: { lines: { heads: { pitch: { dir: number } } }[] } } }).feelers.engine.lines[0]!.heads.pitch.dir);
  expect(dir).toBe(-1);
  // while stopped this edits the starting direction, which is saved
  const startDir = await page.evaluate(() => (window as unknown as { feelers: { project: { lines: { heads: { pitch: { startDir: number } } }[] } } }).feelers.project.lines[0]!.heads.pitch.startDir);
  expect(startDir).toBe(-1);
});

test('mute silences a line while its heads keep moving', async ({ page }) => {
  await boot(page);
  await pickDevice(page);
  await page.getByTestId('start').click();
  await page.waitForTimeout(500);
  await page.getByTestId('mute-1').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as unknown as { __midi: { reset(): void } }).__midi.reset());
  const before = await page.evaluate(() => (window as unknown as { feelers: { engine: { lines: { count: number }[] } } }).feelers.engine.lines[1]!.count);
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => (window as unknown as { feelers: { engine: { lines: { count: number }[] } } }).feelers.engine.lines[1]!.count);
  const msgs = await sent(page);
  expect(msgs.filter((m) => isOn(m) && chan(m) === 2)).toEqual([]);
  expect(after).toBeGreaterThan(before);
  await page.getByTestId('stop').click();
});

test('pause and continue send MIDI Stop / Continue with clock out', async ({ page }) => {
  await boot(page);
  await pickDevice(page);
  await page.getByTestId('clock').click();
  await page.getByTestId('start').click();
  await page.waitForTimeout(700);
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('pause')).toHaveText(/CONTINUE/);
  await page.waitForTimeout(400);
  await page.getByTestId('pause').click();
  await page.waitForTimeout(500);
  await page.getByTestId('stop').click();
  const sys = (await sent(page)).filter((m) => m.bytes[0]! >= 0xf0 && m.bytes[0] !== 0xf8).map((m) => m.bytes[0]);
  expect(sys).toEqual([0xfa, 0xfc, 0xfb, 0xfc, 0xf2]);
  const clocks = (await sent(page)).filter((m) => m.bytes[0] === 0xf8);
  expect(clocks.length).toBeGreaterThan(20);
});

test('channel selection isolates lines', async ({ page }) => {
  await boot(page);
  await pickDevice(page);
  await page.getByTestId('channel-0').selectOption('10');
  await page.getByTestId('start').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('stop').click();
  const chans = new Set((await sent(page)).filter(isOn).map(chan));
  expect(chans.has(1)).toBe(false);
  expect(chans.has(10)).toBe(true);
});

test('device disconnection is reported and playback carries on safely', async ({ page }) => {
  const errors = await boot(page);
  await pickDevice(page);
  await page.getByTestId('start').click();
  await page.waitForTimeout(600);
  await page.evaluate(() => (window as unknown as { __midi: { unplug(): void } }).__midi.unplug());
  await expect(page.getByTestId('midi-status')).toContainText('disconnected');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { feelers: { transport: string } }).feelers.transport)).toBe('playing');
  await page.evaluate(() => (window as unknown as { __midi: { replug(): void } }).__midi.replug());
  await expect(page.getByTestId('midi-status')).toContainText('reconnected');
  await page.getByTestId('stop').click();
  expect(errors).toEqual([]);
});

test('panic sends All Notes Off on every channel', async ({ page }) => {
  await boot(page);
  await pickDevice(page);
  await page.getByTestId('start').click();
  await page.waitForTimeout(400);
  await page.getByTestId('panic').click();
  const cc = (await sent(page)).filter((m) => (m.bytes[0]! & 0xf0) === 0xb0 && m.bytes[1] === 123);
  expect(new Set(cc.map(chan)).size).toBe(16);
  await page.getByTestId('stop').click();
});

test('space starts and pauses; escape stops', async ({ page }) => {
  await boot(page);
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Space');
  await expect(page.locator('body')).toHaveAttribute('data-transport', 'playing');
  await page.keyboard.press('Space');
  await expect(page.locator('body')).toHaveAttribute('data-transport', 'paused');
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-transport', 'stopped');
});

test('control elements are marks on elements: placing and removing them keeps the value', async ({ page }) => {
  await boot(page);
  const strip = page.locator('[data-testid=strip-P1]');
  await strip.locator('.cell').nth(3).click();
  await page.getByTestId('mark-end').click();
  await expect(strip.locator('.cell.end')).toHaveCount(1);
  // First Contact P1 has 7 notes; END after the 4th splits it into series of 4 and 3.
  await expect(strip.locator('.cyc')).toHaveText('×4');
  await page.getByTestId('mark-end').click();
  await expect(strip.locator('.cell.end')).toHaveCount(0);
  await strip.locator('.cell').nth(1).click();
  await page.keyboard.press('s');
  await expect(strip.locator('.cell.skipped')).toHaveCount(1);
  await expect(strip.locator('.cell.skipped .txt')).toHaveText('F4');
  await page.keyboard.press('s');
  await expect(strip.locator('.cell.skipped')).toHaveCount(0);
  await page.keyboard.press('r');
  await expect(strip.locator('.cell').nth(1).locator('.am')).toHaveText('R');
  await page.keyboard.press('r');
  await expect(strip.locator('.cell').nth(1).locator('.am')).toHaveText('r');
  await page.getByTestId('slot-loop').click();
  await expect(strip.locator('.cell.loop')).toHaveText(/L∞/);
  await page.getByTestId('loop-count').fill('3');
  await page.getByTestId('loop-count').press('Enter');
  await expect(strip.locator('.cell.loop')).toHaveText(/L×3/);
  await page.getByTestId('link-P1').click();
  await expect(page.getByTestId('link-P1')).toHaveAttribute('aria-pressed', 'true');
  await expect(strip.locator('.link-tail')).toHaveText('→P2');
});

test('autosave restores the project after a reload; export / import round-trip', async ({ page }) => {
  await page.addInitScript(installFakeMidi);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('transpose-0').fill('7');
  await page.getByTestId('transpose-0').press('Enter');
  await page.getByTestId('demo-phase-garden').waitFor({ state: 'detached' }).catch(() => {});
  await page.waitForTimeout(1200); // autosave debounce
  await page.reload();
  await expect(page.getByTestId('transpose-0')).toHaveValue('7');

  const json = await page.evaluate(() => (window as unknown as { feelers: { exportJson(): string } }).feelers.exportJson());
  const parsed = JSON.parse(json);
  expect(parsed.format).toBe('feelers.project');
  expect(parsed.version).toBe(2);
  parsed.project.name = 'Imported test';
  parsed.project.lines[2].channel = 12;
  await page.getByTestId('menu').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'x.feelers.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(parsed)) });
  await expect(page.locator('.title')).toHaveValue('Imported test');
  await expect(page.getByTestId('channel-2')).toHaveValue('12');
});

test('demos load from the project panel', async ({ page }) => {
  await boot(page);
  await page.getByTestId('menu').click();
  await page.getByTestId('demo-clockwork').click();
  await expect(page.locator('.title')).toHaveValue('Clockwork');
  await expect(page.locator('.link-tail')).toHaveCount(1);
  await expect(page.getByTestId('link-P3')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cell.loop')).toHaveCount(2);
});

test('performance memories store and recall', async ({ page }) => {
  await boot(page);
  await page.getByTestId('transpose-1').fill('5');
  await page.getByTestId('transpose-1').press('Enter');
  await page.getByTestId('mem-store').click();
  await page.getByTestId('mem-0').click();
  await expect(page.getByTestId('mem-0')).toHaveClass(/full/);
  await page.getByTestId('transpose-1').fill('-3');
  await page.getByTestId('transpose-1').press('Enter');
  await page.getByTestId('mem-0').click();
  await expect(page.getByTestId('transpose-1')).toHaveValue('5');
});

test('works without Web MIDI', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined, configurable: true }));
  await page.goto('/');
  await expect(page.getByTestId('midi-status')).toContainText('no Web MIDI');
  await page.getByTestId('start').click();
  await page.waitForTimeout(800);
  await expect(page.locator('.cell .tab.live').first()).toBeVisible();
  await page.getByTestId('stop').click();
  expect(errors).toEqual([]);
});

test('phone width has no horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('audio preview listens to the MIDI stream without errors', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('preview').click();
  await expect(page.getByTestId('preview')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('start').click();
  await page.waitForTimeout(1000);
  await page.getByTestId('stop').click();
  expect(errors).toEqual([]);
});

test('a performance becomes a downloadable MIDI take', async ({ page }) => {
  await boot(page);
  await page.getByTestId('start').click();
  await page.waitForTimeout(1200);
  await page.getByTestId('stop').click();
  await page.getByTestId('menu').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('take-0').click()]);
  expect(download.suggestedFilename()).toMatch(/\.mid$/);
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(path!);
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('MThd');
});

test('the same build works under a project sub-path such as /feelers/', async ({ page }) => {
  const errors: string[] = [];
  const failed: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => failed.push(r.url()));
  page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  // Serve the root build at /feelers/ (as GitHub Pages does for a project site).
  await page.route('**/feelers/**', async (route) => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace(/^\/feelers\//, '/');
    const res = await route.fetch({ url: url.toString() });
    await route.fulfill({ response: res });
  });
  await page.addInitScript(installFakeMidi);
  await page.goto('/feelers/');
  await expect(page.getByTestId('line-3')).toBeVisible();
  const css = await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')!).borderBottomStyle);
  expect(css).toBe('solid');
  await page.getByTestId('start').click();
  await expect(page.locator('.cell .tab.live').first()).toBeVisible();
  await page.getByTestId('stop').click();
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
  expect(urls.filter((u) => u.includes('/assets/')).every((u) => u.includes('/feelers/assets/'))).toBe(true);
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});

test('Scale Mode shows what it transforms, in the bank and in the line panels', async ({ page }) => {
  await boot(page);
  await pickDevice(page);
  await page.getByTestId('menu').click();
  await page.getByTestId('demo-scale-lens').click();
  const p1 = page.locator('[data-testid=strip-P1]');
  // D Dorian (D E F G A B C): D#4, F#4, G#4 and C#5 move, each a tie that goes up; the stored values are shown.
  await expect(p1.locator('.cell.xf')).toHaveCount(4);
  await expect(p1.locator('.cell.xf .txt')).toHaveText(['D#4', 'F#4', 'G#4', 'C#5']);
  await expect(p1.locator('.cell.xf [data-testid=xf-delta]')).toHaveText(['+1', '+1', '+1', '+1']);
  // Changing the root updates the marks at once: C Dorian has D#.
  await page.getByTestId('scale-root').selectOption('0');
  await expect(p1.locator('.cell.xf .txt')).toHaveText(['F#4', 'G#4', 'C#5']);
  // A different direction: DOWN moves the same notes the other way.
  await page.getByTestId('scale-dir-down').click();
  await expect(p1.locator('.cell.xf [data-testid=xf-delta]')).toHaveText(['−1', '−1', '−1']);
  await page.getByTestId('scale-dir-nearest').click();
  // OFF: no marks, nothing constrained.
  await page.getByTestId('scale-on').click();
  await expect(p1.locator('.cell.xf')).toHaveCount(0);
  await page.getByTestId('scale-on').click();
  await page.getByTestId('scale-root').selectOption('2');
  // The lens can show one line: line 3 ignores Scale Mode.
  await page.getByTestId('lens-2').click();
  await expect(page.locator('.cell.xf')).toHaveCount(0);
  await page.getByTestId('lens-global').click();

  await page.getByTestId('start').click();
  // Line 1 eventually plays a transformed note and shows source -> output.
  await expect(page.getByTestId('result-0').getByTestId('scale-delta')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('result-0').getByTestId('pre-pitch')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByTestId('stop').click();
  const dorian = new Set([2, 4, 5, 7, 9, 11, 0]);
  const ch1 = (await sent(page)).filter((m) => isOn(m) && chan(m) === 1).map((m) => m.bytes[1]! % 12);
  expect(ch1.length).toBeGreaterThan(4);
  expect(ch1.every((pc) => dorian.has(pc))).toBe(true);
  // Line 3 is OFF: its stored G#5 / F5 come through unchanged.
  const ch3 = (await sent(page)).filter((m) => isOn(m) && chan(m) === 3).map((m) => m.bytes[1]);
  expect(ch3).toContain(80);
  expect(paired(await sent(page))).toEqual([]);
  // The stored series were never rewritten.
  const p1vals = await page.evaluate(() => (window as unknown as { feelers: { column(id: string): { els: { v: number }[] } } }).feelers.column('P1').els.map((e) => e.v));
  expect(p1vals).toEqual([62, 63, 65, 66, 67, 68, 69, 72, 73]);
});

test('Restore Last Start brings back values changed by ? and undoes on a second press', async ({ page }) => {
  await boot(page);
  await page.getByTestId('menu').click();
  await page.getByTestId('demo-drift').click();
  await expect(page.getByTestId('restore')).toBeDisabled();
  const p1 = () => page.evaluate(() => (window as unknown as { feelers: { column(id: string): { els: { v: number }[] } } }).feelers.column('P1').els.map((e) => e.v));
  const start = await p1();
  await page.getByTestId('start').click();
  await expect.poll(async () => JSON.stringify(await p1()), { timeout: 8000 }).not.toBe(JSON.stringify(start));
  await page.getByTestId('pause').click();
  const drifted = await p1();
  await page.getByTestId('restore').click();
  expect(await p1()).toEqual(start);
  await expect(page.getByTestId('restore')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('restore').click();
  expect(await p1()).toEqual(drifted);
  await page.getByTestId('stop').click();
});

test('palettes recolour the whole instrument, persist apart from the project', async ({ page }) => {
  await boot(page);
  const paper = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim());
  expect(await paper()).toBe('#f8f5ec');
  await page.getByTestId('menu').click();
  await page.getByTestId('palette-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'dark');
  expect(await paper()).toBe('#17191c');
  const panelBg = await page.evaluate(() => getComputedStyle(document.querySelector('.line')!).backgroundColor);
  expect(panelBg).toBe('rgb(23, 25, 28)');
  // Not part of the project file.
  const json = await page.evaluate(() => (window as unknown as { feelers: { exportJson(): string } }).feelers.exportJson());
  expect(json).not.toContain('17191c');
  // Editing a built-in makes a copy.
  await page.getByTestId('pal-hex-transform').fill('#ff00ff');
  await page.getByTestId('pal-hex-transform').press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'custom');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--xform').trim())).toBe('#ff00ff');
  // Kept in this browser under feelers.palette.* (this harness clears storage on reload, so read it directly).
  const stored = await page.evaluate(() => [localStorage.getItem('feelers.palette.selected'), localStorage.getItem('feelers.palette.custom')]);
  expect(stored[0]).toMatch(/^custom-/);
  expect(stored[1]).toContain('#ff00ff');
});

test('a version 1 project file is converted on import, and says so', async ({ page }) => {
  await boot(page);
  const { readFileSync } = await import('node:fs');
  const golden = JSON.parse(readFileSync('tests/fixtures/v1-golden.json', 'utf8'));
  await page.getByTestId('menu').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'old.feelers.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(golden.controls.file)) });
  await expect(page.locator('.title')).toHaveValue('v1 controls');
  await expect(page.getByTestId('status')).toContainText('older Feelers format');
  await expect(page.locator('[data-testid=strip-P2] .cell.loop')).toHaveText(/L×2/);
});
