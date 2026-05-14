import { NextRequest } from "next/server";
import { handleTrainingRecords } from "@/lib/integration-training-records";

export const runtime = "nodejs";

// Kanonik yol. Çekirdek mantık @/lib/integration-training-records içinde;
// catch-all route da aynı handler'ı kullanır.
export async function GET(req: NextRequest) {
  return handleTrainingRecords(req);
}

export async function POST(req: NextRequest) {
  return handleTrainingRecords(req);
}
