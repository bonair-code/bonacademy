// Basit in-memory, IP bazlı sliding-window rate limiter.
//
// Uyarı: Vercel serverless çok-instance çalışır — her lambda örneğinin kendi
// Map'i olur. Dolayısıyla bu limiter kesin bir garanti sağlamaz, ama:
//   - Tek IP'den gelen hızlı burst'leri (aynı sıcak instance'a düşen) keser,
//   - Scripted enumeration / brute-force denemelerini ciddi ölçüde yavaşlatır,
//   - Ekstra altyapı (Redis / Upstash) gerektirmez.
// Kritik endpoint'ler için ileride Upstash Ratelimit'e geçilebilir.
//
// Anahtarı çağıran endpoint seçer (ör. "verify:1.2.3.4") böylece farklı
// endpoint'ler birbirini etkilemez.

type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number; // ms epoch
};

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): RateLimitResult {
  const cutoff = now - windowMs;
  let b = buckets.get(key);
  if (!b) {
    b = { hits: [] };
    buckets.set(key, b);
  }
  // Eski kayıtları at.
  b.hits = b.hits.filter((t) => t > cutoff);
  if (b.hits.length >= limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: (b.hits[0] ?? now) + windowMs,
    };
  }
  b.hits.push(now);
  // Map'in sonsuza dek büyümemesi için ara sıra temizlik (olasılıksal).
  if (Math.random() < 0.01) {
    for (const [k, v] of buckets) {
      if (v.hits.every((t) => t <= cutoff)) buckets.delete(k);
    }
  }
  return {
    ok: true,
    remaining: limit - b.hits.length,
    resetAt: now + windowMs,
  };
}

/** Next.js Request'ten client IP çıkarır; Vercel x-forwarded-for verir. */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
