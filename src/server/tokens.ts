/**
 * Graduate personal links and the short-lived graduate session cookie.
 *
 *   email link  /u/<token>  (30 days, bound to profileTokenVersion)
 *        │  verified, then exchanged for →
 *   cookie alumni_grad (2 hours, HttpOnly, SameSite=Lax) and a redirect to a clean URL
 *
 * Rotating (incrementing profileTokenVersion) invalidates every older link AND every session.
 */
import { LINK_TTL_DAYS, expiresIn, signToken, verifyToken, type TokenPurpose } from "@/domain/tokens/signedToken";
import { env } from "./env";
import { prisma } from "./db";

export const GRAD_SESSION_COOKIE = "alumni_grad";
export const GRAD_SESSION_SECONDS = 2 * 60 * 60;

type GradRef = { id: string; profileTokenVersion: number };

function key() {
  return env().TOKEN_SIGNING_KEY;
}

export function createGraduateToken(g: GradRef, purpose: "profile" | "survey" | "match", ref?: string, now = new Date()): string {
  return signToken({ sub: g.id, v: g.profileTokenVersion, p: purpose, exp: expiresIn(now, LINK_TTL_DAYS * 86400), ...(ref ? { ref } : {}) }, key());
}

export function graduateLink(g: GradRef, opts: { surveyId?: string; matchId?: string; now?: Date } = {}): string {
  const token = opts.surveyId
    ? createGraduateToken(g, "survey", opts.surveyId, opts.now)
    : opts.matchId
      ? createGraduateToken(g, "match", opts.matchId, opts.now)
      : createGraduateToken(g, "profile", undefined, opts.now);
  return `${env().APP_URL}/u/${token}`;
}

/** Unsubscribe links are not version-bound (low-risk action that must keep working). Valid 1 year. */
export function unsubscribeLink(graduateId: string, now = new Date()): string {
  return `${env().APP_URL}/unsubscribe/${signToken({ sub: graduateId, v: 0, p: "unsubscribe", exp: expiresIn(now, 365 * 86400) }, key())}`;
}

export type ResolveResult =
  | { ok: true; graduateId: string; purpose: TokenPurpose; ref?: string; version: number }
  | { ok: false; reason: "expired" | "invalid" | "revoked" };

/** Verifies signature/expiry AND that the version is current and the graduate still exists. */
export async function resolveGraduateToken(token: string, purposes: readonly TokenPurpose[], now = new Date()): Promise<ResolveResult> {
  const r = verifyToken(token, key(), now, purposes);
  if (!r.ok) return { ok: false, reason: r.reason === "expired" ? "expired" : "invalid" };
  if (r.payload.p === "unsubscribe") return { ok: true, graduateId: r.payload.sub, purpose: r.payload.p, version: r.payload.v };
  if (r.payload.p === "session" && r.payload.ref === "partner") return { ok: false, reason: "invalid" };
  const g = await prisma.graduate.findUnique({ where: { id: r.payload.sub }, select: { profileTokenVersion: true, anonymizedAt: true } });
  if (!g || g.anonymizedAt) return { ok: false, reason: "invalid" };
  if (g.profileTokenVersion !== r.payload.v) return { ok: false, reason: "revoked" };
  return { ok: true, graduateId: r.payload.sub, purpose: r.payload.p, ref: r.payload.ref, version: r.payload.v };
}

export function createSessionValue(g: GradRef, now = new Date()): string {
  return signToken({ sub: g.id, v: g.profileTokenVersion, p: "session", exp: expiresIn(now, GRAD_SESSION_SECONDS) }, key());
}

export function sessionCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: env().APP_URL.startsWith("https://"), path: "/", maxAge: GRAD_SESSION_SECONDS };
}
