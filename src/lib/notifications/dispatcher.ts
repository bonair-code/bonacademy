import { prisma } from "@/lib/db";
import { sendMail, appUrl, escapeHtml } from "./mailer";
import { addDays, startOfDay, endOfDay, subDays } from "date-fns";
import { fmtDate } from "@/lib/dates";
import { createEvent } from "ics";
import {
  assignmentNotifyType,
  assignmentManagerReminder7Type,
  reminderKind,
} from "./types";

// Dedup sentinel'leri için saklama süresi.
const NOTIFICATION_RETENTION_DAYS = 180;

export async function cleanupOldNotifications(now = new Date()) {
  const cutoff = subDays(now, NOTIFICATION_RETENTION_DAYS);
  const { count } = await prisma.notification.deleteMany({
    where: { sentAt: { lt: cutoff } },
  });
  return { purgedNotifications: count };
}

type Locale = "en" | "tr";
function normLocale(l?: string | null): Locale {
  return l === "tr" ? "tr" : "en";
}

function buildIcs(title: string, due: Date, locale: Locale): string | null {
  const { error, value } = createEvent({
    title: locale === "tr" ? `Eğitim: ${title}` : `Training: ${title}`,
    start: [due.getFullYear(), due.getMonth() + 1, due.getDate(), 9, 0],
    duration: { hours: 1 },
    description: locale === "tr" ? "Bon Air eğitim son tarihi" : "Bon Air training due date",
  });
  if (error || !value) return null;
  return value;
}

function isValidEmail(s: string | null | undefined): s is string {
  if (!s) return false;
  const trimmed = s.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

async function sendOnce(args: {
  userId: string;
  type: string;
  email: string;
  subject: string;
  html: string;
  attachments?: Parameters<typeof sendMail>[0]["attachments"];
}): Promise<boolean> {
  if (!isValidEmail(args.email)) return false;
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
    // ignore
  }
  return true;
}

// --- Template builders (locale-aware) ---

function tplAssigned(L: Locale, userName: string, courseTitle: string, dueDate: string, url: string) {
  if (L === "tr") {
    return {
      subject: `Yeni eğitim atandı: ${courseTitle}`,
      html: `<p>Merhaba ${userName},</p>
        <p><b>${courseTitle}</b> eğitimi size atandı. Son tarih: <b>${dueDate}</b></p>
        <p><a href="${url}">Eğitime başla</a></p>`,
    };
  }
  return {
    subject: `New training assigned: ${courseTitle}`,
    html: `<p>Hi ${userName},</p>
      <p>The training <b>${courseTitle}</b> has been assigned to you. Due date: <b>${dueDate}</b></p>
      <p><a href="${url}">Start the training</a></p>`,
  };
}

function tplUserReminder(L: Locale, userName: string, courseTitle: string, days: number, dueDate: string, url: string) {
  if (L === "tr") {
    return {
      subject: `Hatırlatma: ${courseTitle} (${days} gün kaldı)`,
      html: `<p>Merhaba ${userName},</p>
        <p><b>${courseTitle}</b> eğitiminin son tarihine <b>${days} gün</b> kaldı.</p>
        <p>Son tarih: ${dueDate}</p>
        <p><a href="${url}">Şimdi başla</a></p>`,
    };
  }
  return {
    subject: `Reminder: ${courseTitle} (${days} day${days === 1 ? "" : "s"} left)`,
    html: `<p>Hi ${userName},</p>
      <p><b>${days} day${days === 1 ? "" : "s"}</b> left until the due date of <b>${courseTitle}</b>.</p>
      <p>Due date: ${dueDate}</p>
      <p><a href="${url}">Start now</a></p>`,
  };
}

