import { defineConfig, devices } from "@playwright/test";

/**
 * Server-mode tests (milestone 5.3). They build nothing: run `npm run build:server -w @gap/web` and
 * `npm run build -w @gap/server` first. The global setup makes a temporary data folder, creates the
 * settings with the admin tool and starts the real server twice: on 8788 with storage "server" and on
 * 8789 with storage "client". Both folders are deleted again at the end.
 */
export default defineConfig({
  testDir: "e2e-server",
  globalSetup: "./e2e-server/global-setup.ts",
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Own output folders, so the static suite's report and results are not overwritten when both run (in CI one after the other).
  outputDir: "test-results-server",
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-server" }]] : "list",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:8788/",
    trace: "retain-on-failure",
    acceptDownloads: true,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
});
