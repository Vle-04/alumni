import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { assertTestDatabase } from "../test-db-guard";

/** Fresh, seeded test database for every e2e run (only ever a *_test database). */
export default async function globalSetup() {
  try { process.loadEnvFile(".env"); } catch { /* CI */ }
  const url = assertTestDatabase(process.env.TEST_DATABASE_URL);
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  const db = new PrismaClient({ datasources: { db: { url } } });
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await db.$disconnect();
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}
