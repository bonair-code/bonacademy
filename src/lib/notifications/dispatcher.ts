import { prisma } from "@/lib/db";
import { sendMail } from "./mailer";
import { addDays, startOfDay, endOfDay } from "date-fns";
import { createEvent } from "ics";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

export async function sendNewAssignmentMails() {
  const pendings = await prisma.assignment.findMany({
    where: {
      status: "PENDING",
      createdAt: { gte: addDays(new Date(), -1) },
    },
    include: { user: true, plan: { include: { course: true } } },
  });
  for (const a of pendings) {
    const already = await prisma.notification.findFirst({
      where: { userId: a.userId, type: `assignment:${a.id}:new` },
    });
    if (already) continue;
    const ics = buildIcs(a.plan.course.title, a.dueDate);
    await sendMail({
      to: a.user.email,
      subject: `Yeni eğitim atandı: ${a.plan.course.title}`,
      html: `<p>Merhaba ${a.user.name},</p>
        <p><b>${a.plan.course.title}</b> eğitimi size atandı. Son tarih: ${a.dueDate.toLocaleDateString("tr-TR")}</p>
        <p><a href="${APP_URL}/course/${a.id}">Eğitime başla</a></p>`,
      attachments: ics ? [{ filename: "egitim.ics", content: ics }] : undefined,
    });
    await prisma.notification.create({
      data: { userId: a.userId, type: `assignment:${a.id}:new`, channel: "email", sentAt: new Date() },
    });
  }
}

export async function sendDueReminders() {
  const now = new Date();
  for (const days of [7, 1]) {
    const target = addDays(now, days);
    const list = await prisma.assignment.findMany({
      where: {
        status: { in: ["PENDING", "IN_PROGRESS", "EXAM_FAILED", "RETAKE_REQUIRED"] },
        dueDate: { gte: startOfDay(target), lte: endOfDay(target) },
      },
      include: { user: true, plan: { include: { course: true } } },
    });
    for (const a of list) {
      const key = `assignment:${a.id}:reminder:${days}`;
      const already = await prisma.notification.findFirst({ where: { userId: a.userId, type: key } });
      if (already) continue;
      await sendMail({
        to: a.user.email,
        subject: `Hatırlatma: ${a.plan.course.title} (${days} gün kaldı)`,
        html: `<p>${a.user.name}, <b>${a.plan.course.title}</b> eğitiminin son tarihine ${days} gün kaldı.</p>
          <p><a href="${APP_URL}/course/${a.id}">Şimdi başla</a></p>`,
      });
      await prisma.notification.create({
        data: { userId: a.userId, type: key, channel: "email", sentAt: new Date() },
      });
    }
  }
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
