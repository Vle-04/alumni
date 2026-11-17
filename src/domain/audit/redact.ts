/**
 * Builds before/after diffs for the audit log. Contact fields are never written to the
 * audit log in clear text — only the fact that they changed — so the audit log does not
 * become a second copy of personal data.
 */
export const CONTACT_FIELDS = new Set([
  "email", "emailEnc", "emailHash", "phone", "phoneEnc", "linkedinUrl", "linkedinUrlEnc",
]);

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
    diff[k] = CONTACT_FIELDS.has(k) ? { changed: true } : { before: b ?? null, after: a ?? null };
  }
  return diff;
}
