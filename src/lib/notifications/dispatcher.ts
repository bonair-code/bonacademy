import { prisma } from "@/lib/db";
import { sendMail, appUrl } from "./mailer";
import { addDays, startOfDay, endOfDay, subDays } from "date-fns";
import { createEvent } from "ics";
import { fmtTrDate } from "@/lib/dates";
import {
  assignmentNotifyType,
  assignmentManagerReminder7Type,
  reminderKind,
} from "./types";

// Dedup sentinel'leri için saklama süresi. Tekrar eden atamalar, hatırlatmalar
// ve gecikme bildirimleri için 180 gün fazlasıyla yeterli; çok daha eskisine
// ihtiyaç duymuyoruz çünkü tipik bir atama en geç 30-90 gün içinde kapanır.
const NOTIFICATION_RETENTION_DAYS = 180;

/** Eski dedup kayıtlarını siler; tabloyu sınırlı tutar. Cron'dan çağrılır. */
export async function cleanupOldNotifications(now = new Date()) {
  const cutoff = subDays(now, NOTIFICATION_RETENTION_DAYS);
  const { count } = await prisma.notification.deleteMany({
    where: { sentAt: { lt: cutoff } },
  });
  return { purgedNotifications: count };
}

function buildIcs(title: string, due: Date): string | null {
  const { error, value } = createEvent({
    title: `Eğitim: ${title}`,
    start: [due.getFullYear(), due.getMonth() + 1, due.getDate(), 9, 0],
    duration: { hours: 1 },
    description: "Bon Air eğitim son tarihi",
  });
  if (error || !value) return null;
  return value;
}

/**
 * Önce sentinel'i (userId+type) UPSERT yaparak "bu bildirim gönderildi"
 * işaretini atıyoruz; sonra maili yolluyoruz. @@unique(userId,type) çakışması
 * olursa zaten gönderilmiş demektir — false döneriz ve mail atılmaz.
 */
async function claimOnce(userId: string, type: string): Promise<boolean> {
  try {
    await prisma.notification.create({
      data: { userId, type, channel: "email" },
    });
    return true;
  } catch {
    return false;
  }
}

/** Yeni atandığında anında mail — plan kayıt akışından çağrılır. */
export async function sendAssignmentCreatedMail(assignmentId: string) {
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { user: true, plan: { include: { course: true } } },
  });
  if (!a) return;
  const type = assignmentNotifyType(a.id, "new");
  const claimed = await claimOnce(a.userId, type);
  if (!claimed) return;
  const ics = buildIcs(a.plan.course.title, a.dueDate);
  await sendMail({
    to: a.user.email,
    subject: `Yeni eğitim atandı: ${a.plan.course.title}`,
    html: `<p>Merhaba ${a.user.name},</p>
      <p><b>${a.plan.course.title}</b> eğitimi size atandı. Son tarih: <b>${fmtTrDate(a.dueDate)}</b></p>
      <p><a href="${appUrl(`/course/${a.id}`)}">Eğitime başla</a></p>`,
    attachments: ics ? [{ filename: "egitim.ics", content: ics }] : undefined,
  });
}

/** Yedek: cron aynı günde yaratılmış atamaları toplu taratır (ani senkron hatası yakalandıysa). */
export async function sendNewAssignmentMails() {
  const pendings = await prisma.assignment.findMany({
    where: {
      status: "PENDING",
      createdAt: { gte: addDays(new Date(), -1) },
    },
    include: { user: true, plan: { include: { course: true } } },
  });
  for (const a of pendings) {
    await sendAssignmentCreatedMail(a.id);
  }
}

/**
 * Son tarihe 7 ve 1 gün kalanlara uyarı. Ek olarak 7 gün kala yönetici de
 * bilgilendirilir — böylece ekip üyesi gecikmeden önce yönetici haberdar
 * olur ve gerekirse takip eder.
 */
export async function sendDueReminders() {
  const now = new Date();
  for (const days of [7, 1] as const) {
    const target = addDays(now, days);
    const list = await prisma.assignment.findMany({
      where: {
        status: { in: ["PENDING", "IN_PROGRESS", "EXAM_FAILED", "RETAKE_REQUIRED"] },
        dueDate: { gte: startOfDay(target), lte: endOfDay(target) },
      },
      include: {
        user: { include: { manager: true } },
        plan: { include: { course: true } },
      },
    });
    for (const a of list) {
      const type = assignmentNotifyType(a.id, reminderKind(days));
      const claimed = await claimOnce(a.userId, type);
      if (claimed) {
        await sendMail({
          to: a.user.email,
          subject: `Hatırlatma: ${a.plan.course.title} (${days} gün kaldı)`,
          html: `<p>Merhaba ${a.user.name},</p>
            <p><b>${a.plan.course.title}</b> eğitiminin son tarihine <b>${days} gün</b> kaldı.</p>
            <p>Son tarih: ${fmtTrDate(a.dueDate)}</p>
            <p><a href="${appUrl(`/course/${a.id}`)}">Şimdi başla</a></p>`,
        });
      }

      // Sadece 7 gün kala yöneticiyi de bilgilendir.
      if (days === 7 && a.user.manager) {
        const mgr = a.user.manager;
        const mgrType = assignmentManagerReminder7Type(a.id, mgr.id);
        if (await claimOnce(mgr.id, mgrType)) {
          await sendMail({
            to: mgr.email,
            subject: `Ekibinizde yaklaşan eğitim: ${a.user.name} — ${a.plan.course.title}`,
            html: `<p>Merhaba ${mgr.name},</p>
              <p>Ekibinizden <b>${a.user.name}</b> (${a.user.email}) için atanan
              <b>${a.plan.course.title}</b> eğitiminin son tarihine <b>7 gün</b> kaldı.</p>
              <p>Son tarih: <b>${fmtTrDate(a.dueDate)}</b></p>
              <p><a href="${appUrl(`/manager/team`)}">Ekibimi görüntüle</a></p>`,
          });
        }
      }
    }
  }
}

/**
 * Son tarihi geçmiş ve hâlâ tamamlanmamış atamalar: sadece kullanıcıya mail
 * gönderilir. Yönetici zaten 7 gün kala haberdar edildi; gecikme durumunda
 * tekrar mail atmıyoruz.
 */
export async function sendOverdueMails() {
  const now = new Date();
  const list = await prisma.assignment.findMany({
    where: {
      dueDate: { lt: now },
      status: {
        in: ["PENDING", "IN_PROGRESS", "EXAM_FAILED", "RETAKE_REQUIRED", "OVERDUE"],
      },
    },
    include: {
      user: true,
      plan: { include: { course: true } },
    },
  });
  for (const a of list) {
    const userType = assignmentNotifyType(a.id, "overdue-user");
    if (await claimOnce(a.userId, userType)) {
      await sendMail({
        to: a.user.email,
        subject: `Gecikmiş eğitim: ${a.plan.course.title}`,
        html: `<p>Merhaba ${a.user.name},</p>
          <p><b>${a.plan.course.title}</b> eğitiminin son tarihi <b>${fmtTrDate(a.dueDate)}</b> olarak belirlenmişti ve henüz tamamlanmadı.</p>
          <p>Lütfen en kısa sürede tamamlayın:</p>
          <p><a href="${appUrl(`/course/${a.id}`)}">Eğitime git</a></p>`,
      });
    }
  }
}
