import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeIp, parseTrustedHops, resolveClientIp } from "./client-ip-core";
import { clientIp } from "./client-ip";

describe("resolveClientIp", () => {
  it("0 trusted hops (default): ignores x-forwarded-for entirely and uses the socket", () => {
    expect(resolveClientIp({ remoteAddress: "198.51.100.9", headers: { "x-forwarded-for": "1.2.3.4" }, trustedHops: 0 })).toBe("198.51.100.9");
  });
  it("1 trusted hop: the address the proxy saw (rightmost entry before the proxy)", () => {
    // client 203.0.113.5 spoofs "1.1.1.1"; the proxy appends the real peer; the app's peer is the proxy.
    expect(resolveClientIp({ remoteAddress: "10.0.0.2", headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.5" }, trustedHops: 1 })).toBe("203.0.113.5");
  });
  it("2 trusted hops", () => {
    expect(resolveClientIp({ remoteAddress: "10.0.0.3", headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.5, 10.0.0.2" }, trustedHops: 2 })).toBe("203.0.113.5");
  });
  it("a configured proxy header wins (and is the only thing read)", () => {
    expect(resolveClientIp({ remoteAddress: "10.0.0.2", headers: { "cf-connecting-ip": "203.0.113.8", "x-forwarded-for": "1.1.1.1" }, trustedHops: 0, headerName: "CF-Connecting-IP" })).toBe("203.0.113.8");
    expect(resolveClientIp({ remoteAddress: "10.0.0.2", headers: {}, trustedHops: 0, headerName: "cf-connecting-ip" })).toBeNull();
  });
  it("returns null for garbage instead of a shared 'unknown'", () => {
    expect(resolveClientIp({ remoteAddress: undefined, headers: {}, trustedHops: 0 })).toBeNull();
    expect(resolveClientIp({ remoteAddress: "10.0.0.2", headers: { "x-forwarded-for": "not-an-ip" }, trustedHops: 1 })).toBeNull();
  });
});

describe("normalizeIp / parseTrustedHops / clientIp", () => {
  it.each([
    ["::ffff:127.0.0.1", "127.0.0.1"], ["203.0.113.5:443", "203.0.113.5"], ["[2001:db8::1]:443", "2001:db8::1"], ["2001:DB8::1", "2001:db8::1"], ["nope", null], ["", null],
  ])("%s → %s", (i, o) => expect(normalizeIp(i)).toBe(o));
  it("parses hops safely", () => {
    expect([undefined, "0", "1", "3", "-1", "x", "1.5", "99"].map(parseTrustedHops)).toEqual([0, 0, 1, 3, 0, 0, 0, 0]);
  });
  it("app code reads only the internal header, never x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "1.1.1.1" });
    expect(clientIp(h)).toBeNull();
    h.set("x-alumni-client-ip", "203.0.113.5");
    expect(clientIp(h)).toBe("203.0.113.5");
  });
  describe("CLIENT_IP_HEADER (serverless hosts such as Netlify)", () => {
    afterEach(() => vi.unstubAllEnvs());
    it("reads only the platform header; the internal header and x-forwarded-for are ignored", () => {
      vi.stubEnv("CLIENT_IP_HEADER", "x-nf-client-connection-ip");
      const h = new Headers({ "x-alumni-client-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" });
      expect(clientIp(h)).toBeNull();
      h.set("x-nf-client-connection-ip", "203.0.113.7");
      expect(clientIp(h)).toBe("203.0.113.7");
      h.set("x-nf-client-connection-ip", "not-an-ip");
      expect(clientIp(h)).toBeNull();
    });
  });
});
