/**
 * Acceptance: "A Marketing user cannot see any individual's name or email anywhere."
 * Every exported service function is called as a LEADERSHIP (marketing) user and must throw
 * ForbiddenError — unless it is explicitly listed below as aggregate-only or as an internal
 * helper that is never exposed to a request. Adding a new export forces a decision here.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/errors";
import { resetDb, staff } from "./helpers";
import * as graduates from "@/server/services/graduates";
import * as employment from "@/server/services/employment";
import * as companies from "@/server/services/companies";
import * as cohorts from "@/server/services/cohorts";
import * as users from "@/server/services/users";
import * as importSvc from "@/server/services/import";
import * as surveys from "@/server/services/surveys";
import * as selfService from "@/server/services/self-service";

const modules: Record<string, Record<string, unknown>> = { graduates, employment, companies, cohorts, users, import: importSvc, surveys, selfService };

/** Functions Leadership MAY call: they return aggregates only. */
export const AGGREGATE_ONLY = new Set(["cohorts.listCohorts", "cohorts.listPrograms"]);
/** Internal helpers that take a db handle (not a request context) and are only called by other services. */
export const INTERNAL = new Set([
  "graduates.buildGraduateWhere",
  "employment.appendEmploymentRecord",
  "employment.refreshCurrentStatus",
  "companies.resolveCompany",
  // System jobs (run by the worker with a system context, never from a request).
  "surveys.scheduleSurveysForGraduates",
  "surveys.scheduleSurveysForCohort",
  "surveys.runSurveyTick",
  // Public, token-authenticated entry points: they act only on the graduate the token names
  // and return nothing about anyone (requestNewLink always answers "ok").
  "selfService.requestNewLink",
  "selfService.unsubscribeByToken",
  "selfService.consumeOtp",
]);

describe("Leadership/Marketing cannot reach individual-level services", async () => {
  let ctx: Awaited<ReturnType<typeof staff>>;
  beforeAll(async () => {
    await resetDb();
    ctx = await staff("LEADERSHIP");
  });

  const cases: [string, (...a: unknown[]) => Promise<unknown>][] = [];
  for (const [mod, exports] of Object.entries(modules)) {
    for (const [name, fn] of Object.entries(exports)) {
      const key = `${mod}.${name}`;
      if (typeof fn !== "function" || AGGREGATE_ONLY.has(key) || INTERNAL.has(key)) continue;
      cases.push([key, fn as (...a: unknown[]) => Promise<unknown>]);
    }
  }

  it("found service functions to check", () => expect(cases.length).toBeGreaterThan(15));

  it.each(cases)("%s → Forbidden", async (_key, fn) => {
    await expect(fn(ctx, "any-id", {}, "x")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("aggregate-only functions return no personal fields", async () => {
    const list = await cohorts.listCohorts(ctx);
    expect(JSON.stringify(list)).not.toMatch(/fullName|email/i);
  });
});
