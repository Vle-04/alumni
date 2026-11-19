/**
 * Staff authentication (Auth.js v5). There is no self sign-up: an admin must create the User first.
 *   - Everyone can sign in with email + password (src/server/services/staff-auth.ts, /login).
 *   - Non-admin staff can also use Google (or the organisation's OIDC SSO), matched by email.
 *   - Admins can ONLY use email + password; OAuth sign-in is refused for them (DECISIONS D100).
 * Graduates never use this — they use signed personal links (src/server/tokens).
 */
import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Provider } from "next-auth/providers";
import { prisma } from "./db";
import { env } from "./env";
import { audit } from "./audit";
import { logger } from "./logger";
import type { Role } from "@/domain/rbac/permissions";
import { STAFF_SESSION_MAX_AGE_S } from "./services/staff-auth";

// Pin Auth.js to the configured public URL. Without this (trustHost: true), OAuth redirect URLs
// would be built from request Host / X-Forwarded-Host headers (host-header poisoning). See D97.
if (process.env.APP_URL && !process.env.AUTH_URL) process.env.AUTH_URL = `${process.env.APP_URL.replace(/\/$/, "")}/api/auth`;

const useSecureCookies = (process.env.APP_URL ?? "").startsWith("https://");
/** The cookie Auth.js reads the database session from (password sign-in sets the same one). */
export const STAFF_SESSION_COOKIE = `${useSecureCookies ? "__Secure-" : ""}authjs.session-token`;

export const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const ssoEnabled = () => Boolean(process.env.AUTH_OIDC_ISSUER && process.env.AUTH_OIDC_CLIENT_ID);

function providers(): Provider[] {
  const list: Provider[] = [];
  if (googleEnabled()) {
    list.push(
      Google({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        // Accounts are pre-created by an admin; linking by email is safe only because the signIn
        // callback also requires Google's email_verified flag.
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }
  if (ssoEnabled()) {
    list.push({
      id: "oidc",
      name: "SSO",
      type: "oidc",
      issuer: process.env.AUTH_OIDC_ISSUER,
      clientId: process.env.AUTH_OIDC_CLIENT_ID,
      clientSecret: process.env.AUTH_OIDC_CLIENT_SECRET,
      // Staff accounts are pre-created by an admin; the organisation IdP is trusted to verify email.
      allowDangerousEmailAccountLinking: true,
    });
  }
  return list;
}

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database", maxAge: STAFF_SESSION_MAX_AGE_S, updateAge: 30 * 60 },
  trustHost: true,
  // Secure (__Secure-/__Host-) cookies whenever the app is served over HTTPS.
  useSecureCookies,
  providers: providers(),
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user.email) return false;
      if (account?.provider === "google" && profile?.email_verified !== true) return false;
      const existing = await prisma.user.findUnique({ where: { email: user.email.toLowerCase() } });
      if (!existing?.active) return false; // no self sign-up
      if (existing.role === "ADMIN") {
        logger.info("OAuth sign-in refused for an admin account (password only)");
        return "/login?error=AdminPasswordOnly";
      }
      return true;
    },
    async session({ session, user }) {
      session.user.id = user.id;
      session.user.role = (user.role ?? "LEADERSHIP") as Role;
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user.id) return;
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await audit(prisma, { actor: { type: "user", id: user.id, role: (user.role ?? "LEADERSHIP") as Role } }, { action: "auth.sign_in", entityType: "User", entityId: user.id, meta: { method: "oauth" } });
    },
  },
  secret: process.env.AUTH_SECRET,
};

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  env(); // validate configuration at first use
  return authConfig;
});
