/**
 * Applies pending Prisma migrations from inside the running app, using the app's own database
 * connection. Needed on Netlify Database, where only the deployed app gets owner credentials (the
 * CLI only hands out a read-only user), so `prisma migrate deploy` can't run from a developer machine.
 *
 * Compatible with Prisma's bookkeeping: rows go into `_prisma_migrations` with the same checksum
 * (sha256 of migration.sql) that Prisma uses, so `prisma migrate status` keeps working.
 * Each migration runs in its own transaction; a failure rolls it back completely and stops.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const PRISMA_ADVISORY_LOCK = 72707369; // the lock id Prisma Migrate uses, so the two never overlap

export type MigrationReport = { applied: string[]; alreadyApplied: number; checksumMismatch: string[] };

export function migrationsDir(): string {
  return join(process.cwd(), "prisma", "migrations");
}

export async function applyPendingMigrations(connectionString: string, dir = migrationsDir()): Promise<MigrationReport> {
  if (!existsSync(dir)) throw new Error(`Migrations folder not found: ${dir}`);
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "migration.sql")))
    .map((d) => d.name)
    .sort();

  const client = new pg.Client({ connectionString });
  await client.connect();
  const report: MigrationReport = { applied: [], alreadyApplied: 0, checksumMismatch: [] };
  try {
    await client.query("SELECT pg_advisory_lock($1)", [PRISMA_ADVISORY_LOCK]);
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
    const { rows } = await client.query<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>(
      `SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`,
    );
    const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
    if (failed.length) throw new Error(`A previous migration failed and needs manual attention: ${failed.join(", ")}`);
    const done = new Map(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => [r.migration_name, r.checksum]));

    for (const name of names) {
      const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      if (done.has(name)) {
        report.alreadyApplied++;
        if (done.get(name) !== checksum) report.checksumMismatch.push(name);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at", "finished_at", "applied_steps_count") VALUES ($1, $2, $3, now(), now(), 1)`,
          [randomUUID(), checksum, name],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${name} failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`);
      }
      report.applied.push(name);
    }
    return report;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [PRISMA_ADVISORY_LOCK]).catch(() => {});
    await client.end();
  }
}
