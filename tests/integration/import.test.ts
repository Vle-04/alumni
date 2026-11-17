import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { ValidationError } from "@/server/errors";
import { commitImport, previewImport } from "@/server/services/import";
import { makeCohort, makeGraduate, resetDb, staff } from "./helpers";

const csv = (cohort: string) => [
  "full_name,email,cohort,skills,current_status,company,role_title,consent_outcomes_reporting",
  `Ani Petrosyan,ani@example.com,${cohort},JavaScript:4;React:3,employed_full_time,Acme LLC,Junior Dev,yes`,
  `Duplicate Ani,ANI@example.com,${cohort},,,,,`,
  `Existing Person,existing@example.com,${cohort},,,,,`,
  `Bad Row,not-an-email,${cohort},,,,,`,
  `Gor Hakobyan,gor@example.com,${cohort},Python:5,searching,,,no`,
].join("\n");

describe("CSV import", () => {
  let cs: Awaited<ReturnType<typeof staff>>;
  let cohortName: string;
  beforeEach(async () => {
    await resetDb();
    cs = await staff("CAREER_SERVICES");
    const c = await makeCohort({ name: "Web 2025" });
    cohortName = c.name;
    await makeGraduate(c.id, { email: "existing@example.com" });
  });

  it("previews with row-level outcomes and no contact data in the response", async () => {
    const p = await previewImport(cs, "grads.csv", csv(cohortName));
    expect(p.rows.map((r) => r.outcome)).toEqual(["new", "duplicate_in_file", "duplicate_existing", "invalid", "new"]);
    expect(JSON.stringify(p)).not.toContain("@example.com");
    expect(await prisma.graduate.count()).toBe(1); // dry run creates nothing
  });

  it("commits only new rows, with consents and initial employment records", async () => {
    const text = csv(cohortName);
    const p = await previewImport(cs, "grads.csv", text);
    const summary = await commitImport(cs, p.batchId, text);
    expect(summary).toEqual({ created: 2, skippedDuplicates: 2, invalid: 1 });
    const ani = await prisma.graduate.findFirstOrThrow({ where: { fullName: "Ani Petrosyan" }, include: { consents: true, employmentRecords: { include: { company: true } } } });
    expect(ani.currentStatus).toBe("employed_full_time");
    expect(ani.employmentRecords[0]?.source).toBe("csv_import");
    expect(ani.employmentRecords[0]?.company?.canonicalName).toBe("Acme LLC");
    expect(ani.consents.map((c) => c.purpose)).toEqual(["outcomes_reporting"]);
  });

  it("refuses to commit if the file changed after preview, or twice", async () => {
    const text = csv(cohortName);
    const p = await previewImport(cs, "grads.csv", text);
    await expect(commitImport(cs, p.batchId, text + "\nX Y,xy@example.com," + cohortName)).rejects.toBeInstanceOf(ValidationError);
    await commitImport(cs, p.batchId, text);
    await expect(commitImport(cs, p.batchId, text)).rejects.toThrow(/not found/);
  });
});
