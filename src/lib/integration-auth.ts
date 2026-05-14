import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

// Dış iç sistemler (ör. BonFlight) için salt-okunur entegrasyon endpoint'lerinin
// API key doğrulaması. İstemci anahtarı "X-API-Key" header'ı ile (veya
// "Authorization: Bearer <key>" ile) gönderir; INTEGRATION_API_KEY ile sabit
// zamanlı karşılaştırılır. CRON_SECRET pattern'iyle aynı mantık.
//
// Env tanımlı değilse endpoint kapalıdır (503) — yanlışlıkla korumasız
// açık kalmasın.

export function checkIntegrationKey(req: NextRequest): NextResponse | null {
  const expected = process.env.INTEGRATION_API_KEY;
  if (!expected) {
    console.error(
      "[integration] INTEGRATION_API_KEY tanımlı değil, istek reddedildi",
    );
    return NextResponse.json(
      { error: "Integration API not configured" },
      { status: 503 },
    );
  }

  const provided =
    req.headers.get("x-api-key")?.trim() ||
    req.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ||
    "";

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual eşit uzunluk ister; uzunluk farkı zaten reddedilir.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null; // doğrulama başarılı
}
