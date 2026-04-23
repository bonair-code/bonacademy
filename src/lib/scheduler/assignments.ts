import { prisma } from "@/lib/db";
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
 * Resolves the final target user set for a plan =
 *   explicit userIds ∪ users having any of the plan's jobTitles.
 */
export async function resolvePlanTargets(planId: string, explicitUserIds: string[] = []) {
  const plan = await prisma.trainingPlan.findUniqueOrThrow({
    where: { id: planId },
    include: { jobTitles: true },
  });
  const jobTitleIds = plan.jobTitles.map((j) => j.jobTitleId);
  const fromJobs = jobTitleIds.length
    ? await prisma.userJobTitle.findMany({
        where: { jobTitleId: { in: jobTitleIds } },
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
    // Önce var mı bak: yoksa yarat ve mail at; varsa hiç mail atma.
    const existing = await prisma.assignment.findUnique({
      where: { planId_userId_cycleNumber: { planId, userId: uid, cycleNumber: 1 } },
    });
    if (existing) continue;
    const res = await prisma.assignment.create({
      data: {
        planId,
        userId: uid,
        cycleNumber: 1,
        dueDate: due,
        status: "PENDING",
        revisionNumber: rev,
      },
    });
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
    const existing = await prisma.assignment.findUnique({
      where: { planId_userId_cycleNumber: { planId: p.id, userId, cycleNumber: 1 } },
    });
    if (existing) continue;
    const res = await prisma.assignment.create({
      data: {
        planId: p.id,
        userId,
        cycleNumber: 1,
        dueDate: due,
        status: "PENDING",
        revisionNumber: p.course.currentRevision,
      },
    });
    enrolled++;
    await safeNotify(res.id);
  }
  return { enrolled };
}

export async function rollForwardRecurringAssignments(now = new Date()) {
  const horizon = addDays(now, 30);
  const completed = await prisma.assignment.findMany({
    where: { status: "COMPLETED", completedAt: { not: null } },
    include: { plan: { include: { course: { select: { currentRevision: true } } } } },
  });
  let created = 0;
  for (const a of completed) {
    const next = nextDueDate(a.completedAt!, a.plan.recurrence, a.plan.dueInDays);
    if (!next || next > horizon) continue;
    const exists = await prisma.assignment.findUnique({
      where: {
        planId_userId_cycleNumber: {
          planId: a.planId,
          userId: a.userId,
          cycleNumber: a.cycleNumber + 1,
        },
      },
    });
    if (exists) continue;
    await prisma.assignment.create({
      data: {
        planId: a.planId,
        userId: a.userId,
        cycleNumber: a.cycleNumber + 1,
        dueDate: next,
        status: "PENDING",
        // A new cycle always picks up the *current* course revision — this is
        // how periodic retraining picks up content updates automatically.
        revisionNumber: a.plan.course.currentRevision,
      },
    });
    created++;
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
