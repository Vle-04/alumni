import { prisma } from "@/server/db";
import type { RequestContext } from "@/server/context";
import type { Role } from "@/domain/rbac/permissions";
import { blindIndex, encrypt } from "@/server/crypto";

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

let n = 0;
export async function staff(role: Role): Promise<RequestContext & { actor: { type: "user"; id: string; role: Role } }> {
  const u = await prisma.user.create({ data: { email: `${role.toLowerCase()}${++n}@academy.test`, name: `${role} ${n}`, role } });
  return { actor: { type: "user", id: u.id, role }, ip: "127.0.0.1", userAgent: "vitest" };
}

export async function makeCohort(opts: { name?: string; graduationDate?: Date | null } = {}) {
  const program = await prisma.program.upsert({ where: { name: "Test Program" }, create: { name: "Test Program" }, update: {} });
  return prisma.cohort.create({
    data: {
      programId: program.id,
      name: opts.name ?? `Cohort ${++n}`,
      startDate: new Date("2025-01-10"),
      graduationDate: opts.graduationDate === undefined ? new Date("2025-06-30") : opts.graduationDate,
    },
  });
}

export async function makeGraduate(cohortId: string, opts: { email?: string; name?: string } = {}) {
  const email = opts.email ?? `grad${++n}@example.test`;
  return prisma.graduate.create({
    data: { cohortId, fullName: opts.name ?? `Graduate ${n}`, emailEnc: encrypt(email), emailHash: blindIndex(email) },
  });
}
