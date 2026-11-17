/**
 * Builds before/after diffs for the audit log. Contact fields are never written to the
 * audit log in clear text — only the fact that they changed — so the audit log does not
 * become a second copy of personal data.
 */
export const CONTACT_FIELDS = new Set([
  "email", "emailEnc", "emailHash", "phone", "phoneEnc", "linkedinUrl", "linkedinUrlEnc",
]);
/** Other identifying fields: also logged only as "changed", never by value. */
export const PERSONAL_FIELDS = new Set(["fullName", "preferredName", "city", "country", "timezone", "notes", "note"]);
const REDACTED = new Set([...CONTACT_FIELDS, ...PERSONAL_FIELDS]);

/**
 * Which strings identify a person, split by where they may be scrubbed:
 *  - `full`: full name, email, phone — scrubbed everywhere, including SHARED records
 *  - `parts`: single name parts (and a one-word preferred name) — scrubbed ONLY in the person's own
 *    records, because on their own they are ordinary words ("Mark", "Will").
 */
export interface Identifiers {
  full: string[];
  parts: string[];
}

export function identifiersFor(p: { fullName: string; preferredName?: string | null; email?: string | null; phone?: string | null }): Identifiers {
  const clean = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => (x ?? "").trim()).filter((x) => x.length >= 3))];
  const parts = p.fullName.split(/[\s,.'’-]+/u);
  return {
    full: clean([p.fullName, p.preferredName && /\s/.test(p.preferredName) ? p.preferredName : null, p.email, p.phone]),
    parts: clean([...parts, p.preferredName && !/\s/.test(p.preferredName) ? p.preferredName : null]),
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replaces each needle with "[removed]" — WHOLE WORDS only, case-insensitive, Unicode-aware
 * ("Mark" never touches "marketing" or "Marks"). Longest needles first, so a full name is removed
 * as one unit before its parts.
 */
export function removeWholeWords(text: string, needles: readonly string[]): string {
  let out = text;
  for (const n of [...new Set(needles)].filter((x) => x.trim().length >= 3).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(n.trim())}(?![\\p{L}\\p{N}_])`, "giu"), "[removed]");
  }
  return out;
}

/**
 * Deep-scrubs a stored JSON payload (audit diff/meta, email payload): replaces whole-word matches of
 * `needles` inside strings — the rest of each string is kept. With `redactKeys` (only for entries
 * ABOUT the person), personal keys such as fullName/notes are also reduced to {changed: true}.
 */
export function scrubAuditPayload(value: unknown, needles: readonly string[], opts: { redactKeys: boolean } = { redactKeys: true }): unknown {
  const walk = (v: unknown, key?: string): unknown => {
    if (opts.redactKeys && key && REDACTED.has(key)) return { changed: true };
    if (typeof v === "string") return removeWholeWords(v, needles);
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(value);
}

export type AuditDiff = Record<string, { before?: unknown; after?: unknown; changed?: true }>;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return JSON.stringify(a) === JSON.stringify(b);
}

export function auditDiff(before: Record<string, unknown> | null, after: Record<string, unknown> | null): AuditDiff {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const diff: AuditDiff = {};
  for (const k of keys) {
    if (k === "updatedAt" || k === "createdAt") continue;
    const b = before?.[k];
    const a = after?.[k];
    if (same(a, b)) continue;
    diff[k] = REDACTED.has(k) ? { changed: true } : { before: b ?? null, after: a ?? null };
  }
  return diff;
}
