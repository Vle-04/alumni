/**
 * Creates the FIRST administrator, only while no active admin exists (a new deployment, where
 * there is no sign-up and the CLI can't write to the database). Returns a generated password once.
 * After that, admins are managed in the app (Admin → Staff users); this refuses with a conflict.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../db";
import { audit } from "../audit";
import { ConflictError } from "../errors";
import { hashPassword } from "../password";

export async function bootstrapFirstAdmin(input: { email: string; name: string }): Promise<{ email: string; password: string }> {
  const email = input.email.trim().toLowerCase();
  const password = randomBytes(18).toString("base64url");
  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    if ((await tx.user.count({ where: { role: "ADMIN", active: true } })) > 0) {
      throw new ConflictError("An administrator already exists. Manage staff in the app.");
    }
    return tx.user.upsert({
      where: { email },
      create: { email, name: input.name, role: "ADMIN", active: true, passwordHash, passwordChangedAt: new Date() },
      update: { role: "ADMIN", active: true, passwordHash, passwordChangedAt: new Date() },
    });
  }, { isolationLevel: "Serializable" });
  await audit(prisma, { actor: { type: "system", id: "bootstrap-admin" } }, { action: "user.bootstrap_admin", entityType: "User", entityId: user.id });
  return { email, password };
}
