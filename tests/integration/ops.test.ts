/** /api/ops/*: in-app migrations (Netlify Database) and first-admin bootstrap. */
import { mkdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/ops/[task]/route";
import { prisma } from "@/server/db";
import { applyPendingMigrations, migrationsDir } from "@/server/ops/migrate";
import { verifyPassword } from "@/server/password";
import { resetDb, staff } from "./helpers";

const SECRET = "y".repeat(40);
const url = process.env.TEST_DATABASE_URL!;
const call = (task: string, body?: unknown, auth = `Bearer ${SECRET}`) =>
  POST(new NextRequest(`http://localhost:3000/api/ops/${task}`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve({ task }) });

describe("in-app migrations", () => {
  it("agrees with Prisma's own bookkeeping: everything already applied, checksums identical", async () => {
    const r = await applyPendingMigrations(url);
    expect(r.applied).toEqual([]);
    expect(r.checksumMismatch).toEqual([]);
    expect(r.alreadyApplied).toBeGreaterThanOrEqual(4);
  });

  it("applies a new migration once, records it like Prisma, and rolls back a failing one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    cpSync(migrationsDir(), dir, { recursive: true });
    const add = (name: string, sql: string) => { mkdirSync(join(dir, name)); writeFileSync(join(dir, name, "migration.sql"), sql); };
    try {
      add("29990101000000_ops_test", `CREATE TABLE "OpsTest" ("id" INT PRIMARY KEY);\nINSERT INTO "OpsTest" VALUES (1);`);
      expect((await applyPendingMigrations(url, dir)).applied).toEqual(["29990101000000_ops_test"]);
      expect((await applyPendingMigrations(url, dir)).applied).toEqual([]);
      const row = await prisma.$queryRawUnsafe<{ finished_at: Date | null }[]>(`SELECT finished_at FROM "_prisma_migrations" WHERE migration_name = '29990101000000_ops_test'`);
      expect(row[0]?.finished_at).toBeTruthy();

      add("29990102000000_ops_bad", `CREATE TABLE "OpsBad" ("id" INT);\nSELECT nope_not_a_function();`);
      await expect(applyPendingMigrations(url, dir)).rejects.toThrow(/ops_bad failed and was rolled back/);
      expect(await prisma.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM pg_tables WHERE tablename = 'OpsBad'`)).toHaveLength(0);
      expect(await prisma.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '29990102000000_ops_bad'`)).toHaveLength(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "OpsTest"`);
      await prisma.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE migration_name LIKE '2999%'`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ops route", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllEnvs());

  it("is 404 without CRON_SECRET and 401 with a wrong one", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("migrate")).status).toBe(404);
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call("migrate", undefined, "Bearer nope")).status).toBe(401);
    expect((await call("drop-everything")).status).toBe(404);
  });

  it("migrate reports nothing pending on an up-to-date database", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const res = await call("migrate");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, applied: [], checksumMismatch: [] });
  });

  it("creates the first admin once, then refuses while an admin exists", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const res = await call("create-admin", { email: "Boss@Example.org", name: "Boss" });
    expect(res.status).toBe(200);
    const { password } = (await res.json()) as { password: string };
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "boss@example.org" } });
    expect(u.role).toBe("ADMIN");
    expect(await verifyPassword(password, u.passwordHash!)).toBe(true);
    expect((await call("create-admin", { email: "second@example.org", name: "Second" })).status).toBe(409);
    expect(await prisma.user.count({ where: { email: "second@example.org" } })).toBe(0);
  });

  it("refuses when any active admin already exists", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    await staff("ADMIN");
    expect((await call("create-admin", { email: "x@example.org", name: "X" })).status).toBe(409);
    expect((await call("create-admin", { email: "not-an-email", name: "X" })).status).toBe(422);
  });
});
