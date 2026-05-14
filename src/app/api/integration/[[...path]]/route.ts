import { NextRequest } from "next/server";
import { handleTrainingRecords } from "@/lib/integration-training-records";

export const runtime = "nodejs";

// Catch-all: /api/integration ve altındaki HER yol (ör. dış sistemin URL
// sonuna eklediği /pull, /list, trailing slash vb.) aynı eğitim kaydı
// yanıtını döner. Kanonik /api/integration/training-records route'u daha
// spesifik olduğu için o tam yol için öncelik onda kalır; bu dosya yalnızca
// eşleşmeyen varyantları yakalar. Tüm istekler X-API-Key ile korunur.
export async function GET(req: NextRequest) {
  return handleTrainingRecords(req);
}

export async function POST(req: NextRequest) {
  return handleTrainingRecords(req);
}
