import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { renderCertificatePdf } from "@/lib/certificate/pdf";
import {
  loadCurrentCertificateTemplate,
  loadTemplateFromSnapshot,
} from "@/lib/certificate/template";

export const runtime = "nodejs";

// Admin "Sertifika şablonu" sayfasında canlı önizleme için. GET: mevcut
// ayarlarla, POST: form body'deki overrides ile (kaydetmeden önceki
// deneme). Yanıt: application/pdf (tarayıcı inline açar).
export async function GET() {
  await requireRole("ADMIN");
  const template = await loadCurrentCertificateTemplate();
  const pdf = await renderPreview(template);
  return pdfResponse(pdf);
}

export async function POST(req: NextRequest) {
  await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const template = loadTemplateFromSnapshot(body);
  const pdf = await renderPreview(template);
  return pdfResponse(pdf);
}

async function renderPreview(template: Awaited<ReturnType<typeof loadCurrentCertificateTemplate>>) {
  return renderCertificatePdf({
    name: "Ali Veli",
    // Önizlemede görünürlük bayraklarının etkisini görmek için dummy veri.
    birthDate: new Date("1990-05-15"),
    birthPlace: "İstanbul",
    courseTitle: "Örnek Eğitim Kursu",
    issuedAt: new Date(),
    serialNo: "BA-PREVIEW-000000",
    kind: "achievement",
    ownerManagerName: "Örnek Yönetici",
    verifyUrl: `${process.env.APP_URL || "http://localhost:3000"}/verify/preview`,
    template,
  });
}

function pdfResponse(pdf: Buffer) {
  return new NextResponse(new Uint8Array(pdf as unknown as ArrayBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="sertifika-onizleme.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
