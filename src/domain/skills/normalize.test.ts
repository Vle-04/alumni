import { describe, expect, it } from "vitest";
import { buildSkillDictionary, resolveSkill, skillKey } from "./normalize";

const dict = buildSkillDictionary(
  [
    { id: "js", canonicalName: "JavaScript" },
    { id: "pg", canonicalName: "PostgreSQL" },
  ],
  [
    { skillId: "js", alias: "JS" },
    { skillId: "pg", alias: "postgres" },
    // A synonym must never shadow another canonical name.
    { skillId: "pg", alias: "javascript" },
  ],
);

describe("skill synonyms", () => {
  it("resolves canonical names case-insensitively", () => expect(resolveSkill(dict, " javascript ")).toBe("js"));
  it("resolves synonyms", () => {
    expect(resolveSkill(dict, "JS")).toBe("js");
    expect(resolveSkill(dict, "Postgres")).toBe("pg");
  });
  it("does not let an alias override a canonical name", () => expect(resolveSkill(dict, "JavaScript")).toBe("js"));
  it("returns null for unknown skills", () => expect(resolveSkill(dict, "COBOL")).toBeNull());
  it("collapses whitespace", () => expect(skillKey("  Machine   Learning ")).toBe("machine learning"));
});
