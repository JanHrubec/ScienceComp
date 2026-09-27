import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/browser', timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3101', trace: 'retain-on-failure' },
  webServer: { command: 'node --import tsx tests/browser-server.ts', url: 'http://127.0.0.1:3101/api/health', reuseExistingServer: false, timeout: 20000 },
})
