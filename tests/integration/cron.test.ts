/** /api/cron/<group>: runs background jobs for hosts without a worker (Netlify scheduled functions). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/cron/[group]/route";
import { CRON_GROUPS, JOBS } from "@/worker/jobs";
import { prisma } from "@/server/db";
import { resetDb } from "./helpers";

const SECRET = "x".repeat(40);
const call = (group: string, auth?: string) =>
  POST(new NextRequest(`http://localhost:3000/api/cron/${group}`, { method: "POST", headers: auth ? { authorization: auth } : {} }), { params: Promise.resolve({ group }) });

describe("cron route", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllEnvs());

  it("is disabled (404) when CRON_SECRET is not set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("frequent", "Bearer ")).status).toBe(404);
  });

  it("refuses a missing or wrong secret, and unknown groups", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call("frequent")).status).toBe(401);
    expect((await call("frequent", `Bearer ${SECRET}x`)).status).toBe(401);
    expect((await call("frequent", SECRET)).status).toBe(401);
    expect((await call("everything", `Bearer ${SECRET}`)).status).toBe(404);
  });

  it("refuses a too-short secret even if it matches", async () => {
    vi.stubEnv("CRON_SECRET", "short");
    expect((await call("daily", "Bearer short")).status).toBe(401);
  });

  it("runs the group's jobs with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    await prisma.rateLimitBucket.create({ data: { key: "old", windowStart: new Date(Date.now() - 3 * 86_400_000), count: 1 } });
    const res = await call("daily", `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; results: Record<string, unknown> };
    expect(Object.keys(body.results).sort()).toEqual(["housekeeping", "retention"]);
    expect(await prisma.rateLimitBucket.count({ where: { key: "old" } })).toBe(0);
    expect((await call("frequent", `Bearer ${SECRET}`)).status).toBe(200);
  });

  it("every scheduled job is covered by a group", () => {
    const covered = new Set<string>(Object.values(CRON_GROUPS).flat());
    expect(JOBS.map((j) => j.name).filter((n) => !covered.has(n))).toEqual([]);
  });
});
