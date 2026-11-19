/**
 * Sets a staff member's password from the server, e.g. to bootstrap the first admin in production
 * (there is no sign-up and no magic link). Signs the user out everywhere.
 *
 *   npm run user:set-password -- admin@example.org                  # generates a strong password and prints it
 *   STAFF_PASSWORD='…' npm run user:set-password -- admin@example.org
 *   npm run user:set-password -- new@example.org --create ADMIN "Full Name"   # create the account first
 */
import { randomBytes } from "node:crypto";
try {
  process.loadEnvFile(".env");
} catch {
  /* env from platform */
}
const { prisma } = await import("../src/server/db");
const { hashPassword, passwordSchema } = await import("../src/server/password");

const [rawEmail, flag, role, ...nameParts] = process.argv.slice(2);
if (!rawEmail || !rawEmail.includes("@")) {
  console.log("Usage: npm run user:set-password -- <email> [--create ADMIN|CAREER_SERVICES|LEADERSHIP \"Full Name\"]");
  process.exit(1);
}
const email = rawEmail.trim().toLowerCase();
const generated = !process.env.STAFF_PASSWORD;
const password = process.env.STAFF_PASSWORD || randomBytes(18).toString("base64url");
const valid = passwordSchema.safeParse(password);
if (!valid.success) {
  console.error(valid.error.issues[0]!.message);
  process.exit(1);
}

let user = await prisma.user.findUnique({ where: { email } });
if (!user && flag === "--create") {
  if (!["ADMIN", "CAREER_SERVICES", "LEADERSHIP"].includes(role ?? "")) {
    console.error("--create needs a role: ADMIN, CAREER_SERVICES or LEADERSHIP");
    process.exit(1);
  }
  user = await prisma.user.create({ data: { email, name: nameParts.join(" ") || email, role: role as "ADMIN" } });
  console.log(`Created ${role} account for ${email}.`);
}
if (!user) {
  console.error(`No staff account for ${email}. Add --create <ROLE> "Full Name" to create one.`);
  process.exit(1);
}
const passwordHash = await hashPassword(password);
await prisma.$transaction([
  prisma.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date(), active: true } }),
  prisma.session.deleteMany({ where: { userId: user.id } }),
]);
console.log(`Password set for ${email}${generated ? `: ${password}` : "."}`);
await prisma.$disconnect();
export {};
