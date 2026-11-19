/**
 * Registry of background jobs. Each job is idempotent and safe to run concurrently,
 * so a missed or doubled cron tick never causes duplicate effects.
 */
import { prisma } from "@/server/db";
import { processOutbox } from "@/server/outbox";
import { runSurveyTick } from "@/server/services/surveys";
import { runRetention } from "@/server/services/privacy";

export interface JobDef {
  name: string;
  cron: string;
  description: string;
  run: () => Promise<unknown>;
}

export const JOBS: JobDef[] = [
  { name: "survey-tick", cron: "*/5 * * * *", description: "Queue due surveys and reminders, then send", run: () => runSurveyTick() },
  { name: "outbox-drain", cron: "* * * * *", description: "Send due emails, retry failures, recover stuck sends", run: () => processOutbox() },
  { name: "retention", cron: "43 2 * * *", description: "Anonymize graduates past the retention period; delete old audit logs and email logs", run: () => runRetention() },
  {
    name: "housekeeping",
    cron: "17 3 * * *",
    description: "Delete expired one-time codes, rate-limit buckets and password-reset tokens",
    run: async () => {
      const dayAgo = new Date(Date.now() - 86_400_000);
      const [codes, buckets, tokens] = await Promise.all([
        prisma.oneTimeCode.deleteMany({ where: { OR: [{ expiresAt: { lt: dayAgo } }, { consumedAt: { lt: dayAgo } }] } }),
        prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: dayAgo } } }),
        prisma.verificationToken.deleteMany({ where: { expires: { lt: new Date() } } }),
      ]);
      return { codes: codes.count, buckets: buckets.count, tokens: tokens.count };
    },
  },
];

/**
 * For hosts without a long-running worker (Netlify): which jobs each scheduled call to
 * /api/cron/<group> runs. The pg-boss worker ignores this and uses each job's own cron.
 */
export const CRON_GROUPS = {
  frequent: ["outbox-drain", "survey-tick", "outbox-drain"], // drain again so newly queued surveys go out now
  daily: ["retention", "housekeeping"],
} as const;
