import { defineConfig, devices } from '@playwright/test';

// Herald talks to the oracle over the /api dev proxy (proxy.conf.json → :8000), so both
// servers must be up. Playwright manages them via `webServer`; commands run from the herald
// directory (where you invoke `npm run e2e`). In CI, ORACLE_PYTHON points at the system
// interpreter (deps installed globally); locally we default to the project venv (see CLAUDE.md).
// Windows launches the webServer command via cmd.exe, which reads a forward-slashed
// ".venv/Scripts/python" as the program ".venv" plus a "/Scripts" switch — so use backslashes there.
const oraclePython =
  process.env.ORACLE_PYTHON ??
  (process.platform === 'win32' ? '.venv\\Scripts\\python' : '.venv/bin/python');

// Static single-user credentials for e2e. The hash is bcrypt('e2e-password'); the oracle
// reads these from the environment (env vars beat the dev .env file), so a real developer's
// credentials are never involved. Kept in sync with e2e/helpers.ts.
const E2E_USERNAME = 'e2e';
const E2E_PASSWORD_HASH = '$2b$12$GAhR8NlpooXBnPfYlLkwuuzdgdeW81qseYZ1rdN5cnyQjC8hvCC.K';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `${oraclePython} -m uvicorn app.main:app --port 8000`,
      cwd: '../oracle',
      url: 'http://localhost:8000/api/health',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        APP_USERNAME: E2E_USERNAME,
        APP_PASSWORD_HASH: E2E_PASSWORD_HASH,
        JWT_SECRET: 'e2e-secret-not-for-production',
        // Force AI off so /summarize deterministically returns a 503 (never calls Gemini),
        // regardless of any key in a local oracle/.env. The e2e asserts the graceful error.
        GEMINI_API_KEY: '',
        DATABASE_URL:
          process.env.DATABASE_URL ?? 'postgresql+psycopg://kleio:kleio@localhost:5432/kleio',
      },
    },
    {
      command: 'npm run start',
      url: 'http://localhost:5000',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
