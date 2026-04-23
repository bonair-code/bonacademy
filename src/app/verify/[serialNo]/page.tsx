import { prisma } from "@/lib/db";
import Link from "next/link";
import { fmtTrDate } from "@/lib/dates";

// Bu sayfa public — middleware "/verify" prefix'ini auth'tan muaf tutuyor.
// QR okuyan kişi giriş yapmadan sertifikanın gerçekliğini doğrulayabilsin.
// Kişisel veri (e-posta, departman vs.) paylaşmıyoruz; yalnızca ad, kurs,
// tarih ve seri no gösteriliyor.
export const dynamic = "force-dynamic";

export default async function VerifyCertificate({
  params,
}: {
  params: Promise<{ serialNo: string }>;
}) {
  const { serialNo: rawSerial } = await params;
  const serialNo = decodeURIComponent(rawSerial).trim();

  const cert = serialNo
    ? await prisma.certificate.findUnique({
        where: { serialNo },
        include: {
          user: { select: { name: true } },
          assignment: {
            include: {
              examAttempts: { where: { passed: true }, take: 1 },
              plan: {
                include: {
                  course: {
                    select: {
                      title: true,
                      ownerManager: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      })
    : null;

  if (!cert) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center text-3xl mb-4">
            ✕
          </div>
          <h1 className="text-xl font-semibold text-slate-900 mb-2">
            Sertifika Doğrulanamadı
          </h1>
          <p className="text-sm text-slate-600">
            Bu seri numarasına ait geçerli bir sertifika kaydı bulunamadı:
            <br />
            <code className="mt-2 inline-block text-xs bg-slate-100 px-2 py-1 rounded">
              {serialNo || "(boş)"}
            </code>
          </p>
          <p className="text-xs text-slate-500 mt-6">
            Bon Air Havacılık Sanayi ve Ticaret A.Ş. · BonAcademy
          </p>
        </div>
      </main>
    );
  }

  const passedExam = cert.assignment.examAttempts.length > 0;

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-emerald-600 text-white px-6 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-xl">
            ✓
          </div>
          <div>
            <div className="text-sm/none opacity-90">DOĞRULANDI</div>
            <div className="text-lg font-semibold">Geçerli Sertifika</div>
          </div>
        </div>

        <dl className="divide-y divide-slate-100 px-6 py-4 text-sm">
          <div className="py-3 flex justify-between gap-4">
            <dt className="text-slate-500">Ad Soyad</dt>
            <dd className="font-medium text-slate-900 text-right">
              {cert.user.name}
            </dd>
          </div>
          <div className="py-3 flex justify-between gap-4">
            <dt className="text-slate-500">Eğitim</dt>
            <dd className="font-medium text-slate-900 text-right">
              {cert.assignment.plan.course.title}
            </dd>
          </div>
          <div className="py-3 flex justify-between gap-4">
            <dt className="text-slate-500">Tür</dt>
            <dd className="text-slate-900 text-right">
              {passedExam ? "Başarı Sertifikası" : "Katılım Sertifikası"}
            </dd>
          </div>
          <div className="py-3 flex justify-between gap-4">
            <dt className="text-slate-500">Veriliş Tarihi</dt>
            <dd className="text-slate-900 text-right">
              {fmtTrDate(cert.issuedAt)}
            </dd>
          </div>
          <div className="py-3 flex justify-between gap-4">
            <dt className="text-slate-500">Seri No</dt>
            <dd className="font-mono text-xs text-slate-700 text-right break-all">
              {cert.serialNo}
            </dd>
          </div>
          {cert.assignment.plan.course.ownerManager?.name && (
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-500">Sorumlu</dt>
              <dd className="text-slate-900 text-right">
                {cert.assignment.plan.course.ownerManager.name}
              </dd>
            </div>
          )}
        </dl>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 text-xs text-slate-500 text-center">
          Bu kayıt BonAcademy veritabanında bulunmaktadır.
          <br />
          Bon Air Havacılık Sanayi ve Ticaret A.Ş.
        </div>
      </div>
    </main>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ serialNo: string }>;
}) {
  const { serialNo } = await params;
  return {
    title: `Sertifika Doğrulama · ${decodeURIComponent(serialNo)}`,
    robots: { index: false, follow: false },
  };
}
