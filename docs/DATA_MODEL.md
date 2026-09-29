# BonAcademy (Firebase-native) — Firestore Veri Modeli

> Sıfırdan Firebase-native yeniden inşa. Mimari: **React SPA (Vite) + Firestore +
> Firebase Auth (Microsoft SSO) + Cloud Storage + Cloud Functions**. Tarayıcı
> Firestore'u doğrudan okur (SMS-stili → cold start yok). Güvenlik-kritik işler
> (sınav puanlama, sertifika, durum geçişleri) Cloud Functions'ta yapılır.

## Temel ilkeler
1. **Rol = Firebase Auth custom claim.** Kullanıcı token'ında `role` (ADMIN/MANAGER/USER)
   ve `departmentId` taşınır → Security Rules `get()` çağrısı yapmadan hızlı karar verir.
2. **Denormalizasyon.** Gösterim/sorgu için gereken alanlar kopyalanır (örn. assignment
   üstünde `courseTitle`, `userDepartmentId`) — ilişkisel JOIN yok.
3. **Anti-hile:** Soru cevapları (`isCorrect`) normal kullanıcıya ASLA okunmaz. Sınavı
   bir Cloud Function servis eder (cevapsız) ve sunucu tarafında puanlar.
4. **Server-authoritative geçişler:** Sınav puanı, sertifika üretimi ve hassas durum
   geçişleri yalnızca Functions tarafından yazılır (client yazamaz).

---

## Koleksiyonlar

### `users/{uid}`  (uid = Firebase Auth UID)
```
email, name, role: 'ADMIN'|'MANAGER'|'INSTRUCTOR'|'USER', departmentId, managerId,
isActive: bool, birthDate, birthPlace, locale: 'tr'|'en',
jobTitleIds: [id...],            // = authorisation scope id'leri (M2M gömülü)
createdAt, updatedAt
```
- Okuma: kendisi · ADMIN · aynı departmandaki MANAGER
- Yazma: yalnızca Cloud Function (admin SDK). Kullanıcı sadece kendi `locale`'ini günceller.
- Rol değişince Function `role`/`departmentId` custom claim'lerini de günceller.

### `departments/{id}` → `{ name, nameEn }`
### `jobTitles/{id}` → `{ name, nameEn, requiredCourseIds: [] }`
Arayüzde **Authorisation Scope**. Koleksiyon adı geçmişten kaldı.
- Okuma: giriş yapmış herkes · Yazma: ADMIN

### `courses/{cid}`
```
title, description, isActive, currentRevision,
scorm: { packagePath, entryPoint, version: 'SCORM_12'|'SCORM_2004' },
passingScore, durationMinutes, ownerInstructorId,
exam: { questionCount, passingScore, timeLimitMin, shuffle },   // 1:1 gömülü
createdAt, updatedAt
```
- Okuma: giriş yapmış herkes (meta) · Yazma: ADMIN veya sahibi olan EĞİTMEN

  #### `courses/{cid}/questions/{qid}`  ⚠️ cevaplar gizli
  ```
  text, points, options: [{ id, text, isCorrect }]
  ```
  - Okuma/Yazma: **yalnızca** ADMIN veya kursun sahibi EĞİTMEN. Çalışan
    buraya ERİŞEMEZ — sınav sorularını cevapsız halde Function'dan alır.

  #### `courses/{cid}/revisions/{n}` → snapshot · Okuma: staff · Yazma: Function

### `plans/{pid}`  (eğitim planı)
```
courseId, courseTitle, recurrence: 'NONE'|'SIX_MONTHS'|'ONE_YEAR'|'TWO_YEARS',
startDate, dueInDays, jobTitleIds: [id...], createdById, isActive, createdAt
```
- Okuma/Yazma: staff (MANAGER kapsamı Function'da uygulanır)

### `assignments/{aid}`  (kullanıcı ↔ plan atama döngüsü)
```
planId, userId, userDepartmentId,          // dept denormalize → rules hızlı
courseId, courseTitle, revisionNumber,
cycleNumber, status: AssignmentStatus,
dueDate, startedAt, completedAt,
triggeredBy: 'AUTO'|'VOLUNTARY'|'MANAGER_REQUESTED', triggeredById, triggerReason,
createdAt
```
- Doc id = `{planId}_{userId}_{cycleNumber}` (deterministik → çift kayıt imkânsız)
- Okuma: sahibi · ADMIN · aynı departmandaki MANAGER
- Yazma: **yalnızca Function** (durum geçişleri güvenli)

  #### `assignments/{aid}/scorm/{revision}` → CMI verisi (ilerleme)
  - Okuma: sahibi/staff · Yazma: sahibi (yalnızca ilerleme; final durum Function'da)

  #### `assignments/{aid}/examSessions/{attemptNo}`  ⚠️ Function-only
  - Sunucu snapshot'ı (seçilen soru id'leri). Client OKUYAMAZ/YAZAMAZ.

  #### `assignments/{aid}/examAttempts/{attemptNo}` → `{ score, passed, answers, createdAt }`
  - Okuma: sahibi/staff · Yazma: Function

### `certificates/{id}`
```
assignmentId, userId, serialNo, pdfPath, issuedAt, templateSnapshot
```
- Okuma: sahibi · ADMIN · Yazma: **yalnızca Function** (self-issue engeli)

### `certVerify/{serialNo}`  (QR ile herkese açık doğrulama aynası — SMS pattern)
```
name, courseTitle, issuedAt, serialNo    // minimal, kişisel veri sınırlı
```
- Okuma: **herkes** (public) · Yazma: Function

### `orgSettings/singleton` → sertifika şablonu · Okuma: staff, Yazma: ADMIN
### `appOptions/{id}` → departman/unvan/opsiyon listeleri · Okuma: giriş, Yazma: ADMIN
### `notifications/{id}` → `{ userId, type, channel, sentAt }` · Function-managed
### `auditLogs/{id}` → `{ actorId, action, entity, entityId, metadata, createdAt }` · Okuma: ADMIN, Yazma: Function
### `counters/{name}` → `{ value }` (sertifika seri no monoton sayacı — SMS pattern) · Function-managed

---

## Cloud Functions (server-authoritative çekirdek)
| Function | Ne yapar |
|---|---|
| `onUserWrite` (trigger) | Rol/departman değişince custom claim günceller |
| `startExam` (callable) | Soru seçer, `examSession` snapshot yazar, **cevapsız** soruları döndürür |
| `submitExam` (callable) | Snapshot'a göre puanlar, `examAttempt` yazar, 2-başarısızlık → RETAKE kuralını uygular, geçerse sertifika üretir |
| `finalizeScorm` (callable) | SCORM tamamlanınca durumu ilerletir (yalnızca PENDING/IN_PROGRESS) |
| `issueCertificate` | PDF üretir (Storage'a), `certificates` + `certVerify` yazar, seri no sayacı |
| `runScheduler` (scheduled, günlük) | Periyodik tekrar döngüsü + gecikme + 7/1 gün hatırlatma mailleri |
| `exportReport` (callable) | Excel rapor üretir |

## Prisma → Firestore eşleme özeti
- İlişkisel FK'lar → doküman id referansı + gerekli alanların denormalizasyonu
- M2M (UserJobTitle, TrainingPlanJobTitle) → `jobTitleIds: []` dizisi (küçük olduğu için gömülü)
- Unique constraint (planId,userId,cycleNumber) → deterministik doc id
- Sunucu-taraflı sınav bütünlüğü (ExamSession) → `examSessions` alt-koleksiyonu, Function-only
- Audit/Notification/Counter → Function-managed koleksiyonlar
