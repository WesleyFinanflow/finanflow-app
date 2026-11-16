import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
 testDir: "./tests", fullyParallel: false, workers: 1, retries: 0,
 maxFailures: process.env.CI ? 1 : 0, timeout: 45000, globalTimeout: 600000, expect: { timeout: 15000 },
 reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }]],
 use: { baseURL: "http://127.0.0.1:5392", trace: "retain-on-failure", screenshot: "only-on-failure", serviceWorkers: "block" },
 projects: [
  { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  { name: "mobile", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" } },
 ],
 webServer: { command: "node server.mjs", url: "http://127.0.0.1:5392", reuseExistingServer: false, timeout: 180000 },
});
