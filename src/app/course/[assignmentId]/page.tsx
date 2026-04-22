import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { ScormPlayer } from "./ScormPlayer";
import { notFound } from "next/navigation";
import { getFile } from "@/lib/scorm/storage";

export default async function CoursePage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const user = await requireUser();
  const { assignmentId } = await params;
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      plan: { include: { course: true } },
      attempts: { where: { type: "SCORM" }, orderBy: { startedAt: "desc" }, take: 1 },
    },
  });
  if (!a || a.userId !== user.id) notFound();
  const course = a.plan.course;
  if (!course.scormPackagePath || !course.scormEntryPoint) {
    return (
      <Shell user={user}>
        <p className="text-slate-500">Bu kurs için henüz SCORM paketi yüklenmemiş.</p>
      </Shell>
    );
  }

  // Verify the entry file actually exists in the configured storage backend.
  // If the package was uploaded before we moved to Vercel Blob, the ephemeral
  // serverless filesystem copy is gone and we'd show a blank iframe otherwise.
  const entryCheck = await getFile(`${course.scormPackagePath}/${course.scormEntryPoint}`);
  if (!entryCheck) {
    return (
      <Shell user={user} title={course.title}>
        <div className="card p-6 max-w-2xl">
          <h2 className="font-semibold text-slate-900 mb-2">SCORM paketi bulunamadı</h2>
          <p className="text-sm text-slate-600 mb-3">
            Bu kursun SCORM içeriği şu anda depolama alanında değil. Büyük ihtimalle paket,
            kalıcı bulut depolamaya (Vercel Blob) geçmeden önce yüklendi ve geçici sunucu
            dosyasıyla birlikte silindi.
          </p>
          <p className="text-sm text-slate-600">
            Yönetici <strong>/admin/courses</strong> sayfasından bu kurs için SCORM paketini
            yeniden yüklemelidir. Tekrar yüklendiğinde içerik kalıcı olarak saklanacak.
          </p>
        </div>
      </Shell>
    );
  }

  const contentUrl = `/api/scorm-content/${course.scormPackagePath}/${course.scormEntryPoint}`;
  const latest = a.attempts[0];
  const initialCmi = (latest?.cmiData as Record<string, unknown> | null) ?? undefined;

  if (a.status === "PENDING") {
    await prisma.assignment.update({
      where: { id: a.id },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });
  }

  const stampedRev = a.revisionNumber;
  const liveRev = course.currentRevision;
  const showOutdatedNotice =
    stampedRev != null && stampedRev < liveRev && a.status !== "COMPLETED";

  return (
    <Shell user={user}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h1 className="text-lg font-semibold">{course.title}</h1>
        <div className="flex items-center gap-2 text-xs">
          {stampedRev != null && (
            <span className="badge-teal">Atama: v{stampedRev}</span>
          )}
          <span className="text-slate-500">Mevcut sürüm: v{liveRev}</span>
        </div>
      </div>
      {showOutdatedNotice && (
        <div className="card p-3 mb-3 text-sm text-amber-800 bg-amber-50 border-amber-200">
          Bu kursun daha güncel bir sürümü (v{liveRev}) yayınlandı. Bir sonraki
          döngüde yeni sürüm otomatik atanacak.
        </div>
      )}
      <ScormPlayer
        assignmentId={a.id}
        contentUrl={contentUrl}
        version={course.scormVersion}
        initialCmi={initialCmi}
      />
    </Shell>
  );
}
