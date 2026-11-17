/**
 * Skill-name normalization through an admin-editable synonym table
 * (e.g. "JS" → "JavaScript", "Postgres" → "PostgreSQL").
 */
export function skillKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface SkillDictionary {
  /** canonical skill id by lower-cased canonical name OR alias */
  byKey: ReadonlyMap<string, string>;
}

export function buildSkillDictionary(
  skills: readonly { id: string; canonicalName: string }[],
  synonyms: readonly { skillId: string; alias: string }[],
): SkillDictionary {
  const byKey = new Map<string, string>();
  for (const s of skills) byKey.set(skillKey(s.canonicalName), s.id);
  for (const syn of synonyms) if (!byKey.has(skillKey(syn.alias))) byKey.set(skillKey(syn.alias), syn.skillId);
  return { byKey };
}

/** Resolves a free-text skill name to a canonical skill id, or null if unknown. */
export function resolveSkill(dict: SkillDictionary, name: string): string | null {
  return dict.byKey.get(skillKey(name)) ?? null;
}

/** Default synonyms seeded on first run; admins can edit them afterwards. */
export const DEFAULT_SKILL_SYNONYMS: Record<string, string[]> = {
  JavaScript: ["js", "ecmascript", "es6"],
  TypeScript: ["ts"],
  PostgreSQL: ["postgres", "psql", "pg"],
  "Node.js": ["node", "nodejs", "node js"],
  React: ["react.js", "reactjs"],
  Python: ["py", "python3"],
  Docker: ["docker compose", "containers"],
  Kubernetes: ["k8s"],
  "C#": ["csharp", "c sharp"],
  ".NET": ["dotnet", "asp.net"],
  SQL: ["structured query language"],
  "Power BI": ["powerbi"],
  Figma: [],
  Java: [],
  Git: ["github", "gitlab"],
  AWS: ["amazon web services"],
  "Machine Learning": ["ml"],
  Excel: ["ms excel", "microsoft excel"],
  "Manual Testing": ["manual qa"],
  Selenium: [],
  "Next.js": ["nextjs", "next"],
  HTML: ["html5"],
  CSS: ["css3"],
  Linux: [],
  Tableau: [],
  Pandas: [],
  "UX Research": ["user research"],
};
