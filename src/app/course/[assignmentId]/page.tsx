import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { ScormPlayer } from "./ScormPlayer";
import { notFound } from "next/navigation";

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

  const contentUrl = `/api/scorm-content/${course.scormPackagePath}/${course.scormEntryPoint}`;
  const latest = a.attempts[0];
  const initialCmi = (latest?.cmiData as Record<string, unknown> | null) ?? undefined;

  if (a.status === "PENDING") {
    await prisma.assignment.update({
      where: { id: a.id },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });
  }

  return (
    <Shell user={user}>
      <h1 className="text-lg font-semibold mb-3">{course.title}</h1>
      <ScormPlayer
        assignmentId={a.id}
        contentUrl={contentUrl}
        version={course.scormVersion}
        initialCmi={initialCmi}
      />
    </Shell>
  );
}
