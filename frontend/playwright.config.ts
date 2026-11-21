import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL,
    browserName: 'chromium',
    reducedMotion: 'reduce',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: [
    {
      command: 'npm run dev -- --port 4173 --strictPort',
      url: baseURL,
      env: { THREADPORT_API_URL: 'http://127.0.0.1:8001' },
    },
    {
      command: '.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8001',
      cwd: '..',
      url: 'http://127.0.0.1:8001/health',
      env: { THREADPORT_REMBG: '0' },
    },
  ],
})
