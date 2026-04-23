import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { nextDueDate } from "./recurrence";
import { addDays } from "date-fns";
import { sendAssignmentCreatedMail } from "@/lib/notifications/dispatcher";

// Mail gönderimi DB hatasına dönüşmesin diye izole et.
async function safeNotify(assignmentId: string) {
  try {
    await sendAssignmentCreatedMail(assignmentId);
  } catch (err) {
    console.error("[notify] assignment created mail failed", assignmentId, err);
  }
}

/**
 * Idempotent create: @@unique(planId,userId,cycleNumber) ihlali yakalanırsa
 * başka bir istek aynı atamayı yarattı demektir — sessizce geç. Bu, findUnique
 * + create arasındaki yarış penceresini kapatır.
 */
async function createAssignmentIfAbsent(data: {
  planId: string;
  userId: string;
  cycleNumber: number;
  dueDate: Date;
  status: "PENDING";
  revisionNumber: number;
}): Promise<{ id: string } | null> {
  try {
    return await prisma.assignment.create({ data, select: { id: true } });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return null; // zaten var
    }
    throw err;
  }
}

/**
 * Resolves the final target user set for a plan =
 *   explicit userIds ∪ users having any of the plan's jobTitles.
 */
export async function resolvePlanTargets(planId: string, explicitUserIds: string[] = []) {
  const plan = await prisma.trainingPlan.findUniqueOrThrow({
    where: { id: planId },
    include: { jobTitles: true },
  });
  const jobTitleIds = plan.jobTitles.map((j) => j.jobTitleId);
  // JobTitle ile otomatik atanan kullanıcılar: yalnızca aktif USER rolü.
  // MANAGER/ADMIN rolündeki kişiler otomatik kapsama girmez — kurs sahibi
  // veya yönetici olan kişilere aynı eğitimi otomatik atamak istemiyoruz.
  // Explicit userIds yine de kabul edilir (admin bilinçli olarak eklemişse).
  const fromJobs = jobTitleIds.length
    ? await prisma.userJobTitle.findMany({
        where: {
          jobTitleId: { in: jobTitleIds },
          user: { role: "USER", isActive: true },
        },
        select: { userId: true },
      })
    : [];
  const ids = new Set<string>([...explicitUserIds, ...fromJobs.map((r) => r.userId)]);
  return [...ids];
}

/** Create cycle-1 assignment for each targeted user if missing. */
export async function materializeAssignmentsForPlan(planId: string, userIds: string[]) {
  if (!userIds.length) return { created: 0 };
  const plan = await prisma.trainingPlan.findUniqueOrThrow({
    where: { id: planId },
    include: { course: { select: { currentRevision: true } } },
  });
  // Yeni atanan kullanıcıya her zaman bugünden itibaren dueInDays gün tanınır.
  // Plan'ın orijinal startDate'i rapor/geçmiş amaçlı kalır; atamanın sayacı
  // kullanıcıya o planın kapsamına girdiği anda başlar.
  const due = addDays(new Date(), plan.dueInDays);
  const rev = plan.course.currentRevision;
  let created = 0;
  for (const uid of userIds) {
    const res = await createAssignmentIfAbsent({
      planId,
      userId: uid,
      cycleNumber: 1,
      dueDate: due,
      status: "PENDING",
      revisionNumber: rev,
    });
    if (!res) continue; // zaten vardı
    created++;
    await safeNotify(res.id);
  }
  return { created };
}

/**
 * Called when a user's job-titles change (or user is newly added with job-titles).
 * Enrolls the user into all active plans that target any of their job titles.
 */
export async function enrollUserIntoJobTitlePlans(userId: string) {
  const links = await prisma.userJobTitle.findMany({
    where: { userId },
    select: { jobTitleId: true },
  });
  if (!links.length) return { enrolled: 0 };
  const jobTitleIds = links.map((l) => l.jobTitleId);
  const plans = await prisma.trainingPlan.findMany({
    where: { isActive: true, jobTitles: { some: { jobTitleId: { in: jobTitleIds } } } },
    include: { course: { select: { currentRevision: true } } },
  });
  let enrolled = 0;
  for (const p of plans) {
    // Kullanıcı plana ne zaman girdiyse sayaç o anda başlar: bugün + dueInDays.
    const due = addDays(new Date(), p.dueInDays);
    const res = await createAssignmentIfAbsent({
      planId: p.id,
      userId,
      cycleNumber: 1,
      dueDate: due,
      status: "PENDING",
      revisionNumber: p.course.currentRevision,
    });
    if (!res) continue;
    enrolled++;
    await safeNotify(res.id);
  }
  return { enrolled };
}

export async function rollForwardRecurringAssignments(now = new Date()) {
  const horizon = addDays(now, 30);
  // Yalnızca önümüzdeki 30 gün içinde yenilenecek olan tamamlanmış atamaları
  // tara. Bir sonraki periyodun tarihi = completedAt + recurrence; en sık
  // tekrar 6 ay (~180 gün) olduğu için, completedAt < now - 150 gün olanlar
  // zaten horizon'un dışına düşer. DB tarafında kaba bir eleme yapıp hafızaya
  // daha az satır çekiyoruz — büyük veri setlerinde kritik.
  const earliestCompletedAt = addDays(now, -365 * 2 - 30); // en uzun recurrence 2 yıl
  const completed = await prisma.assignment.findMany({
    where: {
      status: "COMPLETED",
      completedAt: { gte: earliestCompletedAt, not: null },
      plan: { recurrence: { not: "NONE" } },
    },
    include: { plan: { include: { course: { select: { currentRevision: true } } } } },
  });
  let created = 0;
  for (const a of completed) {
    const next = nextDueDate(a.completedAt!, a.plan.recurrence, a.plan.dueInDays);
    if (!next || next > horizon) continue;
    const res = await createAssignmentIfAbsent({
      planId: a.planId,
      userId: a.userId,
      cycleNumber: a.cycleNumber + 1,
      dueDate: next,
      status: "PENDING",
      // A new cycle always picks up the *current* course revision — this is
      // how periodic retraining picks up content updates automatically.
      revisionNumber: a.plan.course.currentRevision,
    });
    if (res) created++;
  }
  return { created };
}

export async function markOverdue(now = new Date()) {
  const { count } = await prisma.assignment.updateMany({
    where: {
      dueDate: { lt: now },
      status: { in: ["PENDING", "IN_PROGRESS", "EXAM_FAILED", "RETAKE_REQUIRED"] },
    },
    data: { status: "OVERDUE" },
  });
  return { overdue: count };
}
