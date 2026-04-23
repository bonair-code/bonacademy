import { prisma } from "@/lib/db";
import { sendMail, appUrl, escapeHtml } from "./mailer";
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
 * Geçerli bir e-posta adresi mi? Çok sıkı değil — sadece boş/whitespace ve
 * açıkça geçersiz string'leri eler. Amaç: `sendMail` çağrılmadan önce
 * sentinel yakmamak.
 */
function isValidEmail(s: string | null | undefined): s is string {
  if (!s) return false;
  const trimmed = s.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Önce maili gönderir, SONRA sentinel'i (userId+type) yazar. Böylece SMTP
 * hatası olursa sentinel yanmaz ve bir sonraki cron tetiği mail'i yeniden
 * dener. @@unique(userId,type) çakışması = zaten gönderilmiş; sessizce çıkar.
 *
 * Not: Eski uygulama "önce claim, sonra gönder" idi; SMTP hatası o bildirimi
 * kalıcı olarak öldürüyordu. Yeni sıralama "en fazla iki kez gönderim" riski
 * taşır (mail atıldı ama DB yazımı çöktü) — bu çok nadir ve iki kopya mail,
 * hiç mail gönderememekten daha kabul edilebilir.
 */
async function sendOnce(args: {
  userId: string;
  type: string;
  email: string;
  subject: string;
  html: string;
  attachments?: Parameters<typeof sendMail>[0]["attachments"];
}): Promise<boolean> {
  if (!isValidEmail(args.email)) return false;
  // Önce "zaten gönderildi mi" kontrolü — aynı cron içinde yarış yok, sadece
  // önceki çalışmadan kalma var.
  const existing = await prisma.notification.findUnique({
    where: { userId_type: { userId: args.userId, type: args.type } },
  });
  if (existing) return false;
  try {
    await sendMail({
      to: args.email,
      subject: args.subject,
      html: args.html,
      attachments: args.attachments,
    });
  } catch (err) {
    console.error("[mail] gönderim hatası", args.type, err);
    return false;
  }
  try {
    await prisma.notification.create({
      data: { userId: args.userId, type: args.type, channel: "email" },
    });
  } catch {
    // Başka bir concurrent cron tetiği tam aramızda claim etti — mail iki kez
    // gidebilir, kabul. Sessizce devam.
  }
  return true;
}

/** Yeni atandığında anında mail — plan kayıt akışından çağrılır. */
export async function sendAssignmentCreatedMail(assignmentId: string) {
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { user: true, plan: { include: { course: true } } },
  });
  if (!a) return;
  const ics = buildIcs(a.plan.course.title, a.dueDate);
  const userName = escapeHtml(a.user.name);
  const courseTitle = escapeHtml(a.plan.course.title);
  await sendOnce({
    userId: a.userId,
    type: assignmentNotifyType(a.id, "new"),
    email: a.user.email,
    subject: `Yeni eğitim atandı: ${a.plan.course.title}`,
    html: `<p>Merhaba ${userName},</p>
      <p><b>${courseTitle}</b> eğitimi size atandı. Son tarih: <b>${fmtTrDate(a.dueDate)}</b></p>
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
      const userName = escapeHtml(a.user.name);
      const userEmail = escapeHtml(a.user.email);
      const courseTitle = escapeHtml(a.plan.course.title);

      await sendOnce({
        userId: a.userId,
        type: assignmentNotifyType(a.id, reminderKind(days)),
        email: a.user.email,
        subject: `Hatırlatma: ${a.plan.course.title} (${days} gün kaldı)`,
        html: `<p>Merhaba ${userName},</p>
          <p><b>${courseTitle}</b> eğitiminin son tarihine <b>${days} gün</b> kaldı.</p>
          <p>Son tarih: ${fmtTrDate(a.dueDate)}</p>
          <p><a href="${appUrl(`/course/${a.id}`)}">Şimdi başla</a></p>`,
      });

      // Sadece 7 gün kala yöneticiyi de bilgilendir.
      if (days === 7 && a.user.manager && isValidEmail(a.user.manager.email)) {
        const mgr = a.user.manager;
        const mgrName = escapeHtml(mgr.name);
        await sendOnce({
          userId: mgr.id,
          type: assignmentManagerReminder7Type(a.id, mgr.id),
          email: mgr.email,
          subject: `Ekibinizde yaklaşan eğitim: ${a.user.name} — ${a.plan.course.title}`,
          html: `<p>Merhaba ${mgrName},</p>
            <p>Ekibinizden <b>${userName}</b> (${userEmail}) için atanan
            <b>${courseTitle}</b> eğitiminin son tarihine <b>7 gün</b> kaldı.</p>
            <p>Son tarih: <b>${fmtTrDate(a.dueDate)}</b></p>
            <p><a href="${appUrl(`/manager/team`)}">Ekibimi görüntüle</a></p>`,
        });
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
    const userName = escapeHtml(a.user.name);
    const courseTitle = escapeHtml(a.plan.course.title);
    await sendOnce({
      userId: a.userId,
      type: assignmentNotifyType(a.id, "overdue-user"),
      email: a.user.email,
      subject: `Gecikmiş eğitim: ${a.plan.course.title}`,
      html: `<p>Merhaba ${userName},</p>
        <p><b>${courseTitle}</b> eğitiminin son tarihi <b>${fmtTrDate(a.dueDate)}</b> olarak belirlenmişti ve henüz tamamlanmadı.</p>
        <p>Lütfen en kısa sürede tamamlayın:</p>
        <p><a href="${appUrl(`/course/${a.id}`)}">Eğitime git</a></p>`,
    });
  }
}
