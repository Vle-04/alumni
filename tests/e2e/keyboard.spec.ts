/**
 * Audit item 10: keyboard-only navigation works on all main pages.
 * For each page: the first Tab lands on the skip link, Tab reaches EVERY visible interactive
 * element, and every focused element shows a visible focus indicator. Key tasks are completed
 * with the keyboard alone.
 */
import { expect, test, type Page } from "@playwright/test";
import { signToken } from "../../src/domain/tokens/signedToken";
import { db, loginAs } from "./helpers";

const KEY = process.env.TOKEN_SIGNING_KEY!;
const exp = () => Math.floor(Date.now() / 1000) + 3600;

async function tabThrough(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  const total = await page.evaluate(() => {
    const sel = 'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
    const els = [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      // Content of a closed <details> has a layout box in Chrome but is not focusable until opened.
      const inClosedDetails = !!el.closest("details:not([open])") && !(el.tagName === "SUMMARY" && el.parentElement?.tagName === "DETAILS");
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && !el.closest("[inert]") && !el.classList.contains("skip-link") && !inClosedDetails;
    });
    els.forEach((el, i) => el.setAttribute("data-kb", String(i)));
    return els.length;
  });
  // Like a keyboard user arriving on a freshly loaded page: focus starts at the top of the document.
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.classList.contains("skip-link")), `${label}: first Tab should reach the skip link`).toBe(true);

  const reached = new Set<string>();
  const noIndicator: string[] = [];
  let first: string | null = null;
  let prev: string | null = null;
  for (let i = 0; i < total * 3 + 10; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const st = getComputedStyle(el);
      const visible = (st.outlineStyle !== "none" && parseFloat(st.outlineWidth) > 0) || st.boxShadow !== "none";
      // Radio groups are one Tab stop (arrow keys move inside the group) — mark the whole group reached.
      if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
        document.querySelectorAll<HTMLElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]`).forEach((r) => r.setAttribute("data-kb-group", "reached"));
      }
      return { id: el.getAttribute("data-kb"), visible, desc: `${el.tagName.toLowerCase()}[type=${el.getAttribute("type")}] #${el.id} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}"` };
    });
    if (info?.id) {
      // Stop once focus wraps back to the first element (date fields take several Tabs, so repeats are fine).
      if (info.id === first && prev !== first && reached.size > 1) break;
      first ??= info.id;
      prev = info.id;
      reached.add(info.id);
      if (!info.visible) noIndicator.push(info.desc);
    }
  }
  const missed = await page.evaluate((ids) => [...document.querySelectorAll<HTMLElement>("[data-kb]")].filter((el) => !ids.includes(el.getAttribute("data-kb")!) && el.getAttribute("data-kb-group") !== "reached").map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}"`), [...reached]);
  expect(missed, `${label}: not reachable by Tab`).toEqual([]);
  expect(noIndicator, `${label}: no visible focus indicator`).toEqual([]);
}

test.describe("staff pages are fully keyboard-navigable", () => {
  test.beforeEach(async ({ context, baseURL }) => loginAs(context, "admin@academy.example", baseURL!));
  for (const path of ["/dashboard", "/graduates", "/cohorts", "/openings", "/referrals?view=table", "/reports", "/surveys", "/import", "/companies", "/admin/users", "/admin/settings"]) {
    test(path, async ({ page }) => {
      await page.goto(path);
      await tabThrough(page, path);
    });
  }
  test("graduate and opening detail pages", async ({ page }) => {
    const g = await db.graduate.findFirstOrThrow({ where: { anonymizedAt: null, employmentRecords: { some: {} } } });
    const o = await db.opening.findFirstOrThrow({ where: { status: "open" } });
    for (const path of [`/graduates/${g.id}`, `/openings/${o.id}`]) {
      await page.goto(path);
      await tabThrough(page, path);
    }
  });

  /**
   * Root cause of the CI timeout: Linux Chromium commits a closed <select> on ArrowDown (macOS doesn't),
   * so the card had already moved and the later selectOption("Interviewing") waited for an option that
   * no longer existed. Fix: the test creates its own card (no dependence on seed data or earlier tests)
   * and uses type-ahead, which behaves identically on both platforms.
   */
  test("referral board: a card can be moved with the keyboard only", async ({ page }) => {
    const tag = `kb${Date.now().toString(36)}`;
    const staff = await db.user.findFirstOrThrow({ where: { role: "CAREER_SERVICES" } });
    const company = await db.company.findFirstOrThrow({ where: { isPartner: true } });
    const opening = await db.opening.create({ data: { companyId: company.id, title: `Keyboard test ${tag}`, description: "e2e", roleCategory: "frontend", remoteMode: "remote", status: "open" } });
    const graduate = await db.graduate.create({ data: { cohortId: (await db.cohort.findFirstOrThrow()).id, fullName: `Keyboard Grad ${tag}`, currentStatus: "searching", searchingSince: new Date(),
      consents: { create: [{ purpose: "job_matching", policyVersion: "test", source: "e2e" }, { purpose: "share_with_partners", policyVersion: "test", source: "e2e" }] } } });
    await db.matchNotification.create({ data: { openingId: opening.id, graduateId: graduate.id, sentById: staff.id, score: 80, response: "interested", respondedAt: new Date() } });
    const r = await db.referral.create({ data: { openingId: opening.id, graduateId: graduate.id, referredById: staff.id, status: "referred" } });

    await page.goto("/referrals");
    const select = page.getByLabel(`Move ${graduate.fullName} to`);
    await select.focus();
    await page.keyboard.type("Int"); // type-ahead picks "Interviewing" and commits — same on macOS and Linux
    await expect(page.getByRole("region", { name: /^Interviewing:/ }).getByRole("link", { name: graduate.fullName })).toBeVisible();
    await expect.poll(async () => (await db.referral.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("interviewing");
  });
});

test("login, privacy and expired-link pages", async ({ page }) => {
  for (const path of ["/login", "/privacy", "/link-expired?r=expired"]) {
    await page.goto(path);
    await tabThrough(page, path);
  }
});

test("graduate pages are keyboard-navigable, and a survey can be answered with the keyboard only", async ({ page }) => {
  const s = await db.surveyInstance.findFirstOrThrow({ where: { status: "sent", graduate: { anonymizedAt: null, currentStatus: { not: "unknown" } } }, include: { graduate: true } });
  await page.goto(`/u/${signToken({ sub: s.graduateId, v: s.graduate.profileTokenVersion, p: "profile", exp: exp() }, KEY)}`);
  await tabThrough(page, "/me");
  await page.goto(`/me/survey/${s.id}`);
  await tabThrough(page, "/me/survey");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.textContent?.includes("Yes, nothing changed"))) break;
  }
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();
});

test("partner portal is keyboard-navigable", async ({ page }) => {
  const c = await db.partnerContact.findFirstOrThrow();
  await page.goto(`/p/${signToken({ sub: c.id, v: c.tokenVersion, p: "partner", exp: exp() }, KEY)}`);
  await tabThrough(page, "/partner");
});
