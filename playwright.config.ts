import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: process.env.NO_WEB_SERVER ? undefined : [
    {
      command: 'NODE_ENV=development ENABLE_STATIC=0 TSX_USE_NETWORK_IPC=1 npm run dev',
      url: 'http://localhost:3001',
      reuseExistingServer: true,
      stdout: 'pipe',
      env: {
        NODE_ENV: 'development',
        ENABLE_STATIC: '0',
        TSX_USE_NETWORK_IPC: '1',
        PORT: '3001'
      }
    },
  ],
});

