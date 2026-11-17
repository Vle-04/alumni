/**
 * The ONE way app code gets the client IP (rate limits, lockouts, audit). Reads only the header the
 * custom server sets from the socket — never x-forwarded-for. Returns null when unknown; callers
 * that rate-limit REFUSE such requests rather than putting them in a shared "unknown" bucket.
 */
import { INTERNAL_CLIENT_IP_HEADER, normalizeIp } from "./client-ip-core";

type HeaderSource = { get(name: string): string | null };

export function clientIp(headers: HeaderSource): string | null {
  return normalizeIp(headers.get(INTERNAL_CLIENT_IP_HEADER));
}

export class NoClientIpError extends Error {
  override name = "NoClientIpError";
}
