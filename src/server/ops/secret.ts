/** Bearer-secret check shared by the cron and ops routes (CRON_SECRET, at least 32 characters). */
import { createHash, timingSafeEqual } from "node:crypto";

const sha = (s: string) => createHash("sha256").update(s).digest();

export const opsEnabled = () => Boolean(process.env.CRON_SECRET);

export function opsAuthorized(authorizationHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 || !authorizationHeader) return false;
  return timingSafeEqual(sha(authorizationHeader), sha(`Bearer ${secret}`));
}
