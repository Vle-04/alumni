/**
 * Client-IP resolution, shared by the custom server (server.ts) and the app.
 *
 * Next.js only fills `x-forwarded-for` from the socket when the client did NOT send one, so inside
 * Next the header is attacker-controlled. The custom server therefore resolves the client IP from
 * the real socket address and passes it to the app in INTERNAL_CLIENT_IP_HEADER, which it always
 * overwrites (a client can never set it). App code reads only that header — see client-ip.ts.
 *
 *   TRUSTED_PROXY_HOPS = 0 (default): ignore x-forwarded-for; use the socket address.
 *   TRUSTED_PROXY_HOPS = N: x-forwarded-for + socket form a chain; the client is the address N hops
 *     from the right (each trusted proxy appends the address it received from). Only correct if the
 *     app is reachable ONLY through those N proxies.
 *   CLIENT_IP_HEADER = name: use this proxy-set header instead (e.g. cf-connecting-ip), which the
 *     proxy must overwrite on every request.
 */
import { isIP } from "node:net";

export const INTERNAL_CLIENT_IP_HEADER = "x-alumni-client-ip";

export function normalizeIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  if (ip.startsWith("[") && ip.includes("]")) ip = ip.slice(1, ip.indexOf("]")); // [v6]:port
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":")); // v4:port
  if (ip.toLowerCase().startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7); // v4-mapped v6
  return isIP(ip) ? ip.toLowerCase() : null;
}

export interface ResolveInput {
  remoteAddress: string | undefined | null;
  headers: Record<string, string | string[] | undefined>;
  trustedHops: number;
  headerName?: string | null;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Returns the client IP, or null if none can be determined reliably. */
export function resolveClientIp({ remoteAddress, headers, trustedHops, headerName }: ResolveInput): string | null {
  if (headerName) return normalizeIp(first(headers[headerName.toLowerCase()])?.split(",")[0]);
  const socket = normalizeIp(remoteAddress);
  const hops = Number.isInteger(trustedHops) && trustedHops > 0 ? trustedHops : 0;
  if (hops === 0) return socket;
  const xff = (Array.isArray(headers["x-forwarded-for"]) ? headers["x-forwarded-for"].join(",") : headers["x-forwarded-for"] ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const chain = [...xff, ...(remoteAddress ? [remoteAddress] : [])];
  // The trusted proxies are the last `hops` entries; the client is the one just before them.
  const idx = chain.length - 1 - hops;
  return normalizeIp(idx >= 0 ? chain[idx] : chain[0]);
}

export function parseTrustedHops(raw: string | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 0;
}
