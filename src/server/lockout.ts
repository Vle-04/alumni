/**
 * Lockout after repeated FAILURES (separate from plain request rate limits).
 * A scope is locked once it has `limit` failures in the current fixed window; while locked,
 * even correct credentials are refused, so guessing can't continue in the same window.
 *
 *   graduate / partner links: 10 failed tokens per IP per 15 minutes
 *   one-time codes:           10 wrong codes per graduate per hour (on top of 5 tries per code)
 */
import { prisma } from "./db";

export const LOCKOUTS = {
  gradLink: { limit: 10, windowSeconds: 15 * 60 },
  partnerLink: { limit: 10, windowSeconds: 15 * 60 },
  otp: { limit: 10, windowSeconds: 60 * 60 },
} as const;
export type LockoutKind = keyof typeof LOCKOUTS;

function windowStart(kind: LockoutKind, now: Date) {
  const w = LOCKOUTS[kind].windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / w) * w);
}
const keyOf = (kind: LockoutKind, id: string) => `fail:${kind}:${id}`;

export async function isLockedOut(kind: LockoutKind, id: string, now = new Date()): Promise<boolean> {
  const row = await prisma.rateLimitBucket.findUnique({ where: { key_windowStart: { key: keyOf(kind, id), windowStart: windowStart(kind, now) } } });
  return (row?.count ?? 0) >= LOCKOUTS[kind].limit;
}

export async function recordFailure(kind: LockoutKind, id: string, now = new Date()): Promise<void> {
  const key = keyOf(kind, id);
  const ws = windowStart(kind, now);
  await prisma.$executeRaw`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count") VALUES (${key}, ${ws}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1`;
}

export function retryAfterSeconds(kind: LockoutKind, now = new Date()): number {
  return Math.ceil((windowStart(kind, now).getTime() + LOCKOUTS[kind].windowSeconds * 1000 - now.getTime()) / 1000);
}
