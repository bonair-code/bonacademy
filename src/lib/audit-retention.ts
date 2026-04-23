import { prisma } from "@/lib/db";
import { subDays } from "date-fns";

// Denetim kayıtları için saklama süresi. ISO/iç denetim için 1 yıl yeterli;
// daha eski kayıtlar Excel arşivinden takip edilir (indirilebilir). Tabloyu
// sınırlı tutmak sorgu performansını korur.
const AUDIT_RETENTION_DAYS = 365;

/** 365 günden eski denetim kayıtlarını siler. Cron'dan çağrılır. */
export async function cleanupOldAuditLogs(now = new Date()) {
  const cutoff = subDays(now, AUDIT_RETENTION_DAYS);
  const { count } = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { purgedAuditLogs: count };
}
