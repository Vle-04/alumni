import { describe, expect, it } from "vitest";
import { expiresIn, signToken, verifyToken, type TokenPayload } from "./signedToken";

const key = "test-key";
const now = new Date("2026-05-01T00:00:00Z");
const payload: TokenPayload = { sub: "grad_1", v: 3, p: "profile", exp: expiresIn(now, 30 * 86400) };

describe("signed tokens", () => {
  it("round-trips", () => {
    const r = verifyToken(signToken(payload, key), key, now, ["profile"]);
    expect(r).toEqual({ ok: true, payload });
  });
  it("rejects a token signed with another key", () => {
    expect(verifyToken(signToken(payload, "other"), key, now, ["profile"])).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("rejects a tampered payload (e.g. someone else's graduate id)", () => {
    const [, sig] = signToken(payload, key).split(".");
    const forged = `${Buffer.from(JSON.stringify({ ...payload, sub: "grad_2" })).toString("base64url")}.${sig}`;
    expect(verifyToken(forged, key, now, ["profile"])).toMatchObject({ ok: false, reason: "bad_signature" });
  });
  it("rejects expired tokens at the exact expiry second", () => {
    const t = signToken({ ...payload, exp: expiresIn(now, 0) }, key);
    expect(verifyToken(t, key, now, ["profile"])).toEqual({ ok: false, reason: "expired" });
  });
  it("rejects the wrong purpose", () => {
    expect(verifyToken(signToken(payload, key), key, now, ["session"])).toEqual({ ok: false, reason: "wrong_purpose" });
  });
  it.each(["", "abc", "a.b.c", "x".repeat(2000), "e30.e30"])("rejects malformed input %#", (t) => {
    expect(verifyToken(t, key, now, ["profile"]).ok).toBe(false);
  });
  it("refuses to sign with an empty key", () => expect(() => signToken(payload, "")).toThrow());
});
