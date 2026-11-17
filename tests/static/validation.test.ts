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
function bodies(src: string, header: RegExp): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  for (const m of src.matchAll(header)) out.push({ name: m[1]!, body: src.slice(m.index! + m[0].length, m.index! + m[0].length + 400) });
  return out;
}

describe("every server action validates its arguments with Zod first", () => {
  const moduleActions = files.filter((f) => /^"use server";/m.test(f.s.split("\n")[0] ?? ""));
  const exported = moduleActions.flatMap((f) => bodies(f.s, /export async function (\w+)\(.*\{\n/g).map((b) => ({ ...b, file: f.p })));
  const inline = files.flatMap((f) => bodies(f.s, /async function (\w+)\([^)]*\)\s*\{\s*"use server";/g).map((b) => ({ ...b, file: f.p })));

  it("finds the actions", () => {
    expect(exported.length).toBeGreaterThanOrEqual(45);
    expect(inline.length).toBeGreaterThanOrEqual(4);
  });
  it.each([...exported, ...inline].map((a) => [`${a.file} › ${a.name}`, a] as const))("%s", (_n, a) => {
    expect(a.body.trimStart()).toMatch(/^parseArgs\(z\.tuple\(\[.*\]\), \[[\w, ]*\]\);/);
  });
});

describe("every route handler validates its input with Zod", () => {
  const routes = files.filter((f) => f.p.endsWith("route.ts") && !f.p.includes("api/auth")); // Auth.js validates its own
  it("finds the routes", () => expect(routes.length).toBeGreaterThanOrEqual(5));
  it.each(routes.map((r) => [r.p, r] as const))("%s", (_n, r) => {
    expect(r.s).toMatch(/from "zod"/);
    expect(r.s).toMatch(/\.(safeParse|parse)\(/);
  });
});
