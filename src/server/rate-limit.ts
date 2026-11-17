/**
 * Fixed-window rate limiter stored in Postgres (no extra infrastructure).
 * Keys must not contain raw personal data — emails are hashed before use.
 */
import { headers } from "next/headers";
import { prisma } from "./db";
import { blindIndex } from "./crypto";

export async function checkRateLimit(rawKey: string, limit: number, windowSeconds: number): Promise<boolean> {
  const key = rawKey.includes("@") ? rawKey.replace(/[^:]+@[^:]+/, (m) => blindIndex(m).slice(0, 24)) : rawKey;
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"`;
  return (rows[0]?.count ?? 0) <= limit;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
