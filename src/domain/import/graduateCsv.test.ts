import { describe, expect, it } from "vitest";
import { parseSkills, validateGraduateRows } from "./graduateCsv";

const ctx = { cohortNames: ["Web Dev 2025 Spring"], emailExists: (e: string) => e === "existing@example.com" };
const headers = ["full_name", "email", "cohort", "skills", "current_status", "company"];
const row = (o: Record<string, string>) => ({ full_name: "Ani Petrosyan", email: "ani@example.com", cohort: "web dev 2025 spring", ...o });

describe("parseSkills", () => {
  it("parses names with levels and defaults to 3", () => {
    expect(parseSkills("JavaScript:4; React ; SQL:5").skills).toEqual([
      { name: "JavaScript", level: 4 },
      { name: "React", level: 3 },
      { name: "SQL", level: 5 },
    ]);
  });
  it("rejects out-of-range levels", () => expect(parseSkills("JS:9").error).toBeTruthy());
  it("deduplicates case-insensitively", () => expect(parseSkills("JS:2;js:4").skills).toHaveLength(1));
  it("handles empty input", () => expect(parseSkills("").skills).toEqual([]));
});

describe("validateGraduateRows", () => {
  it("reports missing required columns without validating rows", () => {
    const p = validateGraduateRows(["full_name"], [{ full_name: "x" }], ctx);
    expect(p.missingColumns).toEqual(["email", "cohort"]);
    expect(p.rows).toEqual([]);
  });

  it("accepts a valid row and normalizes email + cohort name", () => {
    const p = validateGraduateRows(headers, [row({ email: " Ani@Example.com " })], ctx);
    expect(p.rows[0]?.outcome).toBe("new");
    expect(p.rows[0]?.data?.email).toBe("ani@example.com");
    expect(p.rows[0]?.data?.cohortName).toBe("Web Dev 2025 Spring");
  });

  it("returns row-level field errors", () => {
    const p = validateGraduateRows(headers, [row({ email: "not-an-email", cohort: "Nope" })], ctx);
    expect(p.rows[0]?.outcome).toBe("invalid");
    expect(p.rows[0]?.errors.map((e) => e.field)).toContain("email");
  });

  it("flags unknown cohorts", () => {
    const p = validateGraduateRows(headers, [row({ cohort: "Nope" })], ctx);
    expect(p.rows[0]?.errors).toEqual([{ field: "cohort", message: expect.stringContaining("does not exist") }]);
  });

  it("detects duplicates within the file and against existing graduates", () => {
    const p = validateGraduateRows(headers, [row({}), row({ email: "ANI@example.com" }), row({ email: "existing@example.com" })], ctx);
    expect(p.rows.map((r) => r.outcome)).toEqual(["new", "duplicate_in_file", "duplicate_existing"]);
    expect(p.counts).toMatchObject({ new: 1, duplicate_in_file: 1, duplicate_existing: 1 });
  });

  it("rejects company info for non-employed statuses", () => {
    const p = validateGraduateRows(headers, [row({ current_status: "searching", company: "Acme" })], ctx);
    expect(p.rows[0]?.outcome).toBe("invalid");
  });

  it("validates yes/no, dates, time zones and role categories", () => {
    const p = validateGraduateRows(
      [...headers, "open_to_relocate", "start_date", "timezone", "preferred_roles"],
      [row({ open_to_relocate: "maybe", start_date: "01/02/2025", timezone: "Mars/Base", preferred_roles: "frontend; astronaut" })],
      ctx,
    );
    const fields = p.rows[0]?.errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(["open_to_relocate", "start_date", "timezone", "preferred_roles"]));
  });

  it("lists unknown columns (e.g. a photo or gender column is ignored, never imported)", () => {
    const p = validateGraduateRows([...headers, "gender", "photo"], [row({ gender: "x", photo: "y" })], ctx);
    expect(p.unknownColumns).toEqual(["gender", "photo"]);
    expect(p.rows[0]?.data).not.toHaveProperty("gender");
  });
});
