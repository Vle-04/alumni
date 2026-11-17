/** Checks the HTTP endpoints against docs/openapi.yaml (status codes, error bodies, content types). */
import { expect, test } from "@playwright/test";
import { signToken } from "../../src/domain/tokens/signedToken";
import { db, loginAs } from "./helpers";

const KEY = process.env.TOKEN_SIGNING_KEY!;

test("GET /api/reports/export: 401 without a session; CSV and PDF with one", async ({ request, context, baseURL, page }) => {
  const anon = await request.get("/api/reports/export?format=csv");
  expect(anon.status()).toBe(401);
  expect(await anon.json()).toEqual({ error: "unauthenticated" });

  await loginAs(context, "marketing@academy.example", baseURL!);
  const csv = await page.request.get("/api/reports/export?format=csv&count=employed_full_time");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["content-disposition"]).toBe('attachment; filename="alumni-outcomes.csv"');
  expect((await csv.text()).split("\n")[0]).toBe("section,group,measure,value");
  const pdf = await page.request.get("/api/reports/export?format=pdf");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
});

test("GET /api/graduates/{id}/export: 403 for Marketing, 404 for unknown id, JSON for Admin", async ({ browser, baseURL }) => {
  const g = await db.graduate.findFirstOrThrow({ where: { anonymizedAt: null } });
  const mk = await browser.newContext();
  await loginAs(mk, "marketing@academy.example", baseURL!);
  const forbidden = await mk.request.get(`${baseURL}/api/graduates/${g.id}/export`);
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toEqual({ error: "forbidden" });
  await mk.close();

  const admin = await browser.newContext();
  await loginAs(admin, "admin@academy.example", baseURL!);
  expect((await admin.request.get(`${baseURL}/api/graduates/nope/export`)).status()).toBe(404);
  const ok = await admin.request.get(`${baseURL}/api/graduates/${g.id}/export`);
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  for (const k of ["exportedAt", "profile", "skills", "employmentHistory", "consents", "checkIns", "jobSuggestions", "referrals"]) expect(body).toHaveProperty(k);
  await admin.close();
});

test("POST /api/unsubscribe/{token}: 400 for a bad token, 200 and idempotent for a good one", async ({ request }) => {
  const bad = await request.post("/api/unsubscribe/not-a-token", { form: { "List-Unsubscribe": "One-Click" } });
  expect(bad.status()).toBe(400);
  expect(await bad.json()).toEqual({ ok: false });
  const g = await db.graduate.findFirstOrThrow({ where: { anonymizedAt: null, unsubscribedAt: null } });
  const token = signToken({ sub: g.id, v: 0, p: "unsubscribe", exp: Math.floor(Date.now() / 1000) + 600 }, KEY);
  for (let i = 0; i < 2; i++) {
    const r = await request.post(`/api/unsubscribe/${token}`, { form: { "List-Unsubscribe": "One-Click" } });
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  }
  expect((await db.graduate.findUniqueOrThrow({ where: { id: g.id } })).unsubscribedAt).not.toBeNull();
});

test("GET /u/{token} and /p/{token}: 303 with HttpOnly cookie, or 303 to the expired page", async ({ request }) => {
  const g = await db.graduate.findFirstOrThrow({ where: { anonymizedAt: null } });
  const good = await request.get(`/u/${signToken({ sub: g.id, v: g.profileTokenVersion, p: "profile", exp: Math.floor(Date.now() / 1000) + 600 }, KEY)}`, { maxRedirects: 0 });
  expect(good.status()).toBe(303);
  expect(good.headers()["location"]).toMatch(/\/me$/);
  expect(good.headers()["set-cookie"]).toMatch(/alumni_grad=.*HttpOnly/i);
  expect(good.headers()["cache-control"]).toBe("no-store");
  const bad = await request.get("/u/garbage", { maxRedirects: 0 });
  expect(bad.status()).toBe(303);
  expect(bad.headers()["location"]).toMatch(/\/link-expired\?r=invalid$/);
  const p = await request.get("/p/garbage", { maxRedirects: 0 });
  expect(p.headers()["location"]).toMatch(/\/partner\?expired=invalid$/);
});
