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

test('control elements can be placed from the editor', async ({ page }) => {
  await boot(page);
  await page.locator('[data-testid=strip-P1] .cell').nth(3).click();
  await page.getByTestId('el-end').click();
  await expect(page.locator('[data-testid=strip-P1] .cell.c-end')).toHaveCount(1);
  await expect(page.locator('[data-testid=strip-P1] .cell.dormant')).toHaveCount(3);
  await expect(page.locator('[data-testid=strip-P1] .cyc')).toHaveText('×3');
  await page.getByTestId('el-v').click();
  await expect(page.locator('[data-testid=strip-P1] .cell.c-end')).toHaveCount(0);
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
  expect(parsed.version).toBe(1);
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
  await expect(page.locator('.cell.c-link')).toHaveCount(1);
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
