/**
 * Lockout after repeated FAILURES (separate from plain request rate limits).
 * A scope is locked once it has `limit` failures in the current fixed window; while locked,
 * even correct credentials are refused, so guessing can't continue in the same window.
 *
 * Limits are admin-configurable (Settings → Security; defaults below), with safe bounds, because
 * graduates on one campus or mobile network share an IP (see DECISIONS D95 and PRIVACY.md).
 *   graduate / partner links: 10 failed tokens per IP per 15 minutes
 *   one-time codes:           10 wrong codes per graduate per hour (on top of 5 tries per code)
 */
import { prisma } from "./db";
import { getSetting } from "./settings";

export type LockoutKind = "gradLink" | "partnerLink" | "otp";

async function rule(kind: LockoutKind) {
  const s = await getSetting("security");
  return { limit: s[kind].limit, windowSeconds: s[kind].windowMinutes * 60 };
}

function windowStart(windowSeconds: number, now: Date) {
  const w = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / w) * w);
}
const keyOf = (kind: LockoutKind, id: string) => `fail:${kind}:${id}`;

export async function isLockedOut(kind: LockoutKind, id: string, now = new Date()): Promise<boolean> {
  const { limit, windowSeconds } = await rule(kind);
  const row = await prisma.rateLimitBucket.findUnique({ where: { key_windowStart: { key: keyOf(kind, id), windowStart: windowStart(windowSeconds, now) } } });
  return (row?.count ?? 0) >= limit;
}

export async function recordFailure(kind: LockoutKind, id: string, now = new Date()): Promise<void> {
  const { windowSeconds } = await rule(kind);
  const key = keyOf(kind, id);
  const ws = windowStart(windowSeconds, now);
  await prisma.$executeRaw`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count") VALUES (${key}, ${ws}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1`;
}

export async function retryAfterSeconds(kind: LockoutKind, now = new Date()): Promise<number> {
  const { windowSeconds } = await rule(kind);
  return Math.ceil((windowStart(windowSeconds, now).getTime() + windowSeconds * 1000 - now.getTime()) / 1000);
}
