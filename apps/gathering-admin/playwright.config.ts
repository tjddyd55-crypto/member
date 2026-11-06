import { defineConfig } from '@playwright/test';

const storageOff = {
  R2_BUCKET: '',
  R2_ENDPOINT: '',
  R2_ACCESS_KEY_ID: '',
  R2_SECRET_ACCESS_KEY: '',
  R2_PREFIX_ENV: '',
  STORAGE_BUCKET: '',
  STORAGE_ENDPOINT: '',
  STORAGE_ACCESS_KEY: '',
  STORAGE_SECRET_KEY: '',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  outputDir: '/tmp/gathering-admin-playwright',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'pc', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    {
      command: 'npx tsx apps/api/src/index.ts',
      cwd: '../..',
      url: 'http://127.0.0.1:3001/health',
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: '3001',
        GATHERING_DEV_STORAGE: '1',
        GATHERING_DEV_STORAGE_DIR: '/tmp/gathering-admin-e2e-storage',
        ...storageOff,
      },
    },
    {
      command: 'npx vite preview --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
