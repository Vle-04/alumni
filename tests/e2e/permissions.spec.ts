/**
 * Acceptance: "A Marketing user cannot see any individual's name or email anywhere."
 */
import { expect, test } from "@playwright/test";
import { db, loginAs } from "./helpers";

const INDIVIDUAL_PAGES = ["/dashboard", "/graduates", "/graduates?stale=1", "/graduates/new", "/import", "/companies", "/cohorts", "/admin/users"];

test.describe("Marketing / Leadership user", () => {
  test.beforeEach(async ({ context, baseURL }) => loginAs(context, "marketing@academy.example", baseURL!));

  test("is redirected away from every individual-level page", async ({ page }) => {
    const grad = await db.graduate.findFirstOrThrow();
    for (const path of [...INDIVIDUAL_PAGES, `/graduates/${grad.id}`, `/graduates/${grad.id}/edit`]) {
      await page.goto(path);
      await expect(page, `${path} should be forbidden`).toHaveURL(/\/forbidden$/);
    }
  });

  test("never sees any graduate name on pages they can open", async ({ page }) => {
    const names = (await db.graduate.findMany({ select: { fullName: true } })).map((g) => g.fullName);
    for (const path of ["/", "/reports"]) {
      await page.goto(path);
      const text = await page.locator("body").innerText();
      expect(names.filter((n) => text.includes(n))).toEqual([]);
      expect(text).not.toMatch(/@mail\.example/);
    }
  });

  test("does not see individual-level navigation", async ({ page }) => {
    await page.goto("/reports");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Graduates" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Outcomes report" })).toBeVisible();
  });
});

test("unauthenticated visitors are sent to sign in", async ({ page }) => {
  await page.goto("/graduates");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeVisible();
});

test.describe("Career Services user", () => {
  test.beforeEach(async ({ context, baseURL }) => loginAs(context, "careers@academy.example", baseURL!));

  test("can open records; viewing contact data is audited", async ({ page }) => {
    const grad = await db.graduate.findFirstOrThrow({ where: { emailEnc: { not: null } } });
    const before = await db.auditLog.count({ where: { action: "contact.read", entityId: grad.id } });
    await page.goto(`/graduates/${grad.id}`);
    await expect(page.getByRole("heading", { name: "Employment timeline" })).toBeVisible();
    await page.getByRole("button", { name: "Show contact details" }).click();
    await expect(page.getByText(/@mail\.example/)).toBeVisible();
    expect(await db.auditLog.count({ where: { action: "contact.read", entityId: grad.id } })).toBe(before + 1);
  });

  test("cannot manage staff users", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/forbidden$/);
  });
});
