/**
 * The ONE way app code gets the client IP (rate limits, lockouts, audit). Never x-forwarded-for.
 *   - Custom server (npm start): the header server.ts sets from the socket and always overwrites.
 *   - CLIENT_IP_HEADER set: that header, read directly. It must be one the platform/proxy overwrites
 *     on every request (Netlify: x-nf-client-connection-ip; Cloudflare: cf-connecting-ip). This is what
 *     makes serverless hosting work, where there is no custom server (DECISIONS D101).
 * Returns null when unknown; callers that rate-limit REFUSE such requests rather than putting them
 * in a shared "unknown" bucket.
 */
import { INTERNAL_CLIENT_IP_HEADER, normalizeIp } from "./client-ip-core";

type HeaderSource = { get(name: string): string | null };

export function clientIp(headers: HeaderSource): string | null {
  const platformHeader = process.env.CLIENT_IP_HEADER?.trim();
  if (platformHeader) return normalizeIp(headers.get(platformHeader)?.split(",")[0]);
  return normalizeIp(headers.get(INTERNAL_CLIENT_IP_HEADER));
}

export class NoClientIpError extends Error {
  override name = "NoClientIpError";
}
