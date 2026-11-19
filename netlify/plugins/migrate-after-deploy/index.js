// Applies pending Prisma migrations after a deploy built by Netlify (dashboard "Deploy" button or a
// push to main). Netlify Database gives only the deployed app write access, so the new deploy applies
// them itself: POST <deploy URL>/api/ops/migrate with Bearer CRON_SECRET (same as
// scripts/deploy-netlify.sh, which handles local deploys; this plugin skips those).
const ATTEMPTS = 20;
const WAIT_MS = 6000;

export const onSuccess = async ({ constants, utils }) => {
  if (constants.IS_LOCAL) return;
  if (process.env.CONTEXT !== "production") return;
  const secret = process.env.CRON_SECRET ?? "";
  const base = process.env.DEPLOY_URL || process.env.URL;
  if (secret.length < 32 || !base) {
    utils.build.failPlugin("Migrations NOT applied: CRON_SECRET or the deploy URL is missing.");
    return;
  }

  let last = "";
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const res = await fetch(`${base}/api/ops/migrate`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
      const text = await res.text();
      if (res.ok) {
        utils.status.show({ title: "Database migrations applied", summary: text });
        console.warn(`Database migrations: ${text}`);
        return;
      }
      last = `HTTP ${res.status} ${text.slice(0, 300)}`;
      if (res.status === 401 || res.status === 500) break; // won't fix itself by waiting
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, WAIT_MS));
  }
  utils.build.failPlugin(`Migrations NOT applied (${last}). The new code is live; fix and redeploy.`);
};
