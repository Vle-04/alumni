/**
 * Field-level encryption for contact data (AES-256-GCM, versioned keys) and HMAC blind
 * indexes for equality lookups without decryption.
 *
 * Ciphertext format: `<keyVersion>.<iv b64url>.<tag b64url>.<ciphertext b64url>`
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

interface Key {
  version: string;
  key: Buffer;
}

let keyring: Key[] | undefined;

function keys(): Key[] {
  if (keyring) return keyring;
  keyring = env()
    .DATA_ENCRYPTION_KEYS.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(":");
      if (idx < 1) throw new Error("DATA_ENCRYPTION_KEYS entries must look like v1:<base64>");
      const version = entry.slice(0, idx);
      const key = Buffer.from(entry.slice(idx + 1), "base64");
      if (key.length !== 32) throw new Error(`Encryption key ${version} must be 32 bytes`);
      return { version, key };
    });
  if (keyring.length === 0) throw new Error("DATA_ENCRYPTION_KEYS is empty");
  return keyring;
}

export function encrypt(plain: string): string {
  const { version, key } = keys()[0]!;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [version, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ct] = payload.split(".");
  const k = keys().find((x) => x.version === version);
  if (!k || !iv || !tag || ct === undefined) throw new Error("Unreadable ciphertext or unknown key version");
  const decipher = createDecipheriv("aes-256-gcm", k.key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export const encryptOpt = (v: string | null | undefined) => (v ? encrypt(v) : null);
export const decryptOpt = (v: string | null | undefined) => (v ? decrypt(v) : null);

/** Deterministic keyed hash for equality lookups (e.g. find graduate by email). */
export function blindIndex(value: string): string {
  return createHmac("sha256", env().BLIND_INDEX_KEY).update(value.trim().toLowerCase()).digest("hex");
}

/** Hashes short secrets such as one-time codes (keyed so a DB leak cannot brute-force offline). */
export function hashSecret(value: string): string {
  return createHmac("sha256", env().BLIND_INDEX_KEY).update(`secret:${value}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Shows enough of an email to recognise it without revealing it: a•••@example.com */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "•••";
  return `${user[0]}•••@${domain}`;
}

/** For tests only. */
export function resetKeyring() {
  keyring = undefined;
}
