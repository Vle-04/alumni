/**
 * Acceptance:
 *  - A graduate can update their status from a phone in under 60 seconds using only the emailed link.
 *  - An expired or rotated link is rejected and offers a new-link request.
 * Runs on desktop and on a Pixel 7 profile.
 */
import { expect, test } from "@playwright/test";
import { signToken, type TokenPayload } from "../../src/domain/tokens/signedToken";
import { db } from "./helpers";

const KEY = process.env.TOKEN_SIGNING_KEY!;
const link = (p: Omit<TokenPayload, "exp">, ttlSeconds = 3600) => `/u/${signToken({ ...p, exp: Math.floor(Date.now() / 1000) + ttlSeconds }, KEY)}`;

async function employedGraduate() {
  // A graduate whose latest record is employed at a company with a role title.
  const rec = await db.employmentRecord.findFirstOrThrow({
    where: { status: "employed_full_time", roleTitle: { not: null }, companyId: { not: null }, graduate: { anonymizedAt: null, emailEnc: { not: null } } },
    orderBy: { reportedAt: "desc" },
    include: { graduate: true, company: true },
  });
  const latest = await db.employmentRecord.findFirstOrThrow({ where: { graduateId: rec.graduateId }, orderBy: [{ reportedAt: "desc" }, { createdAt: "desc" }], include: { company: true } });
  return { g: rec.graduate, latest };
}

test("survey from the emailed link: 'Yes, nothing changed' in one tap, well under 60 seconds", async ({ page }) => {
  const { g, latest } = await employedGraduate();
  const survey = await db.surveyInstance.upsert({
    where: { graduateId_milestone: { graduateId: g.id, milestone: 12 } },
    create: { graduateId: g.id, milestone: 12, scheduledFor: new Date(), status: "sent", sentAt: new Date() },
    update: { status: "sent", sentAt: new Date(), completedAt: null },
  });
  await db.employmentRecord.updateMany({ where: { surveyInstanceId: survey.id }, data: { surveyInstanceId: null } });
  await db.surveyResponse.deleteMany({ where: { surveyInstanceId: survey.id } });

  const started = Date.now();
  await page.goto(link({ sub: g.id, v: g.profileTokenVersion, p: "survey", ref: survey.id }));
  await expect(page).toHaveURL(new RegExp(`/me/survey/${survey.id}$`)); // token stripped from the URL
  const prompt = latest.status === "employed_full_time" && latest.company ? latest.company.canonicalName : "";
  if (prompt) await expect(page.getByText(new RegExp(`Still (at ${prompt}|)`))).toBeVisible();
  await page.getByRole("button", { name: "Yes, nothing changed" }).click();
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);

  const s = await db.surveyInstance.findUniqueOrThrow({ where: { id: survey.id }, include: { record: true } });
  expect(s.status).toBe("completed");
  expect(s.record?.status).toBe(latest.status);
});

test("self-update with branching: switching to 'Searching' shows search questions and hides job fields", async ({ page }) => {
  const { g } = await employedGraduate();
  await page.goto(link({ sub: g.id, v: g.profileTokenVersion, p: "profile" }));
  await expect(page).toHaveURL(/\/me$/);

  const form = page.locator("form.survey");
  await form.getByLabel("Employed full-time", { exact: true }).check();
  await expect(form.getByLabel("Company", { exact: true })).toBeVisible();
  await form.getByLabel("Searching", { exact: true }).check();
  await expect(form.getByLabel("Company", { exact: true })).toBeHidden();
  await form.getByLabel("Interviews").check();
  await form.getByLabel("Mock interview").check();
  await form.getByRole("button", { name: "Save my update" }).click();
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();

  const grad = await db.graduate.findUniqueOrThrow({ where: { id: g.id } });
  expect(grad.currentStatus).toBe("searching");
  expect(grad.lastSelfUpdateAt).not.toBeNull();
});

test("an expired link is rejected and offers a new-link request", async ({ page }) => {
  const { g } = await employedGraduate();
  await page.goto(link({ sub: g.id, v: g.profileTokenVersion, p: "profile" }, -10));
  await expect(page).toHaveURL(/\/link-expired\?r=expired/);
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
  await page.getByLabel("Your email").fill("someone-unknown@example.test");
  await page.getByRole("button", { name: "Send me a new link" }).click();
  await expect(page.getByText("If this email is in our records")).toBeVisible();
});

test("a rotated (revoked) link is rejected", async ({ page }) => {
  const { g } = await employedGraduate();
  const old = link({ sub: g.id, v: g.profileTokenVersion, p: "profile" });
  await db.graduate.update({ where: { id: g.id }, data: { profileTokenVersion: { increment: 1 } } });
  await page.goto(old);
  await expect(page.getByRole("heading", { name: "This link is no longer valid" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send me a new link" })).toBeVisible();
});

test("graduate pages are not reachable without a link", async ({ page }) => {
  await page.goto("/me");
  await expect(page).toHaveURL(/\/link-expired\?r=session/);
});
