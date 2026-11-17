/** Runs one background job immediately, outside the scheduler: `npm run jobs:run -- survey-tick` */
try {
  process.loadEnvFile(".env");
} catch {
  /* env from platform */
}
const { JOBS } = await import("../src/worker/jobs");
const jobName = process.argv[2];
const job = JOBS.find((j) => j.name === jobName);
if (!job) {
  console.log(`Usage: npm run jobs:run -- <job>\n\n${JOBS.map((j) => `  ${j.name.padEnd(14)} ${j.cron.padEnd(13)} ${j.description}`).join("\n")}`);
  process.exit(jobName ? 1 : 0);
}
console.log(JSON.stringify(await job.run(), null, 2));
const { prisma } = await import("../src/server/db");
await prisma.$disconnect();
export {};
