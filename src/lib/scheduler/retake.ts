import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { addDays } from "date-fns";
import { audit } from "@/lib/audit";
import { sendAssignmentCreatedMail } from "@/lib/notifications/dispatcher";
import { sendMail, appUrl, escapeHtml } from "@/lib/notifications/mailer";
import { fmtTrDate } from "@/lib/dates";

// Kurs için aktif (tamamlanmamış) bir döngü varsa yeni tekrar açılmamalı.
const ACTIVE_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "SCORM_COMPLETED",
  "EXAM_FAILED",
  "RETAKE_REQUIRED",
  "OVERDUE",
] as const;

export type RetakeResult =
  | { ok: true; assignmentId: string }
  | { ok: false; reason: "ALREADY_ACTIVE" | "NOT_FOUND" | "FORBIDDEN" | "INVALID" };

/**
 * Mevcut (tamamlanmış) bir atamadan yeni bir tekrar döngüsü oluşturur.
 * Hem "kullanıcı gönüllü tekrar" hem de "yönetici zorunlu tekrar" akışı
 * bu fonksiyonu kullanır.
 *
 * Güvenlik kuralları:
 *   - Kaynak assignment COMPLETED olmalı (aksi hâlde zaten aktif bir döngü var).
 *   - Aynı plan+user için başka bir aktif döngü varsa reddedilir (mükerrer
 *     atamaları engellemek, kötüye kullanıma karşı).
 *   - dueDate: yönetici elle girerse o, yoksa bugün + planın dueInDays kadarı.
 */
export async function createRetakeAssignment(opts: {
  sourceAssignmentId: string;
  triggeredBy: "VOLUNTARY" | "MANAGER_REQUESTED";
  triggeredById: string;
  reason?: string | null;
  customDueDate?: Date | null;
}): Promise<RetakeResult> {
  const src = await prisma.assignment.findUnique({
    where: { id: opts.sourceAssignmentId },
    include: {
      plan: { include: { course: { select: { currentRevision: true, title: true } } } },
      user: { select: { id: true, name: true, email: true, managerId: true } },
    },
  });
  if (!src) return { ok: false, reason: "NOT_FOUND" };
  if (src.status !== "COMPLETED") return { ok: false, reason: "INVALID" };

  // Aynı plan+user için aktif döngü var mı?
  const active = await prisma.assignment.findFirst({
    where: {
      planId: src.planId,
      userId: src.userId,
      status: { in: [...ACTIVE_STATUSES] },
    },
    select: { id: true },
  });
  if (active) return { ok: false, reason: "ALREADY_ACTIVE" };

  const now = new Date();
  const due =
    opts.customDueDate && opts.customDueDate > now
      ? opts.customDueDate
      : addDays(now, src.plan.dueInDays);

  // Sonraki cycleNumber: mevcut en büyük + 1 (yarış güvenli — unique ihlali
  // yakalanır).
  const latest = await prisma.assignment.findFirst({
    where: { planId: src.planId, userId: src.userId },
    orderBy: { cycleNumber: "desc" },
    select: { cycleNumber: true },
  });
  const nextCycle = (latest?.cycleNumber ?? src.cycleNumber) + 1;

  let created: { id: string } | null = null;
  try {
    created = await prisma.assignment.create({
      data: {
        planId: src.planId,
        userId: src.userId,
        cycleNumber: nextCycle,
        dueDate: due,
        status: "PENDING",
        revisionNumber: src.plan.course.currentRevision,
        triggeredBy: opts.triggeredBy,
        triggeredById: opts.triggeredById,
        triggerReason: opts.reason ?? null,
      },
      select: { id: true },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Çok nadir yarış: tam aramızda başka bir kanal aynı cycle'ı yarattı.
      return { ok: false, reason: "ALREADY_ACTIVE" };
    }
    throw err;
  }

  // Audit
  const auditAction =
    opts.triggeredBy === "VOLUNTARY"
      ? "assignment.voluntary-retake"
      : "assignment.manager-retake";
  await audit({
    actorId: opts.triggeredById,
    action: auditAction,
    entity: "Assignment",
    entityId: created.id,
    metadata: {
      planId: src.planId,
      targetUserId: src.userId,
      cycleNumber: nextCycle,
      sourceAssignmentId: src.id,
      reason: opts.reason ?? null,
      dueDate: due.toISOString(),
    },
  });

  // Mail
  if (opts.triggeredBy === "VOLUNTARY") {
    // Standart yeni-atama maili yeterli.
    try {
      await sendAssignmentCreatedMail(created.id);
    } catch (err) {
      console.error("[retake] voluntary mail failed", err);
    }
  } else {
    // Yönetici zorunlu: özel mail — kullanıcıya sebep ve yönetici adını göster.
    try {
      const mgr = await prisma.user.findUnique({
        where: { id: opts.triggeredById },
        select: { name: true },
      });
      const userName = escapeHtml(src.user.name);
      const courseTitle = escapeHtml(src.plan.course.title);
      const mgrName = escapeHtml(mgr?.name ?? "Yöneticiniz");
      const reasonHtml = opts.reason
        ? `<p><b>Sebep:</b> ${escapeHtml(opts.reason)}</p>`
        : "";
      await sendMail({
        to: src.user.email,
        subject: `Eğitim tekrarı istendi: ${src.plan.course.title}`,
        html: `<p>Merhaba ${userName},</p>
          <p><b>${mgrName}</b>, <b>${courseTitle}</b> eğitimini tekrar tamamlamanızı istedi.</p>
          ${reasonHtml}
          <p>Son tarih: <b>${fmtTrDate(due)}</b></p>
          <p><a href="${appUrl(`/course/${created.id}`)}">Eğitime başla</a></p>`,
      });
    } catch (err) {
      console.error("[retake] manager mail failed", err);
    }
  }

  return { ok: true, assignmentId: created.id };
}

/**
 * Yönetici/admin kullanıcı üzerinde tekrar isteyebilir mi?
 * - ADMIN: herkes
 * - MANAGER: sadece kendi managerId'sine bağlı olanlar
 */
export async function canRequestRetakeFor(
  requester: { id: string; role: "ADMIN" | "MANAGER" | "USER" },
  targetUserId: string
): Promise<boolean> {
  if (requester.role === "ADMIN") return true;
  if (requester.role !== "MANAGER") return false;
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { managerId: true },
  });
  return target?.managerId === requester.id;
}
