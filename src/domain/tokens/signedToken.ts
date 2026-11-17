/**
 * HMAC-SHA256 signed, expiring tokens for graduate and partner links.
 * Format: base64url(JSON payload) "." base64url(signature)
 *
 * The token carries a version number; the service compares it with the stored
 * `profileTokenVersion`, so incrementing the version revokes every older link.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type TokenPurpose = "profile" | "survey" | "session" | "unsubscribe" | "match" | "partner";

export interface TokenPayload {
  sub: string; // graduate id (or partner contact id)
  v: number; // token version
  p: TokenPurpose;
  exp: number; // unix seconds
  ref?: string; // e.g. survey instance id / match notification id
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_purpose" };

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

function sign(data: string, key: string): string {
  return b64(createHmac("sha256", key).update(data).digest());
}

export function signToken(payload: TokenPayload, key: string): string {
  if (!key) throw new Error("Token signing key is empty");
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(body, key)}`;
}

export function verifyToken(token: string, key: string, now: Date, purposes: readonly TokenPurpose[]): VerifyResult {
  if (typeof token !== "string" || token.length > 1024) return { ok: false, reason: "malformed" };
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(sign(body, key));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad_signature" };
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.sub !== "string" || typeof payload.v !== "number" || typeof payload.exp !== "number" || typeof payload.p !== "string") {
    return { ok: false, reason: "malformed" };
  }
  if (!purposes.includes(payload.p)) return { ok: false, reason: "wrong_purpose" };
  if (payload.exp * 1000 <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

export const LINK_TTL_DAYS = 30;

export function expiresIn(now: Date, seconds: number): number {
  return Math.floor(now.getTime() / 1000) + seconds;
}
