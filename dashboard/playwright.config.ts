import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3456" },
  webServer: {
    command: "NODE_ENV=production npx tsx server/index.ts",
    port: 3456,
    reuseExistingServer: true,
  },
});
