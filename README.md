# Capella Academy — Firebase-native

Capella Aviation Solutions eğitim yönetim sistemi (LMS). BonAcademy'nin ayrı
kurulum (fork) kopyasıdır: ayrı Firebase projesi, ayrı veri, ayrı sertifika
serisi. Marka (logo, lacivert palet, kurum künyesi) CAPELLA'ya göre ayarlandı;
kurulum adımları ve açık kalan değerler için bkz. `docs/CAPELLA-KOPYASI.md`.

## Stack
- **Arayüz:** React SPA (Vite) — Firebase Hosting'de statik, tarayıcı Firestore'u
  doğrudan okur (SMS-stili → cold start yok). SMS house-style, CAPELLA lacivertiyle.
- **Veri:** Firestore  ·  **Auth:** Firebase Auth (Microsoft SSO + rol claim'leri)
- **Dosya:** Cloud Storage (SCORM paketleri + sertifika PDF'leri)
- **Sunucu mantığı:** Cloud Functions (sınav puanlama, sertifika, cron, rapor)

## Klasör planı
```
web/            React SPA (Vite)  — sonraki faz
functions/      Cloud Functions   — sonraki faz
firestore.rules        RBAC + sınav anti-hile   ✅ taslak
storage.rules          dosya erişim kuralları    ✅ taslak
firestore.indexes.json bileşik indexler          ✅ taslak
firebase.json          hosting/firestore/functions/emulator config ✅
docs/DATA_MODEL.md     Firestore veri modeli     ✅ taslak
```

## Yol haritası (fazlı — her faz çalışır halde)
- [x] **Faz 0 — Temel:** veri modeli + Security Rules + proje config
- [ ] **Faz 1 — Auth & RBAC:** Firebase Auth (Microsoft SSO), rol custom claim'leri, kabuk UI
- [ ] **Faz 2 — Kurs & SCORM:** kurs CRUD, SCORM yükleme→Storage, oynatıcı (`scorm-again`), same-origin içerik servisi
- [ ] **Faz 3 — Sınav:** `startExam`/`submitExam` Functions (cevapsız servis + sunucu puanlama), 2-başarısızlık kuralı
- [ ] **Faz 4 — Planlama/tekrar/bildirim:** scheduled Function
- [ ] **Faz 5 — Sertifika + rapor + audit + kalan ekranlar**
- [ ] **Faz 6 — Veri taşıma (eskisinden) + geçiş (cutover)**

## Güvenlik notları (eski denetimin dersleri)
- Soru cevapları normal kullanıcıya okunmaz; sınav Function'dan cevapsız gelir, sunucu puanlar
- Sertifika/durum geçişleri yalnızca Function yazar (self-issue/atlatma engeli)
- MANAGER yalnızca kendi departmanı/kurslarıyla sınırlı (rules + Function kapsamı)
