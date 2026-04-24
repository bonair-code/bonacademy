// Google reCAPTCHA v3 — sunucu tarafı doğrulama.
// İstemci grecaptcha.execute(siteKey, {action}) ile token üretir, form'a
// gizli alan olarak ekler. Sunucuda burada Google'a POST atıp skoru
// doğruluyoruz. Skor 0..1 — 1 yüksek güven, 0 büyük olasılıkla bot.
// Login için 0.5 eşiği genel pratik.

const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const MIN_SCORE = 0.5;

type GoogleResponse = {
  success: boolean;
  score?: number;
  action?: string;
  challenge_ts?: string;
  hostname?: string;
  "error-codes"?: string[];
};

export async function verifyRecaptchaToken(
  token: string,
  expectedAction?: string
): Promise<{ ok: boolean; score?: number; reason?: string }> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    // Geliştirme ortamında anahtar yoksa engelleme — log'la geç.
    if (process.env.NODE_ENV !== "production") {
      console.warn("[captcha] RECAPTCHA_SECRET_KEY tanımlı değil, doğrulama atlandı.");
      return { ok: true, score: 1 };
    }
    return { ok: false, reason: "missing-secret" };
  }
  if (!token) return { ok: false, reason: "empty-token" };

  try {
    const body = new URLSearchParams({ secret, response: token });
    const r = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      // Google'a giderken Next cache'lemesin
      cache: "no-store",
    });
    const data = (await r.json()) as GoogleResponse;
    if (!data.success) {
      return { ok: false, reason: (data["error-codes"] || []).join(",") || "failed" };
    }
    if (expectedAction && data.action && data.action !== expectedAction) {
      return { ok: false, score: data.score, reason: "action-mismatch" };
    }
    if (typeof data.score === "number" && data.score < MIN_SCORE) {
      return { ok: false, score: data.score, reason: "low-score" };
    }
    return { ok: true, score: data.score };
  } catch (e) {
    return { ok: false, reason: "network-error" };
  }
}
