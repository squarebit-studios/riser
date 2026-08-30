import { defineConfig, devices } from '@playwright/test';

/** Deliberately not Vite's default 4173, which collides with sibling projects. */
const PORT = 4319;

/**
 * End-to-end configuration.
 *
 * The suite runs against the PRODUCTION build (`vite preview`), not the dev
 * server, so what is tested is what ships - including the chunk splitting and
 * the minified three.js bundle.
 *
 * SwiftShader is the important flag. CI machines have no GPU, and without a
 * software rasteriser every WebGL test fails for a reason that has nothing to
 * do with the code. `--use-gl=angle --use-angle=swiftshader` is the
 * combination that works on headless Chromium.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // Software rasterisation is not bit-identical to a GPU, and antialiasing
      // differs between machines. This tolerance catches layout and colour
      // regressions without failing on a few stray pixels.
      maxDiffPixelRatio: 0.02
    }
  },

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 }
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--disable-lcd-text'
          ]
        }
      }
    }
  ],

  webServer: {
    // --host 127.0.0.1 is required, not cosmetic: Vite otherwise binds to
    // "localhost", which resolves to ::1 first on Windows, leaving the IPv4
    // address Playwright polls unreachable and the server apparently dead.
    command: `npm run preview -- --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    // Never reuse. Vite's default preview port is shared across every Vite
    // project on this machine, and reusing whatever already answers there
    // silently runs the suite against a different application - which is
    // exactly what happened the first time this ran.
    reuseExistingServer: false,
    timeout: 120_000
  }
});
