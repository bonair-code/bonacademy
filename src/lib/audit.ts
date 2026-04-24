import { prisma } from "@/lib/db";

// Admin/yönetici eylemleri için sabit olay etiketleri — grep kolaylığı ve
// raporlarda tutarlı gruplama için burada toplanır.
export type AuditAction =
  | "course.create"
  | "course.update"
  | "course.delete"
  | "course.owner.change"
  | "course.scorm.upload"
  | "plan.create"
  | "plan.update"
  | "plan.delete"
  | "user.create"
  | "user.update"
  | "user.role.change"
  | "user.manager.change"
  | "user.activate"
  | "user.deactivate"
  | "user.delete"
  | "question.bulk.import"
  | "question.create"
  | "question.delete"
  | "revision.create"
  | "certificate.template.update"
  | "assignment.voluntary-retake"
  | "assignment.manager-retake"
  | "user.invite.send"
  | "user.invite.complete"
  | "user.password.reset";

// Audit yazımı silent fail — kritik işin sonrasında çağrılır, hata çalışmayı
// durdurmamalı. Yine de console'a düşer ki izlensin.
export async function audit(opts: {
  actorId: string;
  action: AuditAction;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: opts.actorId,
        action: opts.action,
        entity: opts.entity,
        entityId: opts.entityId,
        metadata: opts.metadata ? (opts.metadata as object) : undefined,
      },
    });
  } catch (err) {
    console.error("[audit] write failed", opts.action, err);
  }
}
