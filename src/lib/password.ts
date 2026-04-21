import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import type { TokenType } from "@prisma/client";

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 8) return "Şifre en az 8 karakter olmalı";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw))
    return "Şifre harf ve rakam içermeli";
  return null;
}

export async function createPasswordToken(
  userId: string,
  type: TokenType,
  ttlHours = 72
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  await prisma.passwordToken.create({
    data: { userId, token, type, expiresAt },
  });
  return token;
}

export async function consumePasswordToken(token: string) {
  const t = await prisma.passwordToken.findUnique({ where: { token } });
  if (!t || t.usedAt || t.expiresAt < new Date()) return null;
  return t;
}

export async function markTokenUsed(tokenId: string) {
  await prisma.passwordToken.update({
    where: { id: tokenId },
    data: { usedAt: new Date() },
  });
}
