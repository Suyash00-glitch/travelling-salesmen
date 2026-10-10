import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5182',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite --config frontend/vite.verify.config.ts',
    url: 'http://127.0.0.1:5182',
    reuseExistingServer: true,
    timeout: 30000,
  },
  reporter: 'list',
  timeout: 30000,
});
