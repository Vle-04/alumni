import { describe, expect, it } from "vitest";
import { can, INDIVIDUAL_LEVEL_PERMISSIONS, PERMISSIONS, permissionsFor } from "./permissions";

describe("RBAC matrix", () => {
  it("never grants Leadership/Marketing any individual-level permission", () => {
    for (const p of INDIVIDUAL_LEVEL_PERMISSIONS) expect(can("LEADERSHIP", p)).toBe(false);
  });

  it("gives Leadership aggregate reports only", () => {
    expect(permissionsFor("LEADERSHIP").sort()).toEqual(["cohort:read_aggregate", "report:export", "report:read"]);
  });

  it("gives Admin every permission", () => {
    for (const p of PERMISSIONS) expect(can("ADMIN", p)).toBe(true);
  });

  it("lets Career Services see contact info but not manage users, settings or delete graduates", () => {
    expect(can("CAREER_SERVICES", "graduate:read_contact")).toBe(true);
    expect(can("CAREER_SERVICES", "user:manage")).toBe(false);
    expect(can("CAREER_SERVICES", "settings:manage")).toBe(false);
    expect(can("CAREER_SERVICES", "graduate:delete")).toBe(false);
  });
});
