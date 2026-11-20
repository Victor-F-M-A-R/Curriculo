import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./specs",
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  use: {
    browserName: process.env.PW_BROWSER || "chromium",
    headless: true,
    viewport: { width: 1280, height: 840 },
    trace: "retain-on-failure",
    launchOptions: (!process.env.PW_BROWSER || process.env.PW_BROWSER === "chromium") && process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  reporter: [["list"], ["json", { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || "test-results/results.json" }]],
});
