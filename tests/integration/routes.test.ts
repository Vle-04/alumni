/** AUDIT 18: route handlers reject invalid input at the route (before any service code runs). */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as reportExport } from "@/app/api/reports/export/route";
import { GET as gradExport } from "@/app/api/graduates/[id]/export/route";
import { POST as unsubscribe } from "@/app/api/unsubscribe/[token]/route";
import { GET as gradLink } from "@/app/u/[token]/route";

const get = (url: string) => new NextRequest(`http://localhost:3000${url}`, { headers: { "x-alumni-client-ip": "198.51.100.1" } });
const none = { params: Promise.resolve({}) };

describe("reports export route rejects invalid filters with 422", () => {
  it.each([
    ["?from=garbage", "malformed month"],
    ["?from=2025-13", "month out of range"],
    ["?count=hacked", "unknown employed status"],
    ["?evil=1", "unknown parameter"],
    ["?format=xlsx", "unknown format"],
    ["?cohortId=" + encodeURIComponent("x'; drop"), "bad id"],
    ["?inField=yes", "bad flag"],
  ])("%s (%s)", async (qs) => {
    const r = await reportExport(get(`/api/reports/export${qs}`), none);
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: "validation" });
  });

  it("valid filters pass validation and reach authentication (the 200 path is covered in e2e api-contract)", async () => {
    // Outside a real request, Auth.js can't read cookies — reaching that point proves validation passed.
    await expect(reportExport(get("/api/reports/export?format=pdf&from=2025-01&to=2025-12&count=employed_full_time&count=internship&inField=1"), none)).rejects.toThrow(/outside a request scope/);
  });
});

describe("other routes", () => {
  it("graduate export: bad id → 422", async () => {
    expect((await gradExport(get("/api/graduates/x/export"), { params: Promise.resolve({ id: "../../etc" }) })).status).toBe(422);
  });
  it("unsubscribe: unexpected body field → 400", async () => {
    const req = new NextRequest("http://localhost:3000/api/unsubscribe/t", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click&extra=1" });
    expect((await unsubscribe(req, { params: Promise.resolve({ token: "t" }) })).status).toBe(400);
  });
  it("personal link: oversized token → treated as an invalid link", async () => {
    const r = await gradLink(get("/u/x"), { params: Promise.resolve({ token: "x".repeat(5000) }) });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toMatch(/link-expired\?r=invalid/);
  });
});
