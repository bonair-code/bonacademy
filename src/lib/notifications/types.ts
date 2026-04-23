// Notification.type alanı için merkezi sentinel üreticileri.
//
// Neden buraya taşıdık: önceden dispatcher'da elle "reminder:7" /
// "reminder:${days}" gibi string concat kullanılıyordu. Bir typo (ör.
// "reminder:07" veya "reminder-7") dedup'ı kırar ve kullanıcıya aynı mail
// ikinci kez gönderilir. Tek yerde builder kullanarak bu yüzey kapatıldı:
// tip sistemi yanlış argümanı derleme anında yakalar.

export type AssignmentNotifyKind =
  | "new"
  | "reminder-7"
  | "reminder-1"
  | "overdue-user";

/** Kullanıcıya yönelik atama bildirimlerinin sentinel'i. */
export function assignmentNotifyType(
  assignmentId: string,
  kind: AssignmentNotifyKind
): string {
  return `assignment:${assignmentId}:${kind}`;
}

/** Yöneticiye "ekibimden birinin son tarihi yaklaşıyor" bildirimi (7 gün kala). */
export function assignmentManagerReminder7Type(
  assignmentId: string,
  managerId: string
): string {
  return `assignment:${assignmentId}:manager-reminder-7:${managerId}`;
}

/** Kalan-gün değerinden doğru reminder kind'ını üretir. */
export function reminderKind(daysLeft: 7 | 1): AssignmentNotifyKind {
  return daysLeft === 7 ? "reminder-7" : "reminder-1";
}
