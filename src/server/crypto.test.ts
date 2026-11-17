import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgresql://x";
  process.env.AUTH_SECRET = "x";
  process.env.BLIND_INDEX_KEY = "test-blind";
  process.env.TOKEN_SIGNING_KEY = "test-token";
  process.env.DATA_ENCRYPTION_KEYS = `v2:${Buffer.alloc(32, 2).toString("base64")},v1:${Buffer.alloc(32, 1).toString("base64")}`;
});

describe("crypto", async () => {
  const c = await import("./crypto");
  it("round-trips and never stores plaintext", () => {
    const ct = c.encrypt("ani@example.com");
    expect(ct.startsWith("v2.")).toBe(true);
    expect(ct).not.toContain("ani");
    expect(c.decrypt(ct)).toBe("ani@example.com");
  });
  it("uses a random IV per encryption", () => expect(c.encrypt("a")).not.toBe(c.encrypt("a")));
  it("decrypts data written with an older key version", async () => {
    const { createCipheriv } = await import("node:crypto");
    const iv = Buffer.alloc(12, 7);
    const cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 1), iv);
    const ct = Buffer.concat([cipher.update("old", "utf8"), cipher.final()]);
    const payload = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
    expect(c.decrypt(payload)).toBe("old");
  });
  it("rejects tampered ciphertext", () => {
    const ct = c.encrypt("hello");
    const parts = ct.split(".");
    parts[3] = Buffer.from("jello").toString("base64url");
    expect(() => c.decrypt(parts.join("."))).toThrow();
  });
  it("blind index is case-insensitive and deterministic", () => {
    expect(c.blindIndex("Ani@Example.com ")).toBe(c.blindIndex("ani@example.com"));
  });
  it("masks emails", () => expect(c.maskEmail("ani@example.com")).toBe("a•••@example.com"));
});
