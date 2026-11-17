/**
 * HTTPS end-to-end suite (AUDIT 20): the production build behind a real TLS proxy (Caddy, from
 * docker-compose profile "tls"), asserting the real Set-Cookie headers. Needs Docker and Mailpit.
 *   npm run test:e2e:tls
 */
import { defineConfig } from "@playwright/test";

try {
  process.loadEnvFile(".env");
} catch {
  /* CI provides env */
}
const APP_PORT = 3101;
const HTTPS_URL = "https://localhost:8443";

export default defineConfig({
  testDir: "tests/e2e-tls",
  workers: 1,
  reporter: process.env.CI ? [["github"]] : "list",
  globalSetup: "./tests/e2e-tls/global-setup.ts",
  use: { baseURL: HTTPS_URL, ignoreHTTPSErrors: true },
  webServer: [
    {
      command: "npx tsx server.ts",
      port: APP_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env, NODE_ENV: "production", PORT: String(APP_PORT), DATABASE_URL: process.env.TEST_DATABASE_URL!,
        APP_URL: HTTPS_URL, TRUSTED_PROXY_HOPS: "1", EMAIL_PROVIDER: "smtp", SMTP_HOST: "localhost", SMTP_PORT: "1025",
      } as Record<string, string>,
    },
    {
      command: "docker compose --profile tls up tls",
      url: `${HTTPS_URL}/login`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
