/**
 * Acceptance: the outcomes report shows the employment rate with response rate and unknowns,
 * median time to first job and top employers, suppresses small groups, and exports are audited.
 */
import { expect, test } from "@playwright/test";
import { db, loginAs } from "./helpers";

test.describe("Marketing / Leadership", () => {
  test.beforeEach(async ({ context, baseURL }) => loginAs(context, "marketing@academy.example", baseURL!));

  test("sees the full report with honest caveats and no individuals", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Outcomes report" })).toBeVisible();
    const tile6 = page.getByRole("group", { name: "Employed at 6 months" });
    await expect(tile6.getByText(/Response rate/)).toBeVisible();
    await expect(tile6.getByText(/If every unknown were not employed/)).toBeVisible();
    await expect(page.getByText("Median time to first job")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Top employers/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Employed by month after graduation/ })).toBeVisible();
    // AUDIT 9: role and salary-band distributions, cohort trend, data freshness.
    await expect(page.getByRole("heading", { name: /Roles of employed graduates/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Monthly salary bands/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Cohort comparison/ })).toBeVisible();
    await expect(page.getByRole("group", { name: "Data freshness" })).toContainText(/updated in the last 90 days/);
    for (const region of [/Roles of employed graduates/, /Monthly salary bands/]) {
      await page.getByRole("region", { name: region }).getByText("Show data table").click();
    }
    await expect(page.getByRole("table", { name: "Roles" }).getByRole("row")).not.toHaveCount(1);
    await expect(page.getByRole("table", { name: "Salary bands" }).getByRole("row")).not.toHaveCount(1);

    // Every chart has a table view
    await page.getByRole("region", { name: /Cohort comparison/ }).getByText("Show data table").click();
    await expect(page.getByRole("table", { name: "Cohort comparison" })).toBeVisible();

    // Definitions are available as tooltips (keyboard focus works too)
    const info = page.getByRole("button", { name: "What is “Employed at 6 months”?" });
    await info.hover();
    await expect(page.getByRole("tooltip")).toContainText("÷ graduates whose status we know");
    await page.mouse.move(0, 0);
    await page.keyboard.press("Escape");
    // Keyboard: Tab onto the trigger opens the same tooltip.
    await page.getByRole("link", { name: "Download CSV" }).focus();
    for (let i = 0; i < 40 && !(await info.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(page.getByRole("tooltip")).toContainText("÷ graduates whose status we know");

    const names = (await db.graduate.findMany({ select: { fullName: true } })).map((g) => g.fullName);
    const text = await page.locator("body").innerText();
    expect(names.filter((n) => text.includes(n))).toEqual([]);
  });

  test("CSV and PNG exports work and are written to the audit log", async ({ page }) => {
    const user = await db.user.findUniqueOrThrow({ where: { email: "marketing@academy.example" } });
    const before = await db.auditLog.count({ where: { action: "report.export", actorId: user.id } });
    await page.goto("/reports");

    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download CSV" }).click()]);
    expect(csv.suggestedFilename()).toBe("alumni-outcomes.csv");

    const [png] = await Promise.all([page.waitForEvent("download"), page.getByRole("region", { name: /Cohort comparison/ }).getByRole("button", { name: "Download PNG" }).click()]);
    expect(png.suggestedFilename()).toBe("cohort-comparison.png");

    await expect.poll(() => db.auditLog.count({ where: { action: "report.export", actorId: user.id } })).toBe(before + 2);
  });

  test("filters that leave fewer than 5 graduates show nothing", async ({ page }) => {
    await page.goto("/reports?from=2030-01&to=2030-12");
    await expect(page.getByText(/Fewer than 5 graduates match these filters/)).toBeVisible();
  });
});

test("Career Services sees the needs-attention queue", async ({ page, context, baseURL }) => {
  await loginAs(context, "careers@academy.example", baseURL!);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  for (const q of ["Searching long, no referral", "Referrals stuck in one stage", "Bounced surveys", "New openings with no matches", "Stale records"]) {
    await expect(page.getByRole("heading", { name: new RegExp(q) })).toBeVisible();
  }
});
