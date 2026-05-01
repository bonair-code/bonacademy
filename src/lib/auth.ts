import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import type { Role } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role; departmentId: string | null } & DefaultSession["user"];
  }
}

const MAX_ATTEMPTS = 3;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      id: "password",
      name: "E-posta + Şifre",
      credentials: {
        email: { label: "E-posta", type: "email" },
        password: { label: "Şifre", type: "password" },
      },
      authorize: async (creds) => {
        const email = String(creds?.email || "").trim().toLowerCase();
        const password = String(creds?.password || "");
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive || !user.passwordHash) return null;
        if (user.lockedAt) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) {
          const attempts = user.failedLoginAttempts + 1;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: attempts,
              lockedAt: attempts >= MAX_ATTEMPTS ? new Date() : null,
            },
          });
          return null;
        }

        if (user.failedLoginAttempts > 0) {
          await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginAttempts: 0 },
          });
        }

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      if (token.sub) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { role: true, departmentId: true, isActive: true },
        });
        if (dbUser?.isActive) {
          (token as any).role = dbUser.role;
          (token as any).departmentId = dbUser.departmentId;
        }
      }
      return token;
    },
    async session({ session, token }) {
      const uid = token?.sub as string | undefined;
      if (!uid) return session;
      session.user.id = uid;
      session.user.role = ((token as any)?.role as any) ?? "USER";
      session.user.departmentId = ((token as any)?.departmentId as any) ?? null;
      return session;
    },
  },
  pages: { signIn: "/login" },
});
