import bcrypt from "bcryptjs";

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
