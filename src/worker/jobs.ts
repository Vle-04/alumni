/**
 * Registry of background jobs. Each job is idempotent and safe to run concurrently,
 * so a missed or doubled cron tick never causes duplicate effects.
 */
import { prisma } from "@/server/db";
import { processOutbox } from "@/server/outbox";
import { runSurveyTick } from "@/server/services/surveys";

export interface JobDef {
  name: string;
  cron: string;
  description: string;
  run: () => Promise<unknown>;
}

export const JOBS: JobDef[] = [
  { name: "survey-tick", cron: "*/5 * * * *", description: "Queue due surveys and reminders, then send", run: () => runSurveyTick() },
  { name: "outbox-drain", cron: "* * * * *", description: "Send due emails, retry failures, recover stuck sends", run: () => processOutbox() },
  {
    name: "housekeeping",
    cron: "17 3 * * *",
    description: "Delete expired one-time codes, rate-limit buckets and sign-in tokens",
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
