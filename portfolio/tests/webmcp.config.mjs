import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = mkdtempSync(join(tmpdir(), 'farol-webmcp-'));
process.env.FAROL_URL = 'http://127.0.0.1:18083';
export default defineConfig({
  testDir: '.', testMatch: ['webmcp/**/*.spec.mjs', 'specs/farol-resilience.spec.mjs'],
  workers: 1, timeout: 30_000,
  reporter: [['list'], ['json', { outputFile: 'test-results/webmcp.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:18083', headless: true,
    viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `"${process.env.FAROL_PYTHON || 'python'}" -m uvicorn app:app --host 127.0.0.1 --port 18083`,
    cwd: '../farol/service', url: 'http://127.0.0.1:18083/api/health', reuseExistingServer: false,
    env: { FAROL_DB: join(data, 'session.db'), FAROL_INDEX_DB: ':memory:', LLM_MODEL: '', REVIEW_WEBHOOK_URL: '' },
  },
});
