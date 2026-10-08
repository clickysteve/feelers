import { expect, test, type Page } from '@playwright/test';
import { installFakeMidi } from './fake-midi';

type Msg = { bytes: number[]; t: number; at: number };
type FakeMidi = {
  sent: Msg[];
  reset(): void;
  sendIn(b: number[]): void;
  clockStart(bpm: number): void;
  clockStop(): void;
  unplugIn(): void;
  replugIn(): void;
};

const midi = (page: Page) => ({
  sent: () => page.evaluate(() => (window as unknown as { __midi: FakeMidi }).__midi.sent.slice()),
  reset: () => page.evaluate(() => (window as unknown as { __midi: FakeMidi }).__midi.reset()),
  sendIn: (b: number[]) => page.evaluate((x) => (window as unknown as { __midi: FakeMidi }).__midi.sendIn(x), b),
  clockStart: (bpm: number) => page.evaluate((x) => (window as unknown as { __midi: FakeMidi }).__midi.clockStart(x), bpm),
  clockStop: () => page.evaluate(() => (window as unknown as { __midi: FakeMidi }).__midi.clockStop()),
  unplugIn: () => page.evaluate(() => (window as unknown as { __midi: FakeMidi }).__midi.unplugIn()),
  replugIn: () => page.evaluate(() => (window as unknown as { __midi: FakeMidi }).__midi.replugIn()),
});

const isOn = (m: Msg) => (m.bytes[0]! & 0xf0) === 0x90 && m.bytes[2]! > 0;
const isOff = (m: Msg) => (m.bytes[0]! & 0xf0) === 0x80;
const chan = (m: Msg) => (m.bytes[0]! & 0x0f) + 1;

function hanging(msgs: Msg[]): string[] {
  const held = new Map<string, number>();
  const sorted = msgs.map((m, i) => ({ m, i })).sort((a, b) => a.m.t - b.m.t || a.i - b.i).map((x) => x.m);
  for (const m of sorted) {
    const k = `${chan(m)}:${m.bytes[1]}`;
    if (isOn(m)) held.set(k, 1);
    else if (isOff(m)) held.set(k, 0);
  }
  return [...held].filter(([, v]) => v > 0).map(([k]) => k);
}

async function bootExternal(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(installFakeMidi);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('feelers.test.booted')) {
      localStorage.clear();
      sessionStorage.setItem('feelers.test.booted', '1');
    }
  });
  await page.goto('/');
  await page.getByTestId('midi-out').selectOption('fake-out-1');
  await page.getByTestId('clock-ext').click();
  await page.getByTestId('midi-in').selectOption('fake-in-1');
  return errors;
}

test('EXTERNAL: clock alone never starts; FA starts; FC stops cleanly; FB continues; FA restarts fresh', async ({ page }) => {
  const errors = await bootExternal(page);
  const m = midi(page);
  await expect(page.getByTestId('start')).toBeDisabled();
  await expect(page.getByTestId('tempo')).toBeHidden();
  await expect(page.getByTestId('sync-status')).toHaveText('WAITING');

  await m.clockStart(120);
  await expect(page.getByTestId('sync-status')).toHaveText('CLOCK');
  await page.waitForTimeout(1500);
  const bpm = Number(await page.getByTestId('sync-bpm').textContent());
  expect(Math.abs(bpm - 120)).toBeLessThan(6);
  expect((await m.sent()).filter(isOn)).toEqual([]); // F8 while stopped: nothing plays

  await m.sendIn([0xfa]);
  await expect(page.getByTestId('sync-status')).toHaveText('RUNNING');
  await expect(page.locator('body')).toHaveAttribute('data-transport', 'playing');
  await page.waitForTimeout(2000);
  const chans = new Set((await m.sent()).filter(isOn).map(chan));
  expect([...chans].sort()).toEqual([1, 2, 3, 4]);
  await expect(page.locator('.cell .tab.live').first()).toBeVisible();

  await m.sendIn([0xfc]);
  await expect(page.getByTestId('sync-status')).toHaveText('STOPPED');
  await page.waitForTimeout(100);
  expect(hanging(await m.sent())).toEqual([]);
  const stoppedAt = await page.evaluate(() => (window as unknown as { feelers: { engine: { horizon: number } } }).feelers.engine.horizon);
  const onsAtStop = (await m.sent()).filter(isOn).length;
  await page.waitForTimeout(800); // clock keeps running while stopped
  expect((await m.sent()).filter(isOn).length).toBe(onsAtStop);

  await m.sendIn([0xfb]);
  await expect(page.getByTestId('sync-status')).toHaveText('RUNNING');
  await page.waitForTimeout(600);
  const afterContinue = await page.evaluate(() => (window as unknown as { feelers: { engine: { horizon: number } } }).feelers.engine.horizon);
  expect(afterContinue).toBeGreaterThan(stoppedAt); // resumed from the stop point, not from 0
  await expect(page.getByTestId('sync-pulses')).toContainText('FB');

  await m.sendIn([0xfa]); // Start again: fresh performance
  await page.waitForTimeout(150);
  const fresh = await page.evaluate(() => (window as unknown as { feelers: { engine: { horizon: number } } }).feelers.engine.horizon);
  expect(fresh).toBeLessThan(afterContinue);

  await m.sendIn([0xfc]);
  await m.clockStop();
  await page.waitForTimeout(100);
  expect(hanging(await m.sent())).toEqual([]);
  expect(errors).toEqual([]);
});

