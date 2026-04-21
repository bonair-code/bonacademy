import { createHmac, timingSafeEqual } from "crypto";

const MAX_AGE_MS = 5 * 60 * 1000;

function secret() {
  return process.env.AUTH_SECRET || "dev-secret";
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("hex");
}

export function issueSliderToken(): string {
  const ts = Date.now().toString();
  return `${ts}.${sign(ts)}`;
}

export function verifySliderToken(token: string): boolean {
  if (!token) return false;
  const [ts, sig] = token.split(".");
  if (!ts || !sig) return false;
  const expected = sign(ts);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const age = Date.now() - Number(ts);
  return age >= 0 && age < MAX_AGE_MS;
}
