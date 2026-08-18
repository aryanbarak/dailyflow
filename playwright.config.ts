import { defineConfig } from '@playwright/test';

// MB-02b: real-browser smoke coverage for the Micro Breaks canvas renderer.
// jsdom (this repo's default vitest environment) stubs canvas 2D entirely
// (getContext('2d') returns null), so it silently can't catch a color
// string that's invalid CSS -- exactly how the MB-02b production incident
// shipped. These tests exercise the real browser's canvas/color parser via
// the DEV-only /__dev/micro-breaks-harness route (see
// MicroBreaksDevHarness.tsx), which is outside ProtectedRoute so it needs
// no Supabase session.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8090',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 8090 --strictPort',
    url: 'http://localhost:8090',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_SMARTFLOW_SUPABASE_MODE: 'production',
    },
  },
});
