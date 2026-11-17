/**
 * Staff authentication (Auth.js v5). Invitation-only: an admin must create the User first.
 * Graduates never use this — they use signed personal links (src/server/tokens).
 */
import NextAuth, { type NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Provider } from "next-auth/providers";
import { prisma } from "./db";
import { env } from "./env";
import { emailAdapter } from "./email/adapters";
import { renderEmail } from "./email/layout";
import { t } from "@/i18n";
import { audit } from "./audit";
import { logger } from "./logger";
import type { Role } from "@/domain/rbac/permissions";

function providers(): Provider[] {
  const list: Provider[] = [
    {
      id: "email",
      type: "email",
      name: "Email",
      from: process.env.EMAIL_FROM ?? "noreply@academy.example",
      maxAge: 15 * 60,
      options: {},
      // Never reveals whether an address has an account: unknown/inactive emails get no email,
      // but the user sees the same "check your email" page either way.
      async sendVerificationRequest({ identifier, url }) {
        const user = await prisma.user.findUnique({ where: { email: identifier.toLowerCase() } });
        if (!user?.active) {
          logger.info("sign-in link requested for non-staff address; not sent");
          return;
        }
        const { html, text } = renderEmail({
          title: t("email.staffSignInSubject"),
          paragraphs: [t("email.staffSignInBody")],
          cta: { label: t("auth.sendLink").replace("Email me a", "Open"), url },
        });
        await emailAdapter().send({ to: identifier, subject: t("email.staffSignInSubject"), html, text });
      },
    },
  ];
  if (process.env.AUTH_OIDC_ISSUER && process.env.AUTH_OIDC_CLIENT_ID) {
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
  session: { strategy: "database", maxAge: 8 * 60 * 60, updateAge: 30 * 60 },
  trustHost: true,
  // Secure (__Secure-/__Host-) cookies whenever the app is served over HTTPS.
  useSecureCookies: (process.env.APP_URL ?? "").startsWith("https://"),
  providers: providers(),
  pages: { signIn: "/login", verifyRequest: "/login/check-email", error: "/login" },
  callbacks: {
    async signIn({ user, email }) {
      if (email?.verificationRequest) return true;
      if (!user.email) return false;
      const existing = await prisma.user.findUnique({ where: { email: user.email.toLowerCase() } });
      return Boolean(existing?.active);
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
      await audit(prisma, { actor: { type: "user", id: user.id, role: (user.role ?? "LEADERSHIP") as Role } }, { action: "auth.sign_in", entityType: "User", entityId: user.id });
    },
  },
  secret: process.env.AUTH_SECRET,
};

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  env(); // validate configuration at first use
  return authConfig;
});
