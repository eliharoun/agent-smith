import { join } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: process.env.SMITH_GUI_URL ?? "http://127.0.0.1:17777",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run ../../src/index.ts gui --no-open --port 17777",
    url: "http://127.0.0.1:17777/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      XDG_CONFIG_HOME: join(process.cwd(), ".e2e-config"),
      XDG_STATE_HOME: join(process.cwd(), ".e2e-state"),
      SMITH_FAKE_TOOLS: "opencode",
      SMITH_GUI_DEV_TOKEN: "e2e-token",
    },
  },
});
