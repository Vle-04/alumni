import { describe, expect, it } from "vitest";
import { companySimilarity, findSimilarCompanies, normalizeCompanyName } from "./normalize";

describe("normalizeCompanyName", () => {
  it.each([
    ["Google LLC", "google"],
    ["Google, Inc.", "google"],
    ["  The Coca-Cola Company ", "coca cola"],
    ["Société Générale S.A.", "societe generale"],
    ["Procter & Gamble Co.", "procter and gamble"],
    ["LLC", "llc"],
    ["", ""],
  ])("%s → %s", (input, expected) => expect(normalizeCompanyName(input)).toBe(expected));
});

describe("companySimilarity", () => {
  it("treats legal-form variants as identical", () => {
    expect(companySimilarity("Google", "Google LLC")).toBe(1);
  });
  it("scores typos high and unrelated names low", () => {
    expect(companySimilarity("Microsoft", "Microsfot")).toBeGreaterThan(0.6);
    expect(companySimilarity("Microsoft", "Amazon")).toBeLessThan(0.2);
  });
  it("suggests regional/division variants via token containment", () => {
    expect(companySimilarity("Picsart", "PicsArt Armenia")).toBe(0.85);
    expect(companySimilarity("ABC", "ABC Bank")).toBeLessThan(0.82); // too short to trust
    expect(companySimilarity("Armenia Bank", "Picsart Armenia")).toBeLessThan(0.82); // not a prefix
  });
  it("handles empty and one-character input", () => {
    expect(companySimilarity("", "x")).toBe(0);
    expect(companySimilarity("a", "b")).toBe(0);
  });
});

describe("findSimilarCompanies", () => {
  const candidates = [
    { id: "c2", names: ["Google"] },
    { id: "c1", names: ["Alphabet", "Google Armenia"] },
    { id: "c3", names: ["Picsart"] },
  ];
  it("returns matches above threshold, best first", () => {
    const m = findSimilarCompanies("Google LLC", candidates, 0.7);
    expect(m[0]).toEqual({ id: "c2", similarity: 1 });
    expect(m.map((x) => x.id)).not.toContain("c3");
  });
  it("breaks ties by id deterministically", () => {
    const m = findSimilarCompanies("Acme", [{ id: "b", names: ["Acme Inc"] }, { id: "a", names: ["ACME"] }]);
    expect(m.map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("returns nothing when no candidate is close", () => {
    expect(findSimilarCompanies("Zzyzx Labs", candidates)).toEqual([]);
  });
});
