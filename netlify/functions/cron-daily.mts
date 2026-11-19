/**
 * Netlify scheduled function (daily 03:17 UTC: retention and housekeeping).
 * It only calls the app's protected /api/cron/daily route, so the job code runs inside the Next.js
 * server function with the same Prisma client, env validation and logging as the rest of the app.
 */
import type { Config } from "@netlify/functions";

const handler = async () => {
  const base = process.env.URL; // the site's main URL, set by Netlify
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.error("cron-daily: URL or CRON_SECRET not set; skipping");
    return;
  }
  const res = await fetch(`${base}/api/cron/daily`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  const body = (await res.text()).slice(0, 500);
  if (!res.ok) console.error(`cron-daily: HTTP ${res.status}`, body);
  else console.warn(`cron-daily: ok`, body); // warn: the only non-error level the lint allows
};

export default handler;
export const config: Config = { schedule: "17 3 * * *" };
