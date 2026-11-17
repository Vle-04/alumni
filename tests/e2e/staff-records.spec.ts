import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("career services can add a graduate and record a job", async ({ page, context, baseURL }) => {
  await loginAs(context, "careers@academy.example", baseURL!);
  await page.goto("/graduates/new");
  const unique = Date.now();
  await page.getByLabel("Full name").fill(`E2E Person ${unique}`);
  await page.getByLabel("Preferred email").fill(`e2e${unique}@example.test`);
  await page.getByLabel("Cohort").selectOption({ label: "Web Dev 2025 Spring" });
  await page.getByLabel("Skill 1", { exact: true }).fill("JS");
  await page.getByRole("button", { name: "Create graduate" }).click();

  await expect(page.getByRole("heading", { name: `E2E Person ${unique}` })).toBeVisible();
  await expect(page.getByText("JavaScript · 3")).toBeVisible(); // "JS" resolved via synonym table

  await page.getByLabel("Status", { exact: true }).selectOption("employed_full_time");
  await page.getByLabel("Company", { exact: true }).fill("Northwind Software LLC");
  await page.getByLabel("Role title").fill("Junior Developer");
  await page.getByRole("button", { name: "Add record" }).click();
  await expect(page.getByText("Record added.")).toBeVisible();
  // "Northwind Software LLC" resolved to the existing partner company, not a new one.
  await expect(page.getByRole("list").getByText("Northwind Software", { exact: true })).toBeVisible();
});

test("shows row-level errors in the CSV import dry run", async ({ page, context, baseURL }) => {
  await loginAs(context, "careers@academy.example", baseURL!);
  await page.goto("/import");
  const csv = "full_name,email,cohort\nGood Row,good-row@example.test,Web Dev 2025 Spring\nBad Row,not-an-email,Web Dev 2025 Spring\n";
  await page.getByLabel("CSV file").setInputFiles({ name: "grads.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Preview (dry run)" }).click();
  await expect(page.getByText("Has errors")).toBeVisible();
  await expect(page.getByRole("button", { name: "Import 1 graduates" })).toBeEnabled();
});
