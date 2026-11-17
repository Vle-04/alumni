/**
 * Acceptance:
 *  - For any opening, matched candidates are ranked and each match has a readable explanation.
 *  - Moving a referral to `hired` produces an employment record.
 *  - A graduate's details reach a partner only after Interested + share_with_partners consent.
 */
import { expect, test, type Page } from "@playwright/test";
import { signToken } from "../../src/domain/tokens/signedToken";
import { db, loginAs } from "./helpers";

const KEY = process.env.TOKEN_SIGNING_KEY!;
const exp = () => Math.floor(Date.now() / 1000) + 3600;

async function fixture(tag: string) {
  const skill = await db.skill.create({ data: { canonicalName: `E2E-Skill-${tag}` } });
  const company = await db.company.findFirstOrThrow({ where: { isPartner: true, contacts: { some: {} } }, include: { contacts: true } });
  const opening = await db.opening.create({
    data: { companyId: company.id, title: `E2E Developer ${tag}`, description: "End-to-end test opening.", roleCategory: "frontend", remoteMode: "remote", status: "open", skills: { create: { skillId: skill.id, weight: 5, mustHave: true } } },
  });
  const cohort = await db.cohort.findFirstOrThrow();
  const mk = async (name: string, share: boolean) => {
    const g = await db.graduate.create({
      data: { cohortId: cohort.id, fullName: `${name} ${tag}`, currentStatus: "searching", searchingSince: new Date(), preferredRoleCategories: ["frontend"], skills: { create: { skillId: skill.id, level: 4 } },
        consents: { create: [{ purpose: "job_matching", policyVersion: "test", source: "e2e" }, ...(share ? [{ purpose: "share_with_partners" as const, policyVersion: "test", source: "e2e" }] : [])] } },
    });
    return g;
  };
  return { opening, company, contact: company.contacts[0]!, sharer: await mk("Sharer", true), private_: await mk("Private", false) };
}

async function moveCard(page: Page, name: string, to: string) {
  const card = page.getByRole("listitem").filter({ has: page.getByRole("link", { name }) });
  await card.getByLabel(`Move ${name} to`).selectOption({ label: to });
  await expect(page.getByRole("region", { name: new RegExp(`^${to}:`) }).getByRole("link", { name })).toBeVisible();
}