test('EXTERNAL: no clock is echoed to the output, and the CLOCK button explains why', async ({ page }) => {
  await page.addInitScript(installFakeMidi);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('midi-out').selectOption('fake-out-1');
  await page.getByTestId('clock').click(); // clock out on (internal)
  await page.getByTestId('clock-ext').click();
  await page.getByTestId('midi-in').selectOption('fake-in-1');
  await expect(page.getByTestId('clock')).toBeDisabled();
  const m = midi(page);
  await m.clockStart(130);
  await m.sendIn([0xfa]);
  await page.waitForTimeout(1200);
  await m.sendIn([0xfc]);
  await m.clockStop();
  const sys = (await m.sent()).filter((x) => x.bytes[0]! >= 0xf0);
  expect(sys).toEqual([]);
  expect((await m.sent()).filter(isOn).length).toBeGreaterThan(3);
});

test('EXTERNAL: clock loss shows LOST, releases notes, and carries on when clock returns', async ({ page }) => {
  await bootExternal(page);
  const m = midi(page);
  await m.clockStart(120);
  await m.sendIn([0xfa]);
  await page.waitForTimeout(1000);
  await m.clockStop();
  await expect(page.getByTestId('sync-status')).toHaveText('LOST');
  await expect(page.locator('body')).toHaveAttribute('data-transport', 'playing');
  await page.waitForTimeout(200);
  expect(hanging(await m.sent())).toEqual([]);
  const held = await page.evaluate(() => (window as unknown as { feelers: { engine: { horizon: number } } }).feelers.engine.horizon);
  await m.clockStart(120);
  await expect(page.getByTestId('sync-status')).toHaveText('RUNNING');
  await page.waitForTimeout(300);
  const now = await page.evaluate(() => (window as unknown as { feelers: { engine: { horizon: number } } }).feelers.engine.horizon);
  expect(now).toBeGreaterThan(held); // continued, not restarted
  expect(now).toBeLessThan(held + 60);
  await m.sendIn([0xfc]);
  await m.clockStop();
});

test('EXTERNAL: unplugging the clock input mid-performance is safe; replugging resumes', async ({ page }) => {
  const errors = await bootExternal(page);
  const m = midi(page);
  await m.clockStart(120);
  await m.sendIn([0xfa]);
  await page.waitForTimeout(800);
  await m.unplugIn();
  await expect(page.getByTestId('midi-status')).toContainText('Clock input disconnected');
  await expect(page.getByTestId('sync-status')).toHaveText('LOST');
  await page.waitForTimeout(150);
  expect(hanging(await m.sent())).toEqual([]);
  await m.replugIn();
  await expect(page.getByTestId('midi-status')).toContainText('reconnected');
  await expect(page.getByTestId('sync-status')).toHaveText('RUNNING');
  await m.sendIn([0xfc]);
  await m.clockStop();
  expect(errors).toEqual([]);
});

test('switching EXTERNAL back to INTERNAL restores the internal transport and tempo control', async ({ page }) => {
  await bootExternal(page);
  const m = midi(page);
  await m.clockStart(120);
  await m.sendIn([0xfa]);
  await page.waitForTimeout(600);
  await page.getByTestId('clock-int').click();
  await m.clockStop();
  await expect(page.locator('body')).toHaveAttribute('data-transport', 'stopped');
  await page.waitForTimeout(100);
  expect(hanging(await m.sent())).toEqual([]);
  await expect(page.getByTestId('tempo')).toBeVisible();
  await expect(page.getByTestId('start')).toBeEnabled();
  await m.reset();
  await page.getByTestId('start').click();
  await page.waitForTimeout(800);
  await page.getByTestId('stop').click();
  expect((await m.sent()).filter(isOn).length).toBeGreaterThan(3);
});

test('the MIDI log shows incoming transport but is not flooded by clock', async ({ page }) => {
  await bootExternal(page);
  const m = midi(page);
  await m.clockStart(140);
  await m.sendIn([0xfa]);
  await page.waitForTimeout(700);
  await m.sendIn([0xfc]);
  await m.clockStop();
  await expect(page.getByTestId('midi-log')).toContainText('IN  Start');
  await expect(page.getByTestId('midi-log')).toContainText('IN  Stop');
  await expect(page.getByTestId('midi-log')).not.toContainText('Clock');
  await expect(page.getByTestId('sync-pulses')).toContainText(/F8×\d+ · FC/);
});

test('clock source and input are remembered across reloads', async ({ page }) => {
  await bootExternal(page);
  await page.reload();
  await expect(page.getByTestId('clock-ext')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('midi-in')).toHaveValue('fake-in-1');
  await expect(page.getByTestId('sync-status')).toHaveText('WAITING');
});
