import { describe, expect, it } from "vitest";
import { __test } from "./logger";

describe("logger scrubbing", () => {
  it("redacts personal keys but keeps ids", () => {
    expect(__test.scrub({ email: "a@b.co", fullName: "Ani", graduateId: "g1", phoneEnc: "x" })).toEqual({
      email: "[redacted]", fullName: "[redacted]", graduateId: "g1", phoneEnc: "[redacted]",
    });
  });
  it("masks emails inside free text and errors", () => {
    expect(__test.scrub("failed for ani@example.com")).toBe("failed for [email]");
    expect((__test.scrub(new Error("x ani@example.com")) as { message: string }).message).toBe("x [email]");
  });
});