function tplManagerReminder(L: Locale, mgrName: string, userName: string, userEmail: string, courseTitle: string, dueDate: string, url: string) {
  if (L === "tr") {
    return {
      subject: `Ekibinizde yaklaşan eğitim: ${userName} — ${courseTitle}`,
      html: `<p>Merhaba ${mgrName},</p>
        <p>Ekibinizden <b>${userName}</b> (${userEmail}) için atanan
        <b>${courseTitle}</b> eğitiminin son tarihine <b>7 gün</b> kaldı.</p>
        <p>Son tarih: <b>${dueDate}</b></p>
        <p><a href="${url}">Ekibimi görüntüle</a></p>`,
    };
  }
  return {
    subject: `Upcoming training in your team: ${userName} — ${courseTitle}`,
    html: `<p>Hi ${mgrName},</p>
      <p><b>7 days</b> left until the due date of <b>${courseTitle}</b>, assigned to your team member
      <b>${userName}</b> (${userEmail}).</p>
      <p>Due date: <b>${dueDate}</b></p>
      <p><a href="${url}">View my team</a></p>`,
  };
}

function tplOverdue(L: Locale, userName: string, courseTitle: string, dueDate: string, url: string) {
  if (L === "tr") {
    return {
      subject: `Gecikmiş eğitim: ${courseTitle}`,
      html: `<p>Merhaba ${userName},</p>
        <p><b>${courseTitle}</b> eğitiminin son tarihi <b>${dueDate}</b> olarak belirlenmişti ve henüz tamamlanmadı.</p>
        <p>Lütfen en kısa sürede tamamlayın:</p>
        <p><a href="${url}">Eğitime git</a></p>`,
    };
  }
  return {
    subject: `Overdue training: ${courseTitle}`,
    html: `<p>Hi ${userName},</p>
      <p>The due date for <b>${courseTitle}</b> was <b>${dueDate}</b> and it has not been completed yet.</p>
      <p>Please complete it as soon as possible:</p>
      <p><a href="${url}">Go to training</a></p>`,
  };
}

// --- Public API ---

export async function sendAssignmentCreatedMail(assignmentId: string) {
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { user: true, plan: { include: { course: true } } },
  });
  if (!a) return;
  const L = normLocale(a.user.locale);
  const ics = buildIcs(a.plan.course.title, a.dueDate, L);
  const tpl = tplAssigned(
    L,
    escapeHtml(a.user.name),
    escapeHtml(a.plan.course.title),
    fmtDate(a.dueDate, L),
    appUrl(`/course/${a.id}`),
  );
  await sendOnce({
    userId: a.userId,
    type: assignmentNotifyType(a.id, "new"),
    email: a.user.email,
    subject: tpl.subject,
    html: tpl.html,
    attachments: ics
      ? [{ filename: L === "tr" ? "egitim.ics" : "training.ics", content: ics }]
      : undefined,
  });
}

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
      const Lu = normLocale(a.user.locale);
      const userName = escapeHtml(a.user.name);
      const userEmail = escapeHtml(a.user.email);
      const courseTitle = escapeHtml(a.plan.course.title);

      const tplU = tplUserReminder(Lu, userName, courseTitle, days, fmtDate(a.dueDate, Lu), appUrl(`/course/${a.id}`));
      await sendOnce({
        userId: a.userId,
        type: assignmentNotifyType(a.id, reminderKind(days)),
        email: a.user.email,
        subject: tplU.subject,
        html: tplU.html,
      });

      if (days === 7 && a.user.manager && isValidEmail(a.user.manager.email)) {
        const mgr = a.user.manager;
        const Lm = normLocale(mgr.locale);
        const tplM = tplManagerReminder(
          Lm,
          escapeHtml(mgr.name),
          userName,
          userEmail,
          courseTitle,
          fmtDate(a.dueDate, Lm),
          appUrl(`/manager/team`),
        );
        await sendOnce({
          userId: mgr.id,
          type: assignmentManagerReminder7Type(a.id, mgr.id),
          email: mgr.email,
          subject: tplM.subject,
          html: tplM.html,
        });
      }
    }
  }
}

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
    const L = normLocale(a.user.locale);
    const tpl = tplOverdue(
      L,
      escapeHtml(a.user.name),
      escapeHtml(a.plan.course.title),
      fmtDate(a.dueDate, L),
      appUrl(`/course/${a.id}`),
    );
    await sendOnce({
      userId: a.userId,
      type: assignmentNotifyType(a.id, "overdue-user"),
      email: a.user.email,
      subject: tpl.subject,
      html: tpl.html,
    });
  }
}
