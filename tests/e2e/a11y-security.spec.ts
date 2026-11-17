/**
 * WCAG 2.2 AA automated checks (axe) on the main pages, plus: no Content-Security-Policy
 * violations (the strict nonce CSP must not break any page) and security headers are present.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signToken } from "../../src/domain/tokens/signedToken";
import { db, loginAs } from "./helpers";

const KEY = process.env.TOKEN_SIGNING_KEY!;
const exp = () => Math.floor(Date.now() / 1000) + 3600;

function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to (execute|load)/i.test(m.text())) violations.push(m.text()); });
  return violations;
}

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× e.g. ${v.nodes[0]?.target.join(" ")}`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

test.describe("staff pages", () => {
  test.beforeEach(async ({ context, baseURL }) => loginAs(context, "admin@academy.example", baseURL!));
  for (const path of ["/dashboard", "/graduates", "/openings", "/referrals", "/referrals?view=table", "/reports", "/surveys", "/import", "/companies", "/admin/users", "/admin/skills", "/admin/settings"]) {
    test(`a11y + CSP: ${path}`, async ({ page }) => {
      const csp = watchCsp(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await axe(page, path);
      expect(csp).toEqual([]);
    });
  }
  test("a11y + CSP: graduate detail, opening detail", async ({ page }) => {
    const csp = watchCsp(page);
    const g = await db.graduate.findFirstOrThrow({ where: { anonymizedAt: null, employmentRecords: { some: {} } } });
    const o = await db.opening.findFirstOrThrow({ where: { status: "open" } });
    for (const path of [`/graduates/${g.id}`, `/openings/${o.id}`]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await axe(page, path);
    }
    expect(csp).toEqual([]);
  });
});

test("a11y + CSP: login, privacy, link-expired", async ({ page }) => {
  const csp = watchCsp(page);
  for (const path of ["/login", "/privacy", "/link-expired?r=expired"]) {
    await page.goto(path);
    await axe(page, path);
  }
  expect(csp).toEqual([]);
});

test("a11y + CSP: graduate self-update, survey, match and partner portal", async ({ page, browser, baseURL }) => {
  const csp = watchCsp(page);
  const n = await db.matchNotification.findFirstOrThrow({ where: { graduate: { anonymizedAt: null }, opening: { status: "open" } }, include: { graduate: true } });
  const g = n.graduate;
  await page.goto(`/u/${signToken({ sub: g.id, v: g.profileTokenVersion, p: "profile", exp: exp() }, KEY)}`);
  await axe(page, "/me");
  await page.goto(`/me/matches/${n.id}`);
  await axe(page, "/me/matches");
  const s = await db.surveyInstance.findFirst({ where: { graduateId: g.id } });
  if (s) { await page.goto(`/me/survey/${s.id}`); await axe(page, "/me/survey"); }
  expect(csp).toEqual([]);

  const contact = await db.partnerContact.findFirstOrThrow();
  const pctx = await browser.newContext();
  const pp = await pctx.newPage();
  const pcsp = watchCsp(pp);
  await pp.goto(`${baseURL}/p/${signToken({ sub: contact.id, v: contact.tokenVersion, p: "partner", exp: exp() }, KEY)}`);
  await axe(pp, "/partner");
  expect(pcsp).toEqual([]);
  await pctx.close();
});

test("CSRF: cross-site or Origin-less state-changing requests are refused by the app", async ({ request, baseURL }) => {
  expect((await request.post("/graduates", { headers: { origin: "https://evil.example", "next-action": "x" }, data: "" })).status()).toBe(403);
  expect((await request.post("/reports", { headers: { "next-action": "x" }, data: "" })).status()).toBe(403);
  expect((await request.post("/graduates", { headers: { origin: baseURL!, "next-action": "x" }, data: "" })).status()).not.toBe(403);
});

test("security headers", async ({ request }) => {
  const r = await request.get("/login");
  const h = r.headers();
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(h["content-security-policy"]).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["x-powered-by"]).toBeUndefined();
});

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });
  test("a11y in dark mode: report, dashboard, referral board, self-update", async ({ page, context, baseURL }) => {
    await loginAs(context, "admin@academy.example", baseURL!);
    for (const path of ["/reports", "/dashboard", "/referrals"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await axe(page, `${path} (dark)`);
    }
    const g = await db.graduate.findFirstOrThrow({ where: { anonymizedAt: null, employmentRecords: { some: {} } } });
    await page.goto(`/u/${signToken({ sub: g.id, v: g.profileTokenVersion, p: "profile", exp: exp() }, KEY)}`);
    await axe(page, "/me (dark)");
  });
});
