/**
 * Audit item 3: Zod validation on EVERY server action and route handler input.
 * Static enforcement — a new action or route without validation fails CI.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const files = walk("src/app").map((p) => ({ p, s: readFileSync(p, "utf8") }));

/** Returns the body text of each function, starting after its opening brace. */
function bodies(src: string, header: RegExp): { name: string; sig: string; body: string }[] {
  const out: { name: string; sig: string; body: string }[] = [];
  for (const m of src.matchAll(header)) out.push({ name: m[1]!, sig: m[2] ?? "", body: src.slice(m.index! + m[0].length, m.index! + m[0].length + 400) });
  return out;
}

describe("every server action validates its arguments with Zod first", () => {
  const moduleActions = files.filter((f) => /^"use server";/m.test(f.s.split("\n")[0] ?? ""));
  const exported = moduleActions.flatMap((f) => bodies(f.s, /export async function (\w+)\((.*)\{\n/g).map((b) => ({ ...b, file: f.p })));
  const inline = files.flatMap((f) => bodies(f.s, /async function (\w+)\(([^)]*)\)\s*\{\s*"use server";/g).map((b) => ({ ...b, file: f.p })));

  it("finds the actions", () => {
    expect(exported.length).toBeGreaterThanOrEqual(45);
    expect(inline.length).toBeGreaterThanOrEqual(4);
  });
  it.each([...exported, ...inline].map((a) => [`${a.file} › ${a.name}`, a] as const))("%s", (_n, a) => {
    // AUDIT 19: ALL received arguments (typed rest tuple) are validated, so extra ones are rejected.
    expect(a.sig.trimStart().startsWith("...args: [")).toBe(true);
    expect(a.body.trimStart()).toMatch(/^(const \[[\w, ]*\] = )?parseArgs\(z\.tuple\(\[.*\]\), args\);/);
  });
});

describe("AUDIT 18: every route handler parses params, query and body through validatedRoute", () => {
  const routes = files.filter((f) => f.p.endsWith("route.ts") && !f.p.includes("api/auth")); // Auth.js validates its own
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  it("finds the routes", () => expect(routes.length).toBeGreaterThanOrEqual(5));
  it.each(routes.map((r) => [r.p, r] as const))("%s", (_n, r) => {
    const s = code(r.s);
    const handlers = [...s.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]);
    expect(handlers.length).toBeGreaterThan(0);
    // Each HTTP handler is created by the wrapper…
    for (const h of handlers) expect(s).toMatch(new RegExp(`export const ${h} = validatedRoute\\(`));
    expect(s).not.toMatch(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)/);
    // …and never reads raw input itself.
    expect(s).not.toMatch(/searchParams|\.json\(\)|\.formData\(\)|\.text\(\)|await\s+params|ctx\.params|\.headers\.get\(\s*["'](x-|cookie)/);
    // Dynamic segments must have a params schema.
    if (/\[\w+\]/.test(r.p)) expect(s).toMatch(/params:\s*(tokenParam|idParam|z\.object)/);
  });
});

describe("AUDIT 15: client IP comes from one place", () => {
  const all = [...walk("src"), "server.ts"].map((p) => ({ p, s: readFileSync(p, "utf8") }));
  it("no code outside the client-IP core reads x-forwarded-for / x-real-ip", () => {
    const offenders = all.filter((f) => !/client-ip-core\.ts$|\.test\.ts$|logger\.ts$/.test(f.p) && /["'`]x-(forwarded-for|real-ip)["'`]/i.test(f.s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
    expect(offenders.map((o) => o.p)).toEqual([]);
  });
  it("every rate limit / lockout keyed by IP gets it from clientIp()", () => {
    const ipKeyed = all.filter((f) => /checkRateLimit\(`[^`]*ip:|isLockedOut\("(gradLink|partnerLink)"/.test(f.s));
    expect(ipKeyed.length).toBeGreaterThanOrEqual(3);
    for (const f of ipKeyed) expect(f.s, f.p).toMatch(/clientIp\(|requestClientIp\(|\bip\b: string/);
  });
});
