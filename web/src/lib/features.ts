/**
 * Açık/kapalı özellikler. Derleme anında sabit — çalışırken değişmez.
 */

/**
 * E-posta gönderimi.
 *
 * ŞU AN KAPALI. Kod tam (davet, atama bildirimi, hatırlatma, geçici şifre,
 * sertifika PDF'i) ama gönderen adres, SPF/DKIM kayıtları ve sertifika
 * PDF'inin BonAir tasarımı hazır değil. Kapalıyken e-posta vaat eden her
 * düğme/alan gizlenir; "geçici şifreyi elden ver" akışı çalışmaya devam eder.
 *
 * AÇARKEN İKİSİ BİRLİKTE: burada `true`, `functions/.env` içinde
 * `MAIL_ENABLED=true`. Yalnız burası açılırsa arayüz göndermeyi vaat eder
 * ama sunucu göndermez. Ayrıntı: docs/BACKLOG.md → "E-posta altyapısı".
 */
// Tip bilerek `boolean`: `false` edebi tipi olsaydı TypeScript açık
// daldaki kodu hiç denetlemez, bayrak açıldığı gün derleme patlardı.
export const MAIL_ENABLED: boolean = false;
