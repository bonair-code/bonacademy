import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";
import type { TokenType } from "@prisma/client";

// Davet (INVITE) ve şifre sıfırlama (RESET) tokenlarını üreten + doğrulayan
// merkezi yardımcı. Token gizli rastgele 32 byte (hex), tabloda unique.
//
// Süreler:
//   INVITE → 72 saat (yeni çalışana kurulum süresi tanı)
//   RESET  → 2 saat  (kısa pencere, çalınmayı zorlaştırır)
//
// Kullanım sonrası `usedAt` set edilir; aynı token tekrar geçerli olmaz. Aynı
// kullanıcı için yeni token üretilirse eski/kullanılmamış aynı tipteki
// tokenlar iptal edilir (usedAt set edilir) — "şifreyi sıfırla mailini iki
// kez yolladım" senaryosunda eski link de geçersiz olur.

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const RESET_TTL_MS = 2 * 60 * 60 * 1000;

function generateRaw(): string {
  return randomBytes(32).toString("hex");
}

export async function createPasswordToken(userId: string, type: TokenType) {
  const ttl = type === "INVITE" ? INVITE_TTL_MS : RESET_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  // Aynı tipteki bekleyen tokenları iptal et — sadece en son üretilen geçerli olsun.
  await prisma.passwordToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: new Date() },
  });
  const token = generateRaw();
  await prisma.passwordToken.create({
    data: { userId, type, token, expiresAt },
  });
  return token;
}

export async function verifyPasswordToken(token: string, type: TokenType) {
  if (!token || token.length < 32) return null;
  const row = await prisma.passwordToken.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true, name: true, isActive: true } } },
  });
  if (!row) return null;
  if (row.type !== type) return null;
  if (row.usedAt) return null;
  if (row.expiresAt < new Date()) return null;
  if (!row.user.isActive) return null;
  return row;
}

export async function consumePasswordToken(tokenId: string) {
  await prisma.passwordToken.update({
    where: { id: tokenId },
    data: { usedAt: new Date() },
  });
}
