import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { setEmailAdapter } from "@/server/email/adapters";
import { runSurveyTick } from "@/server/services/surveys";
import { FakeEmailAdapter } from "./fake-email";
import { makeCohort, makeGraduate, resetDb } from "./helpers";

const day = 86_400_000;
const T0 = new Date("2026-05-04T10:00:00Z");

describe("survey tick", () => {
  let fake: FakeEmailAdapter;
  let gradId: string;
  let surveyId: string;
  beforeEach(async () => {
    await resetDb();
    fake = new FakeEmailAdapter(false);
    setEmailAdapter(fake);
    const g = await makeGraduate((await makeCohort()).id);
    await prisma.graduate.update({ where: { id: g.id }, data: { timezone: "UTC" } });
    gradId = g.id;
    surveyId = (await prisma.surveyInstance.create({ data: { graduateId: g.id, milestone: 1, scheduledFor: new Date(T0.getTime() - 3600_000) } })).id;
  });
  afterEach(() => setEmailAdapter(undefined));

  it("sends a due survey once, then exactly two reminders at +4 and +10 days, then stops", async () => {
    await runSurveyTick(T0);
    await runSurveyTick(T0); // repeated tick: nothing new
    expect(fake.sent.map((m) => m.subject)).toHaveLength(1);
    const s = await prisma.surveyInstance.findUniqueOrThrow({ where: { id: surveyId } });
    expect(s.status).toBe("sent");

    await runSurveyTick(new Date(T0.getTime() + 3 * day)); // too early
    expect(fake.sent).toHaveLength(1);
    await runSurveyTick(new Date(T0.getTime() + 4 * day));
    await runSurveyTick(new Date(T0.getTime() + 4 * day + 60_000));
    expect(fake.sent).toHaveLength(2);
    await runSurveyTick(new Date(T0.getTime() + 10 * day));
    await runSurveyTick(new Date(T0.getTime() + 30 * day));
    expect(fake.sent).toHaveLength(3);
    expect(fake.sent.slice(1).every((m) => m.subject.startsWith("Reminder"))).toBe(true);
    expect((await prisma.surveyInstance.findUniqueOrThrow({ where: { id: surveyId } })).reminderCount).toBe(2);
  });

  it("stops reminding once the survey is completed", async () => {
    await runSurveyTick(T0);
    await prisma.surveyInstance.update({ where: { id: surveyId }, data: { status: "completed", completedAt: T0 } });
    await runSurveyTick(new Date(T0.getTime() + 10 * day));
    expect(fake.sent).toHaveLength(1);
  });

  it("skips the milestone when the graduate self-updated within 14 days", async () => {
    await prisma.graduate.update({ where: { id: gradId }, data: { lastSelfUpdateAt: new Date(T0.getTime() - 5 * day) } });
    await runSurveyTick(T0);
    expect(fake.sent).toHaveLength(0);
    expect((await prisma.surveyInstance.findUniqueOrThrow({ where: { id: surveyId } })).status).toBe("skipped_recent_update");
  });

  it("respects a configurable skip window", async () => {
    await prisma.setting.create({ data: { key: "surveys", value: { skipWindowDays: 3 } } });
    await prisma.graduate.update({ where: { id: gradId }, data: { lastSelfUpdateAt: new Date(T0.getTime() - 5 * day) } });
    await runSurveyTick(T0);
    expect(fake.sent).toHaveLength(1);
  });

  it("does not email unsubscribed graduates", async () => {
    await prisma.graduate.update({ where: { id: gradId }, data: { unsubscribedAt: T0 } });
    await runSurveyTick(T0);
    expect(fake.sent).toHaveLength(0);
    expect((await prisma.surveyInstance.findUniqueOrThrow({ where: { id: surveyId } })).status).toBe("cancelled");
  });
});
