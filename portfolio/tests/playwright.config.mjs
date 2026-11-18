import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./specs",
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 840 },
    trace: "retain-on-failure",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  reporter: [["list"]],
});
