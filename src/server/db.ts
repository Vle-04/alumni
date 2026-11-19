import { Prisma, PrismaClient } from "@prisma/client";

// Netlify Database provides its connection string as NETLIFY_DB_URL; Prisma reads DATABASE_URL.
if (!process.env.DATABASE_URL && process.env.NETLIFY_DB_URL) process.env.DATABASE_URL = process.env.NETLIFY_DB_URL;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Never log query parameters: they can contain personal data.
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** A Prisma client or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;
