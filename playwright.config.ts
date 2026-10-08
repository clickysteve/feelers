import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// The cloud container ships a Chromium build; use it directly when present
// so `playwright install` is never required.
const bundled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = process.env.FEELERS_CHROMIUM ?? (existsSync(bundled) ? bundled : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
