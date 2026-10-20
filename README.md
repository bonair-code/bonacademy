# BonAcademy

BonAir Aviation'ın eğitim yönetim sistemi (LMS). Canlı:
**https://academy.bonair.com.tr** (ayrıca `bonair-academy.web.app`).

Kimin hangi eğitimi aldığını, ne zaman süresinin dolacağını ve SHT-145
denetiminde gösterilecek sertifikayı tek yerde tutar. Online eğitim (PDF,
video, SCORM + sınav), sınıf eğitimi (QR'lı yoklama) ve dışarıdan alınmış
belgeler aynı uygunluk tablosunda birleşir.

## Nasıl çalışıyor

- **Arayüz:** React SPA (Vite + TypeScript + Tailwind), Firebase Hosting'de
  statik. Tarayıcı Firestore'u doğrudan dinliyor — sunucu beklemesi yok,
  tablolar canlı güncelleniyor.
- **Veri:** Firestore. Erişimin tamamı `firestore.rules`'ta; **sorgular
  kapsamlı olmak zorunda** (müdür kendi departmanını süzmeden sorgu açarsa
  kural reddeder).
- **Giriş:** Firebase Auth e-posta/şifre + rol `custom claim`'leri
  (ADMIN · MANAGER · INSTRUCTOR · USER · CUSTOMER). BonAir Technic
  Uygulama Merkezi'nden gelenler tek kullanımlık biletle giriyor
  (`functions/src/sso.js`, yönlendirmeyle — iframe değil).
- **Dosya:** Cloud Storage (SCORM paketleri, eğitim materyali, dış belgeler).
  SCORM paketi `/scorm-content` üzerinden aynı kökenden servis ediliyor,
  çünkü paket LMS API'sini `window.parent`'ta arıyor.
- **Sunucu mantığı:** 30 Cloud Function (`europe-west3`) — sınav puanlama,
  sertifika numarası, yayın denetimi, atama, sınıf oturumu, SCORM servisi.
  Kullanıcıya puan ya da sertifika yazdıran hiçbir yol istemcide değil.

## Klasörler

```
web/                  React SPA (19 sayfa)
functions/            Cloud Functions (TypeScript)
scripts/              tek seferlik veri betikleri (içe aktarma, düzeltme, temizlik)
firestore.rules       RBAC + sınav anti-hile
storage.rules         dosya erişimi
firestore.indexes.json
firebase.json         hosting / functions / güvenlik başlıkları
storage.cors.json     kovanın tanıdığı adresler (deploy ETMEZ — ayrı betik)
docs/DATA_MODEL.md    Firestore veri modeli
docs/BACKLOG.md       açık maddeler ve karar kaydı
```

## Geliştirme

```bash
cd web && npm install && npm run dev     # http://localhost:5173
cd functions && npm install && npm run build
```

Deploy öncesi **önce `git fetch`**: bu depoya başka makineden de commit
geliyor, eski ağaçtan hosting dağıtmak canlıyı geriye alır.

```bash
npm run build --prefix web
firebase deploy --project bonair-academy
```

Windows'ta deploy "fetch failed" derse:
`NODE_OPTIONS=--dns-result-order=ipv4first firebase deploy ...`

## Bilinmesi gerekenler

- **E-posta KAPALI.** Davet, atama bildirimi, hatırlatma, geçici şifre ve
  sertifika PDF'i kodu hazır ama gönderim kapalı: `functions/.env` →
  `MAIL_ENABLED=false` ve `web/src/lib/features.ts` → `MAIL_ENABLED = false`.
  İkisi birlikte açılır. Açmadan önce yapılacaklar `docs/BACKLOG.md` →
  "E-posta altyapısı" — özellikle `functions/src/certPdf.ts` BonAir
  sertifikasına göre yeniden çizilmeli. Giriş ekranındaki
  "Forgot password?" bundan bağımsız, çalışıyor.
- **İçi boş eğitim yayına alınamaz.** `publishCourse` bölümü, içeriği ve
  (sınavlıysa) soru bankasını sunucuda denetler; `isActive` istemciden
  yazılamaz.
- **Yeni alan adı bağlanınca** `storage.cors.json`'a eklenip
  `node scripts/apply-storage-cors.js` çalıştırılmalı — yoksa PDF'ler
  "Failed to fetch" diye düşer ve sebebi yalnızca konsolda görünür.
- **Sertifika tasarımı iki yerde:** ekran `web/src/components/CertificateSheet.tsx`,
  sunucudaki PDF `functions/src/certPdf.ts`. Biri değişirse diğeri de değişmeli.
- `npm run lint` (web) yalnızca `react-hooks/rules-of-hooks`'u hata sayar;
  bu kural bir kez beyaz ekrana yol açtı (erken `return`'den sonra kanca).

## Güvenlik kararları

- Soru cevapları istemciye hiç gitmiyor; sınav Function'dan cevapsız geliyor,
  puanlamayı sunucu yapıyor.
- Sertifika ve durum geçişlerini yalnız Function yazıyor.
- MANAGER yalnız kendi departmanıyla sınırlı (hem kural hem Function tarafında).
- Giriş hatası hesabın var olup olmadığını sızdırmıyor — yanlış şifre ile
  olmayan hesap aynı mesajı alıyor.
- CSP şu an `Report-Only`; zorunluya çevirme maddesi `docs/BACKLOG.md`'de.
