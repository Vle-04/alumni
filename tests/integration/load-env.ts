import { assertTestDatabase } from "../test-db-guard";
// Loads .env (if present) and points DATABASE_URL at the test database.
try {
  process.loadEnvFile(".env");
} catch {
  /* CI provides variables directly */
}
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL must be set for integration tests");
process.env.DATABASE_URL = assertTestDatabase(process.env.TEST_DATABASE_URL);
process.env.EMAIL_PROVIDER = "console";
(process.env as Record<string, string>).NODE_ENV = "test";
