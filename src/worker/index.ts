/**
 * Durable background worker (pg-boss on Postgres — no in-memory timers).
 * Start with `npm run worker`. Run several for redundancy; pg-boss guarantees each cron tick
 * is enqueued once and each job is processed by one worker.
 */
try {
  process.loadEnvFile(".env");
} catch {
  /* env provided by the platform */
}
import PgBoss from "pg-boss";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { JOBS } from "./jobs";

async function main() {
  const boss = new PgBoss({ connectionString: env().DATABASE_URL, schema: "pgboss", application_name: "alumni-worker" });
  boss.on("error", (err) => logger.error("pg-boss error", { err }));
  await boss.start();

  for (const job of JOBS) {
    await boss.createQueue(job.name, { name: job.name, policy: "singleton", retryLimit: 2, retryDelay: 30, expireInSeconds: 600 });
    await boss.schedule(job.name, job.cron, {}, { tz: "UTC" });
    await boss.work(job.name, { batchSize: 1 }, async () => {
      const started = Date.now();
      const result = await job.run();
      logger.info("job finished", { job: job.name, ms: Date.now() - started, result });
    });
    logger.info("job registered", { job: job.name, cron: job.cron });
  }

  const shutdown = async (signal: string) => {
    logger.info("worker stopping", { signal });
    await boss.stop({ graceful: true, timeout: 30_000 });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("worker failed to start", { err });
  process.exit(1);
});
