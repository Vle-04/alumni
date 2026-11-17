import { randomBytes } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

try { process.loadEnvFile(".env"); } catch { /* CI */ }
export const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });

/** Signs a seeded staff user in by creating a database session (equivalent to clicking the magic link). */
export async function loginAs(context: BrowserContext, email: string, baseURL: string) {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const sessionToken = randomBytes(32).toString("hex");
  await db.session.create({ data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 3600_000) } });
  await context.addCookies([{ name: "authjs.session-token", value: sessionToken, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
}