test("ranked matches with explanations → notify → Interested → referral pipeline → hired → record; partner sees only shared details", async ({ page, context, baseURL, browser }) => {
  const tag = Date.now().toString(36);
  const f = await fixture(tag);

  // 1. Staff see ranked candidates with plain-language explanations, and notify both.
  await loginAs(context, "careers@academy.example", baseURL!);
  await page.goto(`/openings/${f.opening.id}`);
  const rows = page.getByRole("table", { name: "Ranked candidates with explanations" }).getByRole("row");
  await expect(rows).toHaveCount(3); // header + 2 candidates
  await expect(page.getByText("Matches 1 of 1 required skills.").first()).toBeVisible();
  await expect(page.getByText("Remote OK.").first()).toBeVisible();
  for (const g of [f.sharer, f.private_]) {
    await page.getByRole("button", { name: `Notify ${g.fullName} about this opening` }).click();
    await expect(page.getByRole("row").filter({ hasText: g.fullName }).getByText(/Notified|Suggested/)).toBeVisible();
  }

  // 2. Both graduates click "I'm interested" from their emailed link (separate browser contexts).
  for (const g of [f.sharer, f.private_]) {
    const n = await db.matchNotification.findFirstOrThrow({ where: { graduateId: g.id, openingId: f.opening.id } });
    const gctx = await browser.newContext();
    const gp = await gctx.newPage();
    await gp.goto(`${baseURL}/u/${signToken({ sub: g.id, v: g.profileTokenVersion, p: "match", ref: n.id, exp: exp() }, KEY)}`);
    await expect(gp.getByRole("heading", { name: f.opening.title })).toBeVisible();
    await gp.getByRole("button", { name: "I'm interested" }).click();
    await expect(gp.getByText("You said you're interested")).toBeVisible();
    await gctx.close();
  }

  // 3. Staff: the private graduate can't be referred (no share consent); the sharer moves through to Hired.
  await page.goto("/referrals");
  const privateCard = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: f.private_.fullName }) });
  await expect(privateCard.getByLabel(`Move ${f.private_.fullName} to`).locator("option", { hasText: "Referred" })).toHaveCount(0);
  for (const stage of ["Referred", "Interviewing", "Offer", "Hired"]) await moveCard(page, f.sharer.fullName, stage);

  // 4. The hire prompt is prefilled; confirming records a verified employment record.
  const dialog = page.getByRole("dialog", { name: "Confirm the employment record" });
  await expect(dialog.getByLabel("Role title")).toHaveValue(f.opening.title);
  await dialog.getByLabel("Start date").fill("2026-12-01");
  await dialog.getByRole("button", { name: "Confirm record" }).click();
  await expect(dialog.getByText("Employment record confirmed.")).toBeVisible();
  const grad = await db.graduate.findUniqueOrThrow({ where: { id: f.sharer.id }, include: { employmentRecords: { orderBy: { createdAt: "desc" } } } });
  expect(grad.currentStatus).toBe("employed_full_time");
  expect(grad.employmentRecords[0]).toMatchObject({ source: "referral_hire", companyId: f.company.id });
  expect(grad.employmentRecords[0]!.verifiedById).not.toBeNull();
  const transitions = await db.referralTransition.findMany({ where: { referral: { graduateId: f.sharer.id } }, orderBy: { at: "asc" } });
  expect(transitions.map((t) => t.toStatus)).toEqual(["suggested", "graduate_interested", "referred", "interviewing", "offer", "hired"]);

  // 5. Partner portal: sees the hired sharer's details; the private graduate never appears.
  const pctx = await browser.newContext();
  const pp = await pctx.newPage();
  await pp.goto(`${baseURL}/p/${signToken({ sub: f.contact.id, v: f.contact.tokenVersion, p: "partner", exp: exp() }, KEY)}`);
  await expect(pp.getByRole("heading", { name: f.company.canonicalName })).toBeVisible();
  const portal = await pp.locator("body").innerText();
  expect(portal).toContain(f.sharer.fullName);
  expect(portal).not.toContain(f.private_.fullName);
  await pctx.close();
});

test("referral cards can be dragged between stages with a mouse", async ({ page, context, baseURL }) => {
  const tag = `d${Date.now().toString(36)}`;
  const f = await fixture(tag);
  const ref = await db.referral.create({ data: { openingId: f.opening.id, graduateId: f.sharer.id, referredById: (await db.user.findFirstOrThrow({ where: { role: "CAREER_SERVICES" } })).id, status: "graduate_interested" } });
  await db.matchNotification.create({ data: { openingId: f.opening.id, graduateId: f.sharer.id, sentById: ref.referredById, score: 80, response: "interested", respondedAt: new Date() } });

  await loginAs(context, "careers@academy.example", baseURL!);
  await page.goto("/referrals");
  const handle = page.getByRole("button", { name: `Drag ${f.sharer.fullName}'s referral to another stage` });
  const target = page.getByRole("region", { name: /^Referred:/ });
  await handle.scrollIntoViewIfNeeded();
  const hb = (await handle.boundingBox())!;
  const tb = (await target.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 20, hb.y + 10, { steps: 5 });
  // Columns stretch to equal height, so dropping at the card's own height lands inside the target column.
  await page.mouse.move(tb.x + tb.width / 2, hb.y + hb.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(target.getByRole("link", { name: f.sharer.fullName })).toBeVisible();
  await expect.poll(async () => (await db.referral.findUniqueOrThrow({ where: { id: ref.id } })).status).toBe("referred");
});
