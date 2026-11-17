import { describe, expect, it } from "vitest";
import { __test } from "./logger";

describe("logger scrubbing", () => {
  it("redacts personal keys but keeps ids", () => {
    expect(__test.scrub({ email: "a@b.co", fullName: "Ani", graduateId: "g1", phoneEnc: "x" })).toEqual({
      email: "[redacted]", fullName: "[redacted]", graduateId: "g1", phoneEnc: "[redacted]",
    });
  });
  it("hides only keys that are exactly 'ip' or end in 'Ip'; 'skipped' stays visible", () => {
    expect(__test.scrub({ skipped: 3, ip: "203.0.113.7", clientIp: "198.51.100.4" })).toEqual({
      skipped: 3, ip: "[redacted]", clientIp: "[redacted]",
    });
  });
  it("masks phone numbers and scrubs stack traces", () => {
    expect(__test.scrub("call +1 555 0177 now")).toBe("call [phone] now");
    expect(__test.scrub("2026-11-17T10:00:00Z")).toBe("2026-11-17T10:00:00Z"); // timestamps untouched
    const e = __test.scrub(new Error("for a@b.co")) as { stack: string };
    expect(e.stack).not.toContain("a@b.co");
  });
  it("masks emails inside free text and errors", () => {
    expect(__test.scrub("failed for ani@example.com")).toBe("failed for [email]");
    expect((__test.scrub(new Error("x ani@example.com")) as { message: string }).message).toBe("x [email]");
  });
});
