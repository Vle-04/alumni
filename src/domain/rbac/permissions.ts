/**
 * Role-based access control matrix. Every server-side entry point calls `can()`
 * (via src/server/authz.ts). The UI also uses it, but only to hide controls —
 * the server is the enforcement point.
 */
export const ROLES = ["ADMIN", "CAREER_SERVICES", "LEADERSHIP"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Individual-level data — never granted to LEADERSHIP.
  "graduate:read",
  "graduate:write",
  "graduate:read_contact",
  "graduate:import",
  "graduate:rotate_link",
  "graduate:delete",
  "employment:write",
  "cohort:write",
  "company:read",
  "company:write",
  "opening:read",
  "opening:write",
  "referral:read",
  "referral:write",
  "survey:read",
  "survey:manage",
  "audit:read",
  "dashboard:read",
  // Aggregates — safe for every staff role.
  "report:read",
  "report:export",
  "cohort:read_aggregate",
  // Administration.
  "user:manage",
  "settings:manage",
  "data:export_all",
  "skills:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permissions that expose data about a single identifiable person. */
export const INDIVIDUAL_LEVEL_PERMISSIONS: readonly Permission[] = [
  "graduate:read",
  "graduate:write",
  "graduate:read_contact",
  "graduate:import",
  "graduate:rotate_link",
  "graduate:delete",
  "employment:write",
  "referral:read",
  "referral:write",
  "survey:read",
  "survey:manage",
  "audit:read",
  "dashboard:read",
  "data:export_all",
  "opening:read",
  "company:read",
];

const CAREER_SERVICES: readonly Permission[] = [
  "graduate:read",
  "graduate:write",
  "graduate:read_contact",
  "graduate:import",
  "graduate:rotate_link",
  "employment:write",
  "cohort:write",
  "company:read",
  "company:write",
  "opening:read",
  "opening:write",
  "referral:read",
  "referral:write",
  "survey:read",
  "survey:manage",
  "dashboard:read",
  "report:read",
  "report:export",
  "cohort:read_aggregate",
  "audit:read",
];

const LEADERSHIP: readonly Permission[] = ["report:read", "report:export", "cohort:read_aggregate"];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set(PERMISSIONS),
  CAREER_SERVICES: new Set(CAREER_SERVICES),
  LEADERSHIP: new Set(LEADERSHIP),
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...MATRIX[role]];
}
