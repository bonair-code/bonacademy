# BonAcademy

Bon Air şirket içi **eğitim yönetim sistemi (LMS)**. SCORM tabanlı kurslar, şirket içi sınav modülü, otomatik tekrar planlaması, Microsoft 365 SSO ve rol bazlı erişim.

## Özellikler
- Microsoft 365 / Azure AD SSO (NextAuth)
- 3 rol: **Admin**, **Yönetici (Manager)**, **Kullanıcı**
- SCORM 1.2 & 2004 paketleri (zip yükleme → Azure Blob)
- SCORM oynatıcı (`scorm-again`) + CMI veri saklama
- Şirket içi sınav (soru bankası, rastgele seçim, **2 başarısızlıkta eğitim tekrarı**)
- Tekrar sıklığı: 6 ay / 1 yıl / 2 yıl + başlangıç tarihi
- E-posta bildirim (atama + 7 gün/1 gün hatırlatma + ICS eki)
- PDF sertifika (`@react-pdf/renderer`)
- Excel rapor dışa aktarma
- Audit log
- Kullanıcı sadece kendi atamalarını görür; yönetici kendi departmanını görür

## Teknoloji
Next.js 15 + TypeScript · PostgreSQL + Prisma · NextAuth (Azure AD) · Tailwind · scorm-again · Azure Blob Storage · pg-boss (cron) · nodemailer · ExcelJS · @react-pdf/renderer

## Kurulum

```bash
# 1. Bağımlılıklar
npm install

# 2. .env dosyasını oluştur
cp .env.example .env
# DATABASE_URL, AUTH_AZURE_AD_*, AZURE_STORAGE_*, SMTP_* değerlerini doldur

# 3. DB
npx prisma migrate dev --name init
npm run db:seed

# 4. Dev sunucu
npm run dev

# 5. (Ayrı terminal) Arka plan işçisi
npm run jobs:worker
```

## Azure Kurulum (Özet)
1. **Azure AD App Registration** → redirect URI: `https://<APP>/api/auth/callback/microsoft-entra-id`
2. **Azure Database for PostgreSQL Flexible Server** (B2s ile başla, yükle ölçeklenir)
3. **Azure Blob Storage** + `scorm-packages` container
4. **Azure App Service** (Linux, Node 20+) — Next.js deploy
5. Worker ayrı App Service veya Azure Container Apps olarak

## Doğrulama (E2E Akış)
1. Admin `/admin/courses` → yeni kurs ekle → SCORM zip yükle
2. Admin `/admin/courses/<id>` → sınav ayarları + 10 soru gir
3. Admin `/admin/users` → kullanıcı ekle
4. Admin `/admin/plans` → plan oluştur (kurs + kullanıcı + tekrar)
5. Kullanıcı SSO ile giriş → dashboard'da atamayı görür
6. Kursu tamamlar → sınav → **2 kez başarısız olursa** `RETAKE_REQUIRED` → kurs baştan
7. Geçerse sertifika `/api/certificate/<id>` üzerinden indirilir
8. Tekrar periyodu gelince `jobs:worker` yeni döngüyü otomatik oluşturur
9. Admin `/admin/reports` → Excel raporu indirir

## Test
```bash
npm test              # Vitest birim testler
npm run test:e2e      # Playwright E2E (yapılandırma eklenmeli)
npm run typecheck
```

## Planlanan İş Akışı (Milestone'lar)
- [x] M1 — İskelet (Auth, RBAC, DB schema)
- [x] M2 — Kurs & SCORM
- [x] M3 — Planlama & tekrar
- [x] M4 — Sınav modülü + 2-fail kuralı
- [x] M5 — Bildirim + Sertifika + Excel
- [ ] M6 — Kapsamlı testler + audit log UI
- [ ] M7 — Azure CI/CD + UAT
