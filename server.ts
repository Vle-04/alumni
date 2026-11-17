/**
 * Production / dev entry point: a thin Node HTTP server in front of Next.js.
 *
 * Its only job is client-IP integrity (see src/server/client-ip-core.ts): it resolves the client IP
 * from the real socket address (+ TRUSTED_PROXY_HOPS or CLIENT_IP_HEADER) and passes it to the app
 * in an internal header that it always overwrites. Next.js alone cannot provide this — it only
 * fills x-forwarded-for from the socket when the client didn't send one.
 *
 *   npm start           NODE_ENV=production, serves the `next build` output
 *   npm run dev         development mode
 */
import { createServer } from "node:http";
import next from "next";
import { INTERNAL_CLIENT_IP_HEADER, parseTrustedHops, resolveClientIp } from "./src/server/client-ip-core";

try {
  process.loadEnvFile(".env");
} catch {
  /* env provided by the platform */
}

const dev = process.argv.includes("--dev");
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME_BIND ?? "0.0.0.0";
const trustedHops = parseTrustedHops(process.env.TRUSTED_PROXY_HOPS);
const headerName = process.env.CLIENT_IP_HEADER?.trim() || null;

const app = next({ dev, port, hostname });
const handle = app.getRequestHandler();

await app.prepare();
createServer((req, res) => {
  const ip = resolveClientIp({ remoteAddress: req.socket.remoteAddress, headers: req.headers, trustedHops, headerName });
  // Always overwrite: a client-supplied value must never reach the app.
  if (ip) req.headers[INTERNAL_CLIENT_IP_HEADER] = ip;
  else delete req.headers[INTERNAL_CLIENT_IP_HEADER];
  void handle(req, res);
}).listen(port, hostname, () => {
  process.stdout.write(`> Ready on http://${hostname}:${port} (${dev ? "dev" : "production"}, trusted proxy hops: ${headerName ? `header ${headerName}` : trustedHops})\n`);
});
