/**
 * Company-name normalization and fuzzy matching.
 * Used to suggest merges ("Google" / "Google LLC"); staff confirm before anything merges.
 */
const LEGAL_SUFFIXES = new Set([
  "llc", "inc", "incorporated", "ltd", "limited", "gmbh", "corp", "corporation", "co", "company",
  "plc", "sa", "ag", "bv", "oy", "ab", "srl", "spa", "llp", "lp", "pte", "pty", "cjsc", "ojsc", "ooo",
]);

/** Lower-case, strip accents/punctuation and trailing legal-form suffixes; collapse whitespace. */
export function normalizeCompanyName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\./g, "") // "S.A." → "sa", "Co." → "co"
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const words = base.split(/\s+/).filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  if (words.length > 1 && words[0] === "the") words.shift();
  return words.join(" ");
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const t = s.replace(/\s+/g, " ");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice coefficient on character bigrams of the normalized names (0–1). */
export function companySimilarity(a: string, b: string): number {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;
  const A = bigrams(na);
  const B = bigrams(nb);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of A) {
    overlap += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  const dice = (2 * overlap) / total;
  return Math.max(dice, tokenContainment(na, nb));
}

/**
 * "Picsart" vs "Picsart Armenia": every token of the shorter name starts the longer one.
 * Scores 0.85 (enough to suggest a merge, never auto-merged). Very short names are ignored
 * to avoid suggesting "ABC" ↔ "ABC Bank"-style coincidences.
 */
function tokenContainment(a: string, b: string): number {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.replace(/\s/g, "").length < 4) return 0;
  const st = short.split(" ");
  const lt = long.split(" ");
  return st.every((tok, i) => lt[i] === tok) ? 0.85 : 0;
}

export interface CompanyCandidate {
  id: string;
  names: string[]; // canonical name + aliases
}

export interface CompanyMatch {
  id: string;
  similarity: number;
}

/**
 * Returns existing companies similar to `name`, best first. Ties are broken by id
 * so results are deterministic.
 */
export function findSimilarCompanies(
  name: string,
  candidates: readonly CompanyCandidate[],
  threshold = 0.82,
  limit = 3,
): CompanyMatch[] {
  const matches: CompanyMatch[] = [];
  for (const c of candidates) {
    const best = Math.max(0, ...c.names.map((n) => companySimilarity(name, n)));
    if (best >= threshold) matches.push({ id: c.id, similarity: Math.round(best * 1000) / 1000 });
  }
  return matches.sort((x, y) => y.similarity - x.similarity || x.id.localeCompare(y.id)).slice(0, limit);
}
