import { describe, expect, it } from "vitest";
import { auditDiff, scrubAuditPayload } from "./redact";

describe("auditDiff", () => {
  it("records only changed fields", () => {
    expect(auditDiff({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ b: { before: 2, after: 3 } });
  });
  it("redacts contact fields", () => {
    const d = auditDiff({ email: "old@x.com" }, { email: "new@x.com" });
    expect(d).toEqual({ email: { changed: true } });
    expect(JSON.stringify(d)).not.toContain("@x.com");
  });
  it("handles creation and deletion", () => {
    expect(auditDiff(null, { a: 1 })).toEqual({ a: { before: null, after: 1 } });
    expect(auditDiff({ a: 1 }, null)).toEqual({ a: { before: 1, after: null } });
  });
  it("compares dates by value and ignores timestamps", () => {
    expect(auditDiff({ d: new Date("2024-01-01"), updatedAt: 1 }, { d: new Date("2024-01-01"), updatedAt: 2 })).toEqual({});
  });
});

describe("personal fields and scrubbing", () => {
  it("logs name changes only as changed", () => {
    expect(auditDiff({ fullName: "Ani P" }, { fullName: "Ani Q" })).toEqual({ fullName: { changed: true } });
  });
  it("scrubs stored payloads by key and by value", () => {
    const out = scrubAuditPayload({ changes: { fullName: { before: "Zeb Q", after: "Zebulon Q" }, status: { before: "a", after: "b" } }, meta: { note: "x", text: "called Zebulon Q today", list: ["zebulon q"] } }, ["Zebulon Q", "z@x.test"]);
    expect(out).toEqual({ changes: { fullName: { changed: true }, status: { before: "a", after: "b" } }, meta: { note: { changed: true }, text: "[removed]", list: ["[removed]"] } });
  });
  it("ignores needles too short to be meaningful", () => {
    expect(scrubAuditPayload({ a: "ab cd" }, ["ab", ""])).toEqual({ a: "ab cd" });
  });
});
