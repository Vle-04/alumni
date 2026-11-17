import { execSync } from "node:child_process";
import e2eSetup from "../e2e/global-setup";

/** Seeded test database (same as the main e2e suite) + Mailpit to receive the magic link. */
export default async function setup() {
  execSync("docker compose up -d mailpit", { stdio: "pipe" });
  await e2eSetup();
}
