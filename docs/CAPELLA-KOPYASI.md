# CAPELLA kopyası — devralma notu

Bu dosya, BonAcademy'nin CAPELLA için kurulacak kopyasını **ayrı bir
konuşmada** yürütmek üzere yazıldı. Amaç: o konuşmanın bu depoyu baştan
keşfetmek zorunda kalmaması.

Tarih: 07.10.2026

---

## İstenen

BonAcademy'nin aynısı CAPELLA için kurulacak. Kullanıcının tarifi:
*"kopyalayıp logosal ve renksel değişiklikler yapacağız."*

## Önce karar verilmesi gereken: kopya mı, çok kurumlu mu?

Bu seçim her şeyi belirliyor, kod yazmadan önce cevaplanmalı.

**A · Ayrı kurulum (fork)** — ayrı Firebase projesi, ayrı depo, ayrı alan adı.
Veriler, kullanıcılar, sertifika numarası serisi ve onay numarası tamamen
ayrışır; iki kurumun kaydı hiçbir noktada karışmaz. Havacılık kaydı açısından
temiz ve denetimde açıklaması kolay.
**Bedeli:** her düzeltme iki yere uygulanmak zorunda. Bu depoda son bir
haftada çıkan hata sayısı düşünülürse bu gerçek bir maliyet.

**B · Tek sistem, iki kurum (multi-tenant)** — tek bakım noktası.
**Bedeli:** kurum ayrımının *her* katmana girmesi gerekir — güvenlik
kuralları, sertifika numaralandırma sayacı, yetki kapsamları, matris
sorguları, SSO. Bugün sistemde kurum kavramı hiç yok; eklemek küçük bir iş
değil ve yanlış yapılırsa bir kurumun kaydı diğerine sızar.

> Değerlendirme: iki ayrı onaylı kuruluş (farklı onay numarası, farklı
> sertifika serisi, farklı denetçi) söz konusu olduğu için **A** daha
> savunulabilir görünüyor. Ama karar kullanıcının.

## Marka kodun neresinde?

İyi haber: belge metinleri zaten tek dosyada toplanmış.

| Yer | Ne var |
|---|---|
| `web/src/lib/org.ts` | Kurum adı, onay satırı (`TR.145.118`), form no, revizyon, alt bilgi — **sertifika ve rapor künyesinin tamamı** |
| `web/tailwind.config.js` | Marka kırmızısı `#e31e24` (brand.600) |
| `web/src/index.css` | `--brand: #e31e24`, grafit sidebar `#1c1c1e` |
| `web/public/Logo.png` | Sidebar, sertifika, rapor anteti, favicon — hepsi bu tek dosyayı kullanıyor |
| `web/public/cert-watermark.jpg` | Sertifika zeminindeki uçak filigranı |
| `web/index.html` | Sayfa başlığı ve favicon |
| `web/src/lib/firebase.ts` | Firebase proje yapılandırması |
| `functions/src/index.ts` | Hata mesajları ve bölge (`europe-west3`); sertifika serisi sayacı |
| `functions/src/sso.js` | Launcher bilet devri — CAPELLA'da karşılığı var mı, sorulmalı |
| `orgSettings/singleton` (Firestore) | Şu an yalnızca `trainingLocation: "Online"` |

Metin tarafında dağınık kalan yerler: `PublicShell`, `Login`, `Dashboard`,
`ReportSheet`, `certExcel`, `userExcel` içinde "BonAir" geçiyor — kopyada
taranmalı.

## Kopyalanmaması gerekenler

- Firestore verisi (kullanıcı, sertifika, dış eğitim kaydı) — CAPELLA kendi
  verisiyle başlar
- `counters/certificates` — sertifika numarası CAPELLA için 1'den başlamalı
- Storage içeriği (kurs materyali, sertifika dosyaları)
- `TR.145.118` onay numarası ve `BON-F145-070` form numarası

## Bu sistemde henüz bitmemiş işler

Kopya alınmadan önce bilinmeli; aynı eksikler CAPELLA'ya da taşınır:

1. Hiçbir kanaldan e-posta çıkmıyor (atama bildirimi, bitiş uyarısı, davet)
2. Süresi dolan eğitim için otomatik yenileme yok
3. SCORM'un kendi kendine tamamlanması saha testinden geçmedi
4. `/plans` ekranı boş placeholder
5. Excel'den soru yüklerken tekrar kontrolü yok

Ayrıntı: `docs/BACKLOG.md`
