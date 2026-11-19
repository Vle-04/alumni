/**
 * Staff sign in with email + password and land on the main page. No sign-up exists.
 * (Google sign-in rules are covered in tests/integration/staff-auth.test.ts.)
 */
import { expect, test } from "@playwright/test";

const PASSWORD = process.env.SEED_STAFF_PASSWORD || "alumni-dev-password";

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("admin signs in with email + password and lands on the main page", async ({ page }) => {
  await signIn(page, "admin@academy.example", PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Staff users" })).toBeVisible();
  // Already signed in → /login goes straight to the main page.
  await page.goto("/login");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("Leadership lands on their main page (reports)", async ({ page }) => {
  await signIn(page, "marketing@academy.example", PASSWORD);
  await expect(page).toHaveURL(/\/reports$/);
});

test("a wrong password shows one generic error and stays on the login page", async ({ page }) => {
  await signIn(page, "careers2@academy.example", "not-the-password");
  await expect(page.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/sign up|create account/i)).toHaveCount(0);
});

test("forgot-password and expired-link pages", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await page.getByLabel("Email").fill("nobody@academy.example");
  await page.getByRole("button", { name: "Email me a reset link" }).click();
  await expect(page.getByText("a link to reset the password is on its way")).toBeVisible();
  await page.goto("/login/reset?token=not-a-real-token");
  await expect(page.getByText("This link is invalid or has expired.")).toBeVisible();
});
