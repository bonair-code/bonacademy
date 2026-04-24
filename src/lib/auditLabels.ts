// AuditAction string kodlarını Türkçe, insan okunur etiketlere çevirir.
// Denetim sayfası ve drawer'lar tarafından kullanılır. Bilinmeyen kod
// olduğunda ham kod döner — yeni bir action eklendiğinde buraya da
// eklenmediyse hâlâ görünür kalır (sessiz kayıp yok).

const LABELS: Record<string, string> = {
  "course.create": "Kurs oluşturuldu",
  "course.update": "Kurs güncellendi",
  "course.delete": "Kurs silindi",
  "course.owner.change": "Sorumlu yönetici değişti",
  "course.scorm.upload": "SCORM paketi yüklendi",
  "plan.create": "Plan oluşturuldu",
  "plan.update": "Plan güncellendi",
  "plan.delete": "Plan silindi",
  "user.create": "Kullanıcı oluşturuldu",
  "user.update": "Kullanıcı güncellendi",
  "user.role.change": "Rol değişti",
  "user.manager.change": "Yönetici değişti",
  "user.activate": "Kullanıcı aktif edildi",
  "user.deactivate": "Kullanıcı pasif edildi",
  "user.delete": "Kullanıcı silindi",
  "question.bulk.import": "Toplu soru içe aktarımı",
  "question.create": "Soru eklendi",
  "question.delete": "Soru silindi",
  "revision.create": "Yeni revizyon",
  "certificate.template.update": "Sertifika şablonu güncellendi",
  "assignment.voluntary-retake": "Eğitim tekrarı (gönüllü)",
  "assignment.manager-retake": "Eğitim tekrarı (yönetici talebi)",
};

export function auditActionLabel(action: string): string {
  return LABELS[action] ?? action;
}

// Entity kodu → Türkçe (URL tablosu tarafında gösterim için).
const ENTITY_LABELS: Record<string, string> = {
  Course: "Kurs",
  TrainingPlan: "Plan",
  User: "Kullanıcı",
  Question: "Soru",
  QuestionBank: "Soru Bankası",
  CourseRevision: "Revizyon",
  OrganizationSettings: "Kurum Ayarları",
  Assignment: "Atama",
};

export function auditEntityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity;
}

// Mevcut tüm action kodları — filtre <select> için.
export const ALL_AUDIT_ACTIONS: ReadonlyArray<string> = Object.keys(LABELS);
export const ALL_AUDIT_ENTITIES: ReadonlyArray<string> = Object.keys(ENTITY_LABELS);
