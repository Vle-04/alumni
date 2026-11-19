-- Staff sign in with email + password (admins) or password / Google (other staff).
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
