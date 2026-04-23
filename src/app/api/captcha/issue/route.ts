import { NextRequest, NextResponse } from "next/server";
import { issueSliderToken } from "@/lib/captcha";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

// CAPTCHA token üretimi ücretsiz bir endpoint olduğu için spam'e karşı IP
// başına dakikada 30 istekle sınırlandırılır. Normal bir kullanıcı login
// sayfasında en fazla birkaç token ister; 30/dk ciddi bir üst sınır.
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`captcha:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Çok fazla istek" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  return NextResponse.json({ token: issueSliderToken() });
}
