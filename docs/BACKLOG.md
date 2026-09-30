# BonAcademy — Eksikler ve Yapılacaklar

> Çalışma sırasında tespit edilen açık maddeler. Tamamlananlar listeden silinir.
> Son güncelleme: 24.08.2026 (2. tur)

## 1. Veri bütünlüğünü bozan açıklar

### Kurs silince alt koleksiyonlar öksüz kalıyor
Firestore doküman silmek alt koleksiyonu silmez. `courses/{id}` silinince
`sections` ve `questions` veritabanında kalıyor; ayrıca
`jobTitles.requiredCourseIds` (= authorisation scopes) ve `externalTrainings.courseId` içinde ölü
referans oluşuyor.
**Çözüm:** özyinelemeli silme yapan `deleteCourse` Function'ı + referans temizliği.

### Atama id'si tekrar döngüsünü engelliyor
`assignCourses` doc id'yi `{userId}_{courseId}` üretiyor ve varsa atlıyor.
Bu yüzden **aynı kurs ikinci kez atanamıyor** — Validity Period alanı var ama
periyodik yenileme kurulamıyor. Veri modeli dokümanı `{planId}_{userId}_{cycleNumber}`
diyor.
**Çözüm:** id'ye `cycleNumber` ekle, yenilemede yeni döngü aç.

## 2. Hiç yazılmamış parçalar

### `runScheduler` (zamanlanmış Function) yok
Vade takibi, gecikme tespiti, 90/60/30 gün hatırlatmaları, periyodik yenileme —
hiçbiri çalışmıyor. `notifications` koleksiyonu tanımlı ama boş.

### `plans` arayüzü yok
Koleksiyon ve güvenlik kuralı var, ekran yok. `/plans` hâlâ Placeholder.

### `exportReport` yok
Excel/PDF rapor çıktısı alınamıyor.

### Denetçi onay kaydı
Doğrulama sayfası (`/verify`) ve sertifikadaki QR çalışıyor: denetçi numarayı
okutur, tarihi girer, eşleşme sonucunu görür. **Eksik:** denetçinin onayının
kayda geçmesi (`verifiedAt`, `verifiedBy`, not) — şu an doğrulama okunur,
iz bırakmıyor.

## 3. Yarım kalanlar

### Dış eğitim kaydı düzenlenemiyor
Ekle ve sil var, düzenle yok. Yanlış giren silip yeniden giriyor.

### Excel toplu soru yüklemede tekrar kontrolü yok
Aynı dosya iki kez yüklenirse sorular çiftleniyor.

### Personel bazlı lisans/yetki alanları
Takip formunda **LICENCE EXPIRE DATE** ve **AUTHORIZATION EXPIRY DATE**
kolonları var; bunlar kursa değil kişiye ait. `users` altına alan + form + matris
kolonu gerekiyor.

### SCORM tamamlama bildirimi doğrulanmadı
Adaptör ve aynı-origin servis hazır ama gerçek bir SCORM paketinin
`lesson_status` bildirdiği canlı ortamda görülmedi. Bildirmeyen eski paketler
için kaçış yolu gerekebilir.

### Sınıf oturumlarında yoklama güvenliği
Katılım formu giriş istemiyor; link (oturum id'si) parolanın kendisi. Linki bilen
biri sahte kayıt açabilir — eğitmen listeden silebiliyor ama otomatik koruma yok.
Gerekirse "eğitmen onayı" adımı eklenebilir.

### Sınıf sertifikalarında iki ayrı numara alanı
Online sertifikalar `BA-00001` monoton sayacından, sınıf sertifikaları elle
girilen `25-131` dizisinden gidiyor. İki alan çakışmıyor ama tek bir kayıt
defterinde birleştirilmeleri gerekebilir.

### Eski sertifikalarda `userDepartmentId` yok
Müdür, bu alan eklenmeden önce düzenlenmiş sertifikaları göremiyor. Geriye dönük
dolduran betik gerekiyor.

## 4. Altyapı

### Hosting'e hiç deploy edilmedi
`bonair-academy.web.app` → 404. Sistem yalnızca `localhost:5173`'te çalışıyor.

## Yetki (authorisation) modeli — 25.08.2026

Doğrulandı: kursa `requiredForScopeId` bağlandığında, o kapsamda yetkisi
olmayan personelde hücre MISSING yerine N/A oluyor. Test: "NDT familiarization
or NDT method training" → kapsam "NDT Audit"; yalnızca NDT Audit yetkisi olan
kişide MISSING, diğerlerinde N/A.

Açık işler:
- **Compliance API senkronu.** Yetkiler şu an elle giriliyor. Günlük çeken bir
  scheduled Function için gereken: base URL, kimlik doğrulama yöntemi, endpoint
  ve cevap şeması. `authorisations.source` alanı `MANUAL` / `SYNC` ayrımı için
  hazır; senkron kayıtlar `externalRef` ile eşleştirilmeli.
- **MOE analizi.** Hangi unvana hangi eğitim, hangi eğitim yetkiye bağlı —
  MOE'den çıkarılıp `jobTitles.requiredCourseIds` ve `requiredForScopeId`
  doldurulacak.
- **AUTH. EXPIRY sütunu** Training Follow-Up'a eklenebilir hale geldi.
- **Tutarsızlık:** Staff Detail pasif (`isActive: false`) kursları da zorunlu
  listeliyor; Training Follow-Up varsayılan olarak gizliyor. Şu an 14 kursun
  10'u pasif — ikisinin aynı kuralı uygulaması lazım.

## Tek kavram: Authorisation Scope — 25.08.2026

Job Title ve Authorisation Scope aynı şeydi, birleştirildi. Artık **tek liste**:
ayarlardaki *Authorisation Scopes*. Her kapsamın gerekli eğitim listesi orada
tanımlanır; kullanıcı kaydında kişiye bir veya birden fazla kapsam verilir;
zorunlu eğitim bunların birleşimidir.

Kaldırılanlar: `authScopes` koleksiyonu, kurstaki `requiredForScopeId` alanı ve
"Required For (authorisation scope)" seçicisi.

**Not:** Firestore'da koleksiyon adı hâlâ `jobTitles`, kullanıcıdaki alan
`jobTitleIds`. Veri taşıma riski almamak için yalnızca arayüz etiketleri
değiştirildi — kod okurken bu ikisi "authorisation scope" demektir.

`authorisations` koleksiyonu duruyor ama **artık zorunlu eğitim hesabına
girmiyor**; yalnızca yetki bitiş tarihi takibi için. Compliance sisteminden
günlük senkronla dolacak (`source: "SYNC"`), elle giriş yedek yol.

## Alt yetki (sub-authorisation) — 25.08.2026

Kapsamın altına tiklenebilir alt yetki katmanı eklendi. Örnek: **Auditor**
kapsamı → Procedures / Product / Quality / NDT. Kişiye kapsam verilir, altındaki
alt yetkiler kullanıcı formunda tik ile seçilir.

Zorunlu eğitim iki yerden gelir:
1. Kapsamın kendi `requiredCourseIds` listesi — o kapsamdaki **herkese**.
2. Kişide **tikli** alt yetkinin `requiredCourseIds` listesi — yalnızca ona.

Veri: `jobTitles/{id}.subScopes: [{ id, name, requiredCourseIds }]` (gömülü),
`users/{uid}.subScopeIds: [subId...]`. `createUser` / `updateUser` alanı kabul
ediyor. Kapsam kaldırılınca formda o kapsamın tikleri otomatik düşürülür.

Doğrulandı: kapsamı olmayan personelde NDT sütunu N/A; yalnızca Auditor + NDT
tikli kişide MISSING; tik Procedures'a çevrilince tekrar N/A.

Açık işler:
- **Excel toplu içe aktarmada alt yetki yok.** Şablonda yalnızca kapsam sütunu
  var; içe aktarılan kişiler alt yetkisiz gelir (fazladan eğitim zorunlu
  görünmez, güvenli taraf). Gerekirse ikinci bir sütun eklenir.
- **NDT kursu hâlâ "Technical Quality & Safety Engineer" kapsamının kendi
  gerekli eğitim listesinde.** Alt yetki mantığının işlemesi için o listeden
  çıkarılıp sadece Auditor → NDT altında bırakılmalı — aksi halde o kapsamdaki
  herkeste zorunlu kalır. Kullanıcının kararı, dokunulmadı.

## Dışarıdan alınan zorunlu eğitimler — 25.08.2026 (revize)

Bazı eğitimler sistemden verilmiyor; personel dışarıdan almak zorunda ama
takip edilmesi gerekiyor. Kursa `delivery` alanı eklendi:

- `ONLINE` (varsayılan) — bugünkü akış, içerik + isteğe bağlı sınav.
- `EXTERNAL_ONLY` — içerik ve sınav adımları hiç görünmez (sihirbaz 5 adımdan
  2'ye iner: General Information → Summary & Publish), kurs eğitim atama
  listesinde çıkmaz, Courses listesinde `EXTERNAL ONLY` rozetiyle görünür.

Takip aynı: kurs, authorisation scope'un gerekli eğitim listesine eklenir,
Training Follow-Up'ta normal sütun olarak çıkar, kişiye dış sertifika
girilince kapanır. `publishCourse` revizyon kopyasına da `delivery` yazılıyor.

Eski kayıtlarda alan yok — `?? "ONLINE"` ile okunuyor, taşıma gerekmiyor.

**Revize (aynı gün):** Kurs sihirbazındaki Delivery seçicisi kaldırıldı.
Courses sayfası artık YALNIZCA bizim verdiğimiz eğitimleri gösteriyor (online
ve sınıf). Dışarıdan alınan zorunlu eğitimler **Settings → Tracked Trainings**
bölümünden ad + geçerlilik süresi olarak tanımlanıyor ve sadece Training
Follow-Up'ta görünüyor.

Depolama değişmedi: aynı `courses` koleksiyonunda `delivery: "EXTERNAL_ONLY"`.
Bu sayede kapsam gerekli-eğitim listeleri, dış sertifika "Counts As" eşleşmesi,
geçerlilik/kalan gün hesabı ve matris tek kod yolundan çalışmaya devam ediyor —
ikinci bir koleksiyon açılsaydı hepsinin çiftlenmesi gerekirdi.

Filtreler: Courses listesi ve eğitim atama seçicisi `EXTERNAL_ONLY` olanları
dışarıda bırakıyor.

## PDF/yazdırma düzeni — 25.08.2026

Çıktı ekran görüntüsü gibi duruyordu (kenar çubuğu gizlenmiş bir web sayfası).
Artık belge düzeni:

- `components/ReportSheet.tsx` — `ReportLetterhead` (logo, kurum adı, DGCA onay
  satırı, rapor başlığı, Generated / Generated by / Scope künye tablosu) ve
  `ReportFootnote` (form no + revizyon). Shell her sayfada render eder,
  ekranda görünmez (`print-only`).
- Künye `position: fixed` olduğu için her sayfada, tablo başlıkları `thead`
  sayesinde her sayfada tekrar eder.
- Yazdırmada: uygulama kabuğu ve üst bar kalkar, kartlar düz çerçeveye döner,
  bordo gradyan bantlar açık gri satır olur, `sticky` konumlar sıfırlanır,
  `overflow`/`max-height` açılır, tablolar tam genişlik + ince çerçeve.
- Form kontrolleri (arama, filtre, butonlar) ve satır menüsü sütunları gizli.
- `printReport({ landscape })` — Training Follow-Up yatay basılır.

Training Follow-Up'taki iki filtre ("kimseye uygulanmayan sütunları gizle",
"pasif kursları dahil et") kaldırıldı; form bir uygunluk kaydı olduğu için
sistemde tanımlı tüm eğitimler her zaman görünür.

## Storage CORS — 25.08.2026

Eğitim içeriğindeki PDF açılmıyordu: "This PDF could not be displayed / Failed
to fetch". Sebep kodda değil, kovadaydı — `bonair-academy.firebasestorage.app`
kovası CORS izni tanımlı olmadığı için `localhost:5173`'ten yapılan fetch
tarayıcı tarafından engelleniyordu. PDF okuyucu (pdfjs) dosyayı fetch ile
çektiği için sayfa takibi hiç başlamıyor, dolayısıyla "I completed this
section" butonu da açılmıyordu.

Çözüm: kök dizindeki `cors.json` `gcloud storage buckets update` ile uygulandı.
İzinli origin'ler: localhost:5173, localhost:4173, bonair-academy.web.app,
bonair-academy.firebaseapp.com. Doğrulandı — fetch 200, application/pdf.

**Özel alan adı eklenirse** `cors.json`'a origin eklenip komut tekrar
çalıştırılmalı:
`gcloud storage buckets update gs://bonair-academy.firebasestorage.app --cors-file=cors.json --project=bonair-academy`

Açık iş: içerik bir sebeple yüklenemezse bölüm hiç tamamlanamıyor — kullanıcı
kilitli kalıyor. Uygunluk kaydı olduğu için kapı bilerek sıkı, ama en azından
eğitmene/adminse bir "manuel tamamlandı işaretle" yolu gerekebilir.

## Menü sadeleştirme — 25.08.2026

Kaldırılan sayfalar: **Training History**, **My Team**, **Reports**.
Dosyalar silindi: `pages/TrackingPages.tsx`, `components/Tracking.tsx`.
Rotalar `/history`, `/team`, `/reports` kaldırıldı.

My Team'in işlevi Training Follow-Up'a taşındı: matriste personel adına
tıklanınca `/team/:userId` (StaffDetail) açılıyor — eksikler, yetkiler, dış
sertifika ekleme ve kişi bazlı PDF hepsi orada. StaffDetail'in geri linki
artık Follow-Up'a dönüyor.

Kalan menü: Dashboard · My Certificates · Training Follow-Up · Courses ·
Classes · Users · Settings.

**Açık konu — adlandırma.** Kullanıcı "Courses → Online Trainings, Classes →
Face to Face Trainings" istedi; sonra ertelendi. Dikkat: sınıf oturumu
(`ClassSessions`) kursu `courses` listesinden seçiyor — yani Courses hem online
hem yüz yüze eğitimlerin TANIMINI tutuyor. "Online Trainings" adı bu yüzden
yanıltıcı olur. Seçenekler: (a) "Trainings" + "Face to Face Trainings",
(b) kursa teslim şekli alanı ekleyip listeyi ikiye bölmek.

## Authorisations paneli kaldırıldı — 25.08.2026

Kişi sayfasındaki Authorisations paneli silindi (`components/Authorisations.tsx`,
`firestore.rules` içindeki `authorisations` bloğu, `requirements.ts`'teki
`isAuthActive` / `heldScopes` / `daysToExpiry` / `dmy` / `Authorisation` tipi).

Gerekçe: yetki kapsamları artık kullanıcı kaydından (Users → Authorisation
Scopes + alt yetki tikleri) veriliyor; panel ikinci bir giriş noktasıydı ve
zorunlu eğitim hesabına zaten girmiyordu.

Yetki BİTİŞ TARİHİ takibi bu sürümde sistemde yok — compliance sisteminden
çekilecek. API senkronu yazılırken bu panel yeniden gerekirse git geçmişinden
alınabilir.

## Follow-Up hücre tasarımı — 25.08.2026

Rozet (pill) kaldırıldı; renk artık hücrenin kendisinde (`cellTone` → `<td>`).
Isı haritası etkisi: sayfaya uzaktan bakınca kırmızı kümeler öne çıkıyor.
Bantlar aynı — 90+/süresiz yeşil, 90-60 amber, 60-30 turuncu, 30-0 kırmızı,
süresi geçmiş koyu kırmızı, planlı mavi, eksik gri, N/A beyaz.
Efsane çipleri de aynı tonlara çekildi.

Ayrıca: PDF'te matris `table-layout: fixed` ile sayfaya sığdırılıyor (16 sütun
→ 1030px / A4 yatay 1032px), alt künye sayfa kenar boşluğuna alındı
(`bottom: -12mm`, `@page` alt boşluk 20mm) — son satırın üstüne binmiyor.
Sol menü `sticky top-0 h-screen` ile sabitlendi.

## 25.08.2026 akşam — Follow-Up iyileştirmeleri ve denetim taraması

**Yapılanlar**
- Yazdırmada sabit alt künye kaldırıldı; çok sayfalı çıktıda tablonun üstüne
  biniyordu. Form No / Revizyon artık ANTETTE, yani her sayfanın başında.
  Künye metni belgenin sonunda normal akışta duruyor.
- Matris hücreleri: MISSING kırmızı ve yanıp sönüyor (`.cell-missing`;
  `prefers-reduced-motion` ve yazdırmada sabit kırmızı). PLANNED turuncu.
- Sütun başlıklarındaki `INACTIVE` etiketi kaldırıldı.
- Tamamlanmış hücre artık BELGEYE bağlı: iç sertifika `/certificate/:id`,
  dış sertifika yüklenen dosya. `certificates` aboneliğine doküman id'si eklendi.
- Follow-Up filtre çubuğu: personel arama · departman · authorisation scope ·
  eğitim · durum (eksik / süresi geçmiş / 90 gün içinde dolacak / planlı /
  tamamlanmış). Başlıkta "N of M staff" gösteriliyor.

**Denetim taramasında bulunan ve giderilen iki gerçek eksik**
1. *Personel kendi dış eğitim kayıtlarını göremiyordu.* Training History
   sayfası kaldırılınca tek kaynak My Certificates kalmıştı, o da yalnızca
   `certificates` okuyordu. Sayfaya **External Training** bölümü eklendi
   (sağlayıcı, kendi sertifika no'su, tamamlanma, geçerlilik, belgeyi aç).
2. *Sertifika, eğitimin hangi kurs revizyonunda alındığını kaydetmiyordu.*
   Denetçinin ilk sorusu budur. `issueCertificateFor` artık `courseRevisionNo`
   ve `courseRevisionDate` alanlarını donduruyor; sertifikada "Training
   Revision 01 · 15.08.2026" satırı basılıyor. **Geriye dönük değil** — bu
   alan yalnızca bundan sonra üretilecek sertifikalarda olacak.

**Açık kalanlar**
- Excel toplu içe aktarmada alt yetki (sub-authorisation) sütunu yok.
- Compliance API senkronu — base URL, kimlik doğrulama, endpoint şeması bekleniyor.
- MOE analizi: hangi unvana hangi eğitim.
- Adlandırma kararı: Courses → "Trainings" mi, listeyi ikiye mi bölelim.
- İçerik yüklenemezse bölüm tamamlanamıyor; admin için manuel kapatma yolu yok.
- Follow-Up 20+ eğitim sütununda A4'e sığmayabilir; sayfa bölme mantığı gerekir.

## 26.08.2026 — Admin override ve alt yetkiye elle eğitim

**Admin "manuel tamamlandı"** — yeni Function `forceCompleteAssignment`.
Kişi sayfasında PLANNED durumdaki satırın 3 nokta menüsünde
"Mark as completed (admin)". Sadece ADMIN çağırabilir.

Kurallar:
- **Gerekçe zorunlu** (min 5 karakter). Atamaya `completedVia: "ADMIN_OVERRIDE"`,
  `overrideReason`, `overrideById`, `overrideByName`, `overrideAt` yazılır;
  sertifikaya da `issuedVia: "ADMIN_OVERRIDE"` + gerekçe düşer. Denetçi belgeden
  geriye gidebilir.
- **Sınav bütünlüğü korunur:** kursun sınavı varsa ve geçilmemişse Function
  reddediyor. Admin sınav sonucu uyduramaz — personel sınavı almak zorunda.
- Sertifika normal akıştaki gibi üretilir (seri no, dondurulmuş alanlar).

**Alt yetkiye elle eğitim yazma** — "+ Training" ekranına "Not in the list?
Type it" kutusu eklendi. Yazılan ad `delivery: "EXTERNAL_ONLY"` bir kurs olarak
kaydedilir (yani Tracked Training), aynı anda o alt yetkiye eklenir. Aynı adda
kayıt varsa yenisi açılmaz, mevcut kullanılır. Artık önce Courses'e kurs açmak
gerekmiyor.

**Not:** Tracked Trainings zaten Settings'in en altında listeleniyor ve her
satırın 3 nokta menüsünde Edit/Delete var — ad değiştirme oradan yapılıyor.
Kullanıcı bulamamıştı; bölüm sayfanın altında kaldığı için.

## Dashboard yeniden tasarımı — 26.08.2026

Eski hâli admin'e KENDİ üç atamasını sayıyordu (2 Active / 1 Completed /
0 Overdue / 3 Total). "Total" hiçbir soruya cevap vermiyordu ve bir yöneticinin
görmesi gereken şey değildi.

Yeni yapı iki bölüm, karıştırılmıyor:

1. **My training** (herkes) — yalnızca bekleyen atamalar, vadeye göre sıralı,
   sağ üstte kalan gün. Yanıp sönen buton yalnızca EN ACİL olanda — hepsi
   yanıp sönerse hiçbiri dikkat çekmiyordu. Bekleyen yoksa tek satırlık
   "Nothing pending" durumu.
2. **Organisation compliance** (admin/müdür/eğitmen; müdürde başlık
   "My department") — `lib/compliance.ts` içindeki `useCompliance` hook'u
   Follow-Up ile AYNI hesabı yapıp "kimde ne eksik" listesi üretir.
   - Uygunluk oranı: açığı olmayan personel yüzdesi + bant.
   - Dört tıklanabilir kutu: Expired · Overdue · Never taken · Due in 90 days.
     Tıklayınca alttaki liste o türe filtrelenir.
   - **Needs attention**: en acil 12 satır, tıklayınca kişinin kaydına gider.
     MISSING kayıtları kişide toplanır ("… + 9 more") — aksi hâlde tek kişi
     onlarca satır üretiyor ve liste okunmuyordu (334 satır → 60).

Eski `Upcoming` bileşeni artık kullanılmıyor; vadesi geçmiş atamalar
"Overdue" olarak bu listede. Dosya duruyor, silinmedi.

## Admin şifre sıfırlama — 26.08.2026

Yeni Function `setUserPassword` (ADMIN only). Users → satırın 3 nokta
menüsünde **Reset password**. Pencere okunabilir rastgele bir geçici şifre
üretir (yenile / kopyala düğmeleriyle), admin isterse elle de yazabilir.

- Şifre `getAuth().updateUser` ile değiştirilir.
- `mustChangePassword: true` işaretlenir — kullanıcı ilk girişte kendi
  şifresini belirlemek zorunda, adminin verdiği şifre kalıcı olmaz.
- İz: `passwordResetAt`, `passwordResetById`, `passwordResetByName`.

Doğrulandı: geçici kullanıcı açılıp şifresi sıfırlandı, `mustChangePassword`
true ve sıfırlayan adı kaydedildi; test kullanıcısı silindi.

## PDF sayfa takibi düzeltildi — 26.08.2026

**Bug:** Kullanıcı PDF'i sonuna kadar okuyor ama sayaç `0 / 4 pages read`'de
kalıyor, "I completed this section" hiç açılmıyordu.

**Sebep:** `PdfReader` sayfa takibini `IntersectionObserver` + `threshold: 0.5`
ile yapıyordu. Sayfa kutusu `max-h-[70vh]` ve bir A4 sayfası bu kutudan uzun;
yani sayfanın %50'si aynı anda görünür alanda HİÇ olamıyor → gözlemci hiç
tetiklenmiyor. Kilit bu yüzden hiç açılmıyordu.

**Çözüm:** Takip kaydırmaya bağlandı. Bir sayfanın ALT KENARI görünür alana
girdiyse o sayfa baştan sona geçilmiş sayılır; kutunun sonuna gelindiğinde
kalanlar da işaretlenir. Ölçüm `getBoundingClientRect()` ile — `offsetTop`
konumlanmış ataya göre hesaplandığından kutu içinde yanıltıcıydı.

Doğrulandı: Safety Training Syllabus (4 sayfa) sonuna kadar kaydırıldı,
sayaç 0/4 → 4/4, buton açıldı.

## Uzun PDF'te sayfa takibi — 26.08.2026

Safety Training'in 2. bölümü **216 sayfalık** bir PDF. Sayaç `0 / 216`'da
kalıyordu, bölüm tamamlanamıyordu.

**İki ayrı sebep vardı:**
1. Kaydırma dinleyicisi TÜM sayfalar çizildikten sonra bağlanıyordu. 216
   sayfayı baştan çizmek dakikalar sürüyor; o süre boyunca kaydırma hiçbir şey
   saymıyordu. Üstelik 216 canvas'ı 2x çizmek sekmeyi dondurdu.
2. Sayfalar aynı anda çizilmeye çalışılıyordu (eşzamanlılık sınırı yok).

**Çözüm — yerleşim ile çizim ayrıldı:**
- **Yerleşim** en başta: her sayfa için gerçek ölçülerinde boş kutu açılır,
  kaydırma çubuğu doğru olur, takip anında çalışır.
- **Çizim** tembel: yalnızca görünür alana 600px yaklaşan sayfa çizilir,
  kuyruk TEK TEK işler (`pump`), en son istenen sayfadan başlar.
- 40 sayfadan uzun dokümanda retina çarpanı 2x → 1x (bellek).
- Takip KONUM tabanlı: sayfanın alt kenarı görünür alanın üstünde kaldıysa
  geçilmiş sayılır. Gözlemci (IntersectionObserver) ile yapılamıyor — kullanıcı
  kaydırma çubuğunu sürüklediğinde sayfalar tek karede atlanıyor ve "görünür
  oldu" olayı hiç tetiklenmiyor.

Doğrulandı: 500px kaydırma → 1/216; sona kadar → 216/216 ve buton açıldı.

**Bilinen sınır:** kaydırma çubuğunu doğrudan sona sürüklemek tüm sayfaları
okunmuş işaretler. Kural iyi niyet göstergesidir, okuduğunun kanıtı değildir.
Sayfa başına bekleme süresi şart koşulabilir ama 216 sayfalık dokümanda
eğitimi kullanılamaz hâle getirir.

## Tam ekran okuma + kompakt görüntüleyici — 26.08.2026

- **⛶ Full screen** düğmesi eklendi (tarayıcının Fullscreen API'si). Esc ile de
  çıkılır; durum kendi bayrağımızdan değil `fullscreenchange` olayından okunur,
  böylece Esc'le çıkışta düğme yanlış kalmıyor.
- Gömülü görüntüleyici küçültüldü: `max-w-[680px]` ve `max-h-[46vh]`. Okumak
  isteyen tam ekrana geçiyor.
- Çizim genişliği kutudan bağımsız sabit (`RENDER_WIDTH = 1240`), böylece tam
  ekranda da net; gömülü hâlde CSS ile küçültülüyor.
- **Bellek:** sayfa kutusuna `aspect-ratio` verildi, canvas mutlak konumda.
  Görünür alandan 6 sayfadan fazla uzaklaşan sayfanın canvas'ı boşaltılıyor
  (`width = height = 0`) — yerleşim bozulmuyor, kaydırma çubuğu zıplamıyor.
  216 sayfalık dokümanda hepsini bellekte tutmak mümkün değildi.

Doğrulandı: tam ekranda kaydırma sayacı işliyor (1/216 → 2/216), düğmeyle
çıkışta ilerleme korunuyor.

## Overdue kaldırıldı + dış belge geçerliliği tek hesaba indi — 26.08.2026

**1. Overdue tile'ı kaldırıldı.** Expired ile karıştırılıyordu. Yeni model:
- **EXPIRED** — kişi eğitimi ALMIŞ, geçerliliği dolmuş (yenilenmeli).
- **MISSING** — kişi eğitime SAHİP DEĞİL. Hiç alınmamış ya da atanmış olup
  vadesi geçmiş (eski OVERDUE bu kovaya girdi).
- **SOON** — 90 gün içinde dolacak.
Atanmış ve vadesi gelmemiş olan hiçbir kovada değil — iş sürüyor demektir.

**2. Dış belge geçerliliği üç ekranda üç farklı hesaplanıyordu:**
- `compliance.ts` ve `StaffDetail` belgenin kendi `expiresAt` alanını
  kullanıyordu, `TrainingMatrix` ise kursun tekrar süresini uyguluyordu.
  Artık üçü de: dış belge → belgenin kendi tarihi, iç sertifika → kursun
  tekrar süresi.
- Aynı kurs için birden çok dış kayıt varken kazanan "döngüde en son gelen"
  kayıttı — yani rastgele. Artık **en son TAMAMLANAN** kayıt kazanıyor.

**Veri notu:** Talha Duygu'da `fZAVxGFN5b5lWAKYZ2bl` (Aircraft Familiarization)
için İKİ dış kayıt var, ikisi de 07.11.2025 tamamlanmış: biri 07.02.2026'da
bitiyor, diğerinin (Gulfstream G4 Familiarization) bitiş tarihi yok. Tarihler
eşit olduğu için hangisinin kazanacağı hâlâ giriş sırasına bağlı. Mükerrer
kayıt temizlenmeli — kod değil veri sorunu.

## Dış sertifika düzenleme + tam liste — 26.08.2026

**Bug:** Eğitim tablosu kurs başına yalnızca "kazanan" dış kaydı gösteriyordu.
Aynı kursa girilmiş ikinci bir kayıt HİÇBİR ekranda görünmüyordu — dolayısıyla
düzeltilemiyor, silinemiyordu. Mükerrer kayıt sistemde görünmez şekilde
duruyordu.

**Eklenen:** Kişi sayfasına **External Certificates** paneli — o kişinin TÜM
dış kayıtları (eğitim, hangi kursa sayıldığı, sağlayıcı, tamamlanma,
geçerlilik, belge). Her satırda Edit / Delete. Kursa bağlı olmayan kayıtlar
"Not linked — closes no gap" uyarısıyla işaretli.

**Düzenleme:** `ExternalCertForm` artık `existing` alıyor. Düzenleme kipinde
belge zorunlu değil — seçilmezse mevcut dosya korunur, seçilirse değiştirilir.

**Geçerlilik tarihi artık doğrudan girilebiliyor.** Eskiden yalnızca
"tamamlanma + periyot" üzerinden türetiliyordu; dış sertifikada bitiş tarihi
belgenin üstünde yazar ve periyotla uyuşmayabilir. Yeni alan: **Valid Until**
(boş = süresiz). Yanındaki periyot seçicisi bu alanı otomatik doldurur ama
elle değiştirilince bir daha ezmez.

**Açık:** Talha Duygu'da aynı kurs (Aircraft Familiarization) için iki kayıt
var — "Aircraft Familiarization Training (Gulfstream GIV-X & SP)" / 147
Training / bitiş 07.02.2026 ve "Gulfstream G4 Familiarization" / 147 Aviation /
bitiş yok. Sağlayıcı ve ad farklı olduğu için hangisinin fazlalık olduğu
belirsiz; kullanıcı seçmeli.

## Sertifika sicili + tek numaralandırma — 26.08.2026

**Sorun:** İki ayrı numara serisi vardı. Online tamamlamalar `counters/certificates`
üzerinden `BA-00001`, sınıf eğitimi ise oturum açılırken ELLE girilen ön ek +
başlangıç numarasından (`26-131`, `26-52`). Aynı sicilde iki farklı seri
denetimde savunulamaz.

**Yapılan:**
- `nextSerialNo(count)` — tek kaynak, transaction ile artar. Biçim
  `counters/certificates` dokümanından: `{ prefix, next, pad }` → `25-144`.
  Ön ek boşsa düz sayı. Sınıf oturumu katılımcı sayısı kadar numarayı TEK
  seferde alır, araya başka sertifika girip seriyi bölemez.
- `issueCertificateFor` ve `finishClassSession` artık ikisi de buradan alıyor.
  Oturumdaki `certPrefix` / `certStartNo` alanları artık kullanılmıyor.
- Eski sayaç yalnızca `value` tutuyordu; ilk okumada ondan devam ediliyor.

**Yeni sayfa — Certificate Register** (`/register`, admin + eğitmen):
sistemin ürettiği tüm sertifikalar numara sırasıyla. Sütunlar kâğıt sicille
aynı: Certificate No · Name & Surname · Birth Place · Birth Date · Training ·
Instructor · Duration · Certificate Date · Source (Online / Classroom /
Manual). Arama, kaynak filtresi, yatay PDF çıktısı, satırdan sertifikaya geçiş.

**Numbering penceresi** (admin): ön ek, sıradaki numara ve basamak sayısı.
Kâğıt sicilden devam edebilmek için sıradaki numara elle veriliyor.
`firestore.rules` bu doküman için admin'e YALNIZCA `prefix`/`next`/`pad`
alanlarını yazma izni veriyor; numarayı hâlâ Function artırıyor.

**Not:** Mevcut 4 sertifika iki eski seride kaldı (26-131, 26-52, BA-00002,
BA-00001) — geçmiş numaralar değiştirilmiyor. Yeni seri Numbering'den
ayarlanan değerden devam eder.

## Sınıf oturumunda numara sorulmuyor — 26.08.2026

Oturum açarken "Certificate Numbering" (ön ek + başlangıç no) alanları
kaldırıldı; zorunlu alan olmaktan da çıktı. Numaralar sınıf kapatılırken
merkezî sicilden alınıyor (`nextSerialNo`), katılımcı sayısı kadar tek seferde.

- Oturum dokümanındaki `certPrefix` / `certStartNo` / `certPadding` alanları
  artık yazılmıyor ve okunmuyor. Kapanışta `certFirstNo` / `certLastNo`
  yazılıyor; liste kapanmış oturumda "3 issued · 26-132–26-134" gösteriyor.
- Kapatma onayı "Numbering starts at …" yerine "Numbers are taken from the
  central register" diyor.

## Sertifika tasarımı örneğe göre düzeltildi + import geri alındı — 26.08.2026

**Kâğıt sertifikaya (Certificate-26-002.pdf) göre düzeltmeler:**
- **İmza blokları** eklendi: solda eğitmen adı + "Instructor", sağda kalite
  müdürü adı + "Technical Quality Manager". Üstlerinde ıslak imza boşluğu ve
  çizgi. Certificate No / Date ortada, altlarında.
- **"held online" varsayımı kaldırıldı.** `heldIn` boşken `ORG.defaultLocation`
  ("ONLINE") kullanılıyordu; yüz yüze verilmiş bir eğitimin sertifikasında
  "held online" yazıyordu — belgeyi yanlış kılan bir hata. Artık yer boşsa o
  satır hiç basılmıyor.
- İçe aktarılan kayıtlarda "Exam: Not required" satırı basılmıyor
  (`issuedVia === "IMPORT"`), kâğıt belgede de yok.
- Import şablonuna **Location** sütunu eklendi.
- `orgSettings.qualityManagerName` — Settings → **Certificate Settings**'ten
  giriliyor, sertifika üretilirken donduruluyor.

**QR katılım formu:** e-posta alanı kaldırıldı (telefon zaten yoktu). Kalan
alanlar: ad soyad, doğum yeri, doğum tarihi.

**Bulunan bug:** Katılımcı → personel eşleşmesi HİÇ çalışmıyormuş. Form
girişsiz açıldığı için güvenlik kuralları `users` okumasına izin vermiyor;
`getDocs` sessizce hata verip `userId` null kalıyordu, yani sınıfa katılan
personelin ataması hiç kapanmıyordu. Eşleşme `finishClassSession` içine
taşındı — ada (varsa e-postaya) göre sunucuda yapılıyor.

**Import geri alma:** `undoCertificateImport` (ADMIN, `dryRun` destekli).
Yalnızca `imported: true` kayıtları ve `certVerify` karşılıklarını siler;
sistemin ürettiği sertifikalara dokunmaz. 236 kayıt silindi, sayaç 1'e alındı
(ön ek 26, 3 basamak → sıradaki 26-001).

## Sertifika: tek imza + doğrulama QR'ı, yerleşim düzeltildi — 26.08.2026

- **Kalite müdürü imza hanesi kaldırıldı.** Yerine sağda **doğrulama QR'ı**
  geçti — onay artık ıslak imzayla değil, numara sorgulamayla yapılıyor.
  `orgSettings.qualityManagerName` ve Settings'teki alanı da kaldırıldı.
- **Tek imza hanesi solda.** Sınıf eğitiminde eğitmenin adı + "Instructor";
  online eğitimde **"BonAir Academy" + "Online Training"**.
- **Bulunan iki hata:**
  - `finishClassSession` sertifikaya `instructorName` HİÇ yazmıyordu; sınıf
    sertifikaları da "Online Training" olarak çıkıyordu. Artık oturumun
    eğitmeni yazılıyor.
  - `issueCertificateFor` online sertifikaya kursun SAHİBİ eğitmeni imza
    hanesine yazıyordu. Online eğitimde imzalayan kimse yok; alan artık boş.
- **Yerleşim taşması giderildi.** İmza satırı ve belge künyesi ayrı bloklardı,
  ikisi birlikte A4 yataya sığmıyor, numara kesiliyordu. Tek satırda üç sütuna
  indirildi (imza · künye · QR) ve dikey ölçüler sıkıştırıldı.

## İçe aktarılan sertifikalar için belge ÜRETİLMİYOR — 26.08.2026

Kâğıt sicilden aktarılan kayıtlar (`issuedVia === "IMPORT"`) artık sertifika
olarak render edilmiyor. `/certificate/:id` bunlarda **sicil kaydı** görünümü
açıyor: "Register record only — the original certificate is held by the
organisation." Yazdırma düğmesi yok; yalnızca doğrulama sayfası bağlantısı var.

Gerekçe: aslı kurumda duruyor. Sistem bunlar için ikinci bir "asıl" belge
üretirse aynı eğitimin iki farklı sertifikası ortaya çıkar.

Sicilde bu satırlar **Paper** rozetiyle işaretli ve kaynak filtresine
"Paper register (imported)" seçeneği eklendi.

**Ek (26.08.2026):** Online sertifikada imza çizgisi tamamen kaldırıldı —
boş çizgi "imzalanmamış belge" izlenimi veriyordu. Yerine çizgisiz olarak
"Created by BonAcademy / No signature required" yazıyor. Sınıf eğitiminde
imza çizgisi + eğitmen adı aynen duruyor.

**Ek (26.08.2026 · 2):** Sertifikadan "No signature required" satırı ve en
alttaki "BonAir Aviation · BonAir Academy" künyesi kaldırıldı. Online belgede
imza hanesinde yalnızca "Created by BonAcademy" yazıyor.

**Not — süre:** "Duration: X Hours" satırı zaten eğitim adının hemen altında
basılıyor; boş görünmesinin sebebi kursun `durationHours` alanının boş olması.
Şu an 6 kursta süre girilmemiş: Train The Trainer · NDT training on the related
testing type · Quality System Trainings · Aircraft Familiarization Training ·
NDT familiarization or NDT method training · Auditing Techniques or Auditor
Training. Tracked Training olanlarda süre alanı formda YOK — eklenmesi gerekir.

## TRNG_STS matris aktarımı (28.09.2026)

Kâğıt eğitim takip matrisi (`Kitap1.xlsx`, sayfa `TRNG_STS`) sisteme aktarıldı.
Scriptler: `scripts/import-trng-sts.js` (idempotent, doc id kişi+kolon'dan türer),
`scripts/seed-from-trng-sts.js` (eksik kurs/kullanıcı).

Tablonun okunuşu: hücredeki tarih = eğitimin ALINDIĞI tarih, altındaki satır =
kalan gün. Geçerlilik süresi kalan günden geri hesaplandı (referans gün 28.09.2026).

- 464 kayıt `externalTrainings`'e yazıldı, `importedFrom: "TRNG_STS"`.
- Kapsama iki yönlü: HF/SMS hücresinde "(Safety Training)" → Safety tarihi taşındı;
  Safety hücresinde "HF & SMS" → HF tarihi taşındı.
- Kurs olarak açılmadı (Incoming Inspection içinde veriliyor): ESD, DGR Awareness,
  ATA 300, Hidden Damage Inspection, Tool Calibration, Basınçlı Tüp. Module-10
  ayrıldı, takip edilmiyor. İlk Yardım'da hiç veri yok.
- `English Exam` Tracked Training olarak açıldı (5 yıl).
- Karar bekleyen kolonlar: Competence Assessment (65 kişi), Authorisation Request
  and Assessment (18 kişi), SMS (kendi tarihi olan 11 kişi) — kurs açılmadı.
- Yetki kolonları atlandı (Mechanic Authorisation, OJT ×4, Instructor
  Authorization, Licence/Authorization Expiry) — eğitim değil, yetki.

### Elde düzeltilmesi gerekenler
- Matriste olup sistemde hesabı olmayan 5 kişi (kayıtları yüklenmedi):
  Onur ÜÇKALELER, Hüseyin KILCIOĞLU (CS), Tolga GÜL, Eylül PIRTIL, Ercan YAZAR.
  Auth tarafı ADC ile yazılamıyor (Identity Toolkit kullanıcı kimliğini kabul
  etmiyor) → Users ekranından elle eklenip `import-trng-sts.js` tekrar çalıştırılmalı.
- English Exam'da 4 hücrede tarih bitiş tarihi gibi girilmiş (atlandı):
  Deniz ÜNLÜ, Rıdvan Burak KARALAR, Cem GÜNGÖRMEZ, Vehbi Kıvanç TÜRKER.
- Yunus Emre BEYHATUN · EWIS: kalan gün hücresine seri no düşmüş; süre kolonun
  baskın değeriyle (2 yıl) alındı.
- Sistemde olup matriste olmayan 5 kişi: Faruk ARSLAN, Doğukan Batın ÖZBEK,
  Anıl Kaan KURT, İbrahim Özgür AYDOS, Eyüp Eren KAYA.

### Kâğıt kayıt girişi (28.09.2026)
Dış eğitim formu yeni kayıtta PDF zorunlu tutuyordu; kâğıttan gelen kayıtların
dijital kopyası olmadığı için bunlar hiç girilemiyordu. Forma "Original held on
paper — no digital copy" seçeneği eklendi (`paperOnly: true`). Ayrıca belgesi
olmayan kayıtlarda üç yerde koşulsuz "Open" linki basılıyordu (StaffDetail
eğitim tablosu, StaffDetail External Certificates, Certificates sayfası) — ölü
bağlantılar kaldırıldı, yerine "On paper" yazıyor.

Karar: Competence Assessment ve Authorisation Request and Assessment artık takip
edilmiyor, kurs açılmadı. SMS ayrı takip edilmiyor — HF+SMS birleşip Safety
oldu; iki eğitimi olan personelde HF/SMS tarihleri Safety olarak sayılıyor
(aktarımda böyle işlendi).

## CUSTOMER rolü — dışarıya açık eğitim (28.09.2026)

Dışarıdan eğitim alan müşteriler için beşinci rol: `CUSTOMER`. Personel değil.

- `functions`: `ROLES`'a eklendi; `createUser`/`updateUser` artık `company` alanını
  da yazıyor (müşterinin bağlı olduğu kurum).
- `auth.tsx`: `Role` genişledi, `Profile.company` eklendi, `isStaffRole()` yardımcısı.
- Menüde yalnızca Dashboard + My Certificates. Dashboard'ın kurum uyum bölümü
  `oversees` kontrolü sayesinde zaten gizli.
- `compliance.ts` ve `TrainingMatrix`: müşteri personel listelerinden dışlandı —
  kurum uyum yüzdesini ve Follow-Up matrisini bozmuyor.
- `Users`: rol listesinde Customer; müşteri seçilince Departman/Yetki Kapsamı
  yerine **Company** alanı çıkıyor ve kapsam boş gönderiliyor (kapsam verilirse
  müşteri personel gibi sayılırdı). Tabloda kolon "Department / Company".
- Excel içe aktarma: `Company` kolonu ve `Customer`/`Müşteri` rol etiketi eklendi;
  personel satırında Company doluysa hata veriyor.
- `firestore.rules`: `isStaff()` eklendi; `departments`, `jobTitles`, `appOptions`,
  `orgSettings` okuması artık müşteriye kapalı.

### Yan bulgu — rota seviyesinde rol koruması yoktu
Courses, CourseDetail, Users ve Settings sayfalarında hiç rol kontrolü yoktu;
adresi elle yazan bir çalışan da o ekranı açabiliyordu (veri Firestore
kurallarıyla korunuyordu, ekran yine geliyordu). Koruma `App.tsx` içinde tek
noktaya alındı (`<Only roles={...}>`), böylece müşteri kısıtı gerçekten
uygulanıyor ve çalışan için de aynı boşluk kapandı.

### Sonraki adımlar (yapılmadı)
- Müşteri eğitimi elle atanıyor (Users → satır menüsü → Assign courses).
  Kurum bazlı toplu atama yok.
- Self-servis kayıt / davet linki yok — karar: admin elle açar.
- Kurs kataloğu (`courses`) okuması hâlâ tüm oturum açmış kullanıcılara açık;
  müşteri teorik olarak kurs başlıklarını sorgulayabilir. Gizlemek gerekirse
  atamaya bağlı per-doc kural gerekir.

## Dashboard — rol başına ayrı ekran (28.09.2026)

Tek ekranı rollere göre parça parça gizlemek herkese yanlış öncelik dayatıyordu:
admin kendi üç atamasını görüyor, öğrenci anlamadığı kurum istatistiklerini.
`Dashboard()` artık role göre iki ayrı bileşene dallanıyor.

**ADMIN / MANAGER / INSTRUCTOR → `StaffDashboard`** ("Tek Soru" düzeni)
- Üstte tek halka (uyum oranı) + tek cümle ("23 kişinin açık eğitim eksiği var")
  + üç sayı + Follow-Up butonu.
- Altında tek iş listesi; eski üç sayaç kutusu **segment filtresi** oldu
  (All / Expired / Never taken / 90 days) — zaten işlevleri buydu.
- Kendi eğitimi en altta tek satır (yöneticide çoğu zaman boş).

**USER / CUSTOMER → `LearnerDashboard`**
- Atanan eğitimler kart ızgarası: kapak, durum rozeti, ilerleme çubuğu (%),
  açıklama, eğitmen, süre, son tarih, Start/Continue.
- İlerleme = `assignment.sectionsDone.length / kursun bölüm sayısı`; bölüm
  sayısı kurs başına bir kez okunuyor.
- Tamamlananlar altta sade liste + "My certificates" bağlantısı.
- Kapak görseli alanı (`coverUrl`) destekleniyor ama HENÜZ YÜKLENEMİYOR —
  yoksa kurs başlığından türetilen sabit gradyan basılıyor (aynı kurs her zaman
  aynı renk). Kurs formuna kapak yükleme eklenmedi.

### Eğitmen adı kursa denormalize edildi
`ownerInstructorName` alanı eklendi. Sebep: kart "Instructor: …" gösteriyor ama
müşteri rolü `users` koleksiyonunu okuyamıyor, isme başka yoldan ulaşamaz.
Yeni kurslar alanı oluşturulurken alıyor; mevcut 14 kurs
`scripts/backfill-course-instructor.js` ile dolduruldu. Eğitmeni olmayan 3 kurs
(NDT training on the related testing type, Quality System Trainings, English
Exam) boş kaldı — bunlar Tracked Training, eğitmen alanları yok.

### Kurs kapak görseli (28.09.2026)
`Courses → kurs → 1. General Information` altına kapak yükleme eklendi.
- Storage: `covers/{courseId}/...`; okuma giriş yapan herkes (kapak katalogun
  parçası, müşteri de görür), yazma ADMIN/INSTRUCTOR/MANAGER claim'i.
- Dosya seçilince doğrudan yüklenip `coverUrl`/`coverPath` dokümana yazılır —
  Kaydet'i beklersek Storage'da bağlantısız dosya kalırdı.
- "Remove" yalnızca alanları temizler, Storage'daki dosyayı silmez (geri
  alınamaz bir işlem; aynı görsel başka yerde kullanılmış olabilir).
- Formdaki önizleme öğrencinin gördüğü kartın birebir aynısı; ikisi de
  `lib/coverTone.ts` kullanıyor, ayrı yazılsa iki yerde farklı renk çıkardı.

## Training Follow-Up — iki kip + ısı haritası (28.09.2026)

Sayfa iki ayrı işi birden yapıyordu ve ikisinde de yarım kalıyordu: günlük
tarama ("kimde sorun var") ve denetim çıktısı ("tam tablo"). Üstteki segment
ikisini ayırdı.

**Kullanıcı kararı:** People kipi kaldırıldı, yalnızca ızgara kaldı.

**Izgara** — ısı haritası. Hücrede kalan gün (ya da "Dates" segmentiyle
tarih), zemin yeşilden kırmızıya sürekli ölçek. Sütun 110px'ten 56px'e indi,
17 eğitim tek ekrana sığıyor. PDF buradan alınıyor.

### Düzeltilen hata
Eski lejantta 7 etiket vardı ama ikisi birebir aynı renkti: "Missing" ile
"30–0 gün" ikisi de `red-100`, "Planned" ile "90–60 gün" ikisi de `amber-100`.
Lejantta ayrı yazan dört şey ekranda iki renkti. Ölçek tek bir sürekli diziye
çekildi; MISSING kendi koyu tonunu (#8e1b16) aldı, PLANNED krem, N/A ise hiç
boyanmıyor — taranmış desen (`.matrix-na`).

`cell-missing` yanıp sönme animasyonu satır içi rengi eziyordu (CSS animasyonu
inline style'dan güçlü); keyframe renkleri yeni koyu tona çekildi, yoksa eksik
hücre açık kırmızıya düşüyordu.

### PDF çıktısı ısı haritasına göre düzenlendi
Hücre artık iki satır (tarih + kalan gün) değil tek kısa değer taşıyor:
punto 5pt → 6pt, satır yüksekliği serbest, hücre ayracı 0.25mm'ye indi.
`matrix-na` taraması kâğıtta gri blok gibi çıkıyordu → düz açık gri.
Hücre zeminleri ve lejant kutucukları `print-color-adjust: exact` ile
basılıyor — bu tablonun bilgisi renkte, zemin basılmazsa çıktı anlamsız.

### Hücre detay kartı (28.09.2026)
Dates segmenti kaldırıldı — hücrede her zaman kalan gün yazıyor. Yerine hücrede
oyalanınca (2 sn, `HOVER_DELAY_MS`) açılan detay kartı geldi: kişi, eğitim,
tamamlama tarihi, geçerlilik bitişi ve kalan gün, sertifika numarası, süre,
eğitmen, kaynak (BonAcademy / dış sağlayıcı). Dış kayıtta belgenin kendi
başlığı kurs adından farklıysa o da gösteriliyor.

Tarayıcının kendi `title` ipucu tek satır ve biçimsizdi, gecikmesi de
ayarlanamıyordu; kart `createPortal` ile body'ye basılıyor, ekran kenarına
taşarsa yukarı/sola dönüyor, kaydırmada kapanıyor. Sertifika numarası ve
eğitmen için `certificates`/`externalTrainings` alanları hücre durumuna taşındı.

## Courses ve Classes — kart düzeni (28.09.2026)

İkisinde de kırmızı gradyan başlık bandı kaldırıldı (eski kırmızı sidebar'ın
devamıydı, grafit menüyle çakışıyordu).

**Courses** — tablo yerine kart ızgarası. Kart, öğrencinin gördüğü kartla aynı
kapağı kullanıyor (`coverUrl`, yoksa `lib/coverTone.ts`); gövde künye düzeninde:
Content · Exam · Duration · Recurrence · Revision. Durum rozeti üç değerli:
Published / Empty / Draft.

Bölüm ve soru sayıları alt koleksiyonlardan liste değiştikçe bir kez okunuyor
(kurs başına canlı dinleyici açılmıyor).

**Yeni bulgu:** 10 kursun 6'sı `isActive` ama hiç bölümü yok — atanan kişi
eğitime girip boş ekranla karşılaşır. Eski tablo bunu hiç göstermiyordu, Status
sütunu yalnızca aktif/pasif diyordu. Artık kart "Empty" rozetiyle işaretleniyor
ve listenin üstünde toplam sayı uyarı olarak yazıyor.

**Classes** — tablo yerine ajanda satırları: solda tarih bloğu (gün + ay/yıl),
ortada eğitim + yer/eğitmen/süre, sağda sertifika sayısı ve numara aralığı,
en sağda durum. Sınıf eğitimi zamana bağlı bir iş; tarih tablo sütununda
kayboluyordu.

### Kurs düzenleme ekranı — sol ray (28.09.2026)
5 adımlı sihirbaz (`Stepper`) kaldırıldı, yerine sol ray + panel geldi.
Sihirbaz yeni kurs kurarken mantıklıydı ama mevcut kursu düzenlerken tek bir
alanı değiştirmek için ileri-geri tıklamak gerekiyordu. Back/Next korundu —
yeni kurs akışı bozulmasın diye.

Sol ray aynı zamanda kontrol listesi: her adımın yanında tik (hazır), ünlem
(eksik) ya da nokta (bu kursta geçerli değil); altında "Readiness n/m" çubuğu.
Hazırlık ölçütleri: revizyon no girilmiş · en az bir bölüm · soru bankası
sınavın istediği soru sayısını karşılıyor · yayında.

Üstte kurs künyesi (kapak, kategori/revizyon/süre/tekrar, durum rozeti, Save).
Başlık orada tekrar edilmiyor — uygulama üst barı zaten sabit ve başlığı
gösteriyor.

**Düzeltilen hata:** adım numaraları kayıyordu. Görünen adımlar kursa göre
değişiyor (dış eğitimde içerik/sınav yok, sınavsız kursta soru bankası yok) ve
başlıklar `atIdx + 1` ile yeniden numaralanıyordu, ama Question Bank başlığında
`4 ·` sabit yazılmıştı — bazı kurslarda iki adım aynı numarayı taşıyordu.
Numaralar tamamen kaldırıldı; ray zaten sırayı gösteriyor.

Bölüm başlıklarındaki kırmızı gradyan bant da kaldırıldı.

## Users — departmana göre gruplu liste (28.09.2026)

Kırmızı gradyan başlık bandı kaldırıldı. Satırlar Training Follow-Up'takiyle
aynı şekilde departmana göre kümeleniyor — aynı personel iki ekranda aynı
sırayla görünüyor. 71 satırlık düz alfabetik liste "şu departmanda kim var"
sorusuna cevap vermiyordu.

- Ad + e-posta tek hücrede, baş harf rozetiyle. İki ayrı sütun yatayda boşuna
  yer yiyordu; sütun sayısı 8'den 5'e indi.
- Departman sütunu grup başlığına taşındı; başlıkta kişi sayısı yazıyor.
- Yetki kapsamları "+N" ile kısalıyor (üç kapsamı olan kişilerde satır
  taşıyordu); tamamı tooltip'te.
- Müşteriler kendi grubunda, listenin en sonunda — personel değiller,
  departmanları da yok. Şirket adı e-postanın yanında görünüyor.
- Departmanı olmayan hesaplar "No department" grubunda (eskiden "—" yazıyordu).

## Settings — ayar kartları (28.09.2026)

Beş kart alt alta yerine iOS Ayarlar mantığı: giriş ekranı bir ızgara, her ayar
bir kart (simge, ad, **ne işe yaradığı**, kaç kayıt olduğu); tıklayınca o ayar
tam genişlikte açılıyor, üstte "← All settings".

Asıl düzeltilen: hiçbir ayarın ne işe yaradığı yazmıyordu. "Tracked Trainings
nedir", "yetki kapsamı ne yapar" sorusunun cevabı ekranda yoktu, ancak
kullanarak öğreniliyordu. Hem kartlarda hem açılan bölüm başlığında tek
cümlelik açıklama var.

Kart sayıları canlı: departman sayısı, kapsam sayısı + toplam zorunlu eğitim,
takip edilen eğitim sayısı, varsayılan eğitim yeri. Kırmızı gradyan bantlar
kaldırıldı.

### Ölü alan silindi
`orgSettings/singleton.qualityManagerName` ("Jülide TOSUN") Firestore'da
duruyordu ama sertifikadan kalite müdürü imza hanesini kaldırdığımızdan beri
hiçbir yerde okunmuyordu (kodda tek referans kalmamıştı). Alan dokümandan
silindi.

## Learn — ilerleme rayı (28.09.2026)

Bölüm listesi ayrı bir kartken sola rayla taşındı; kurs düzenleme ve Settings
ekranlarındaki rayın öğrenci tarafı. Eğitim tek oturuşta bitmiyor, ertesi gün
girildiğinde "nerede kalmıştım, ne kaldı" sorusunun cevabı ekranda duruyor.

- Rayın üstünde ilerleme: `tamamlanan / (bölüm sayısı + sınav)`.
- Bölümler: tamamlanan ✓, sıradaki numaralı, kilitli 🔒. Satırlar tıklanmaz —
  bölümler sırayla açılıyor, tıklanabilir görünmeleri yanıltıcı olurdu.
- **Sınav rayın son satırı.** Eskiden sınav ancak bütün bölümler bitince ayrı
  bir kutuda beliriyordu; o ana kadar varlığından haberin olmuyordu. Bunun için
  kursun `exam.required` alanı ayrıca dinleniyor (atama dokümanında yok).
- Sınavsız kursta sınav satırı hiç basılmıyor ve sayfa alt başlığı da buna göre
  değişiyor.

PdfReader'ın gömülü boyutuna (680px / 46vh) dokunulmadı — kullanıcı daha önce
küçültülmesini istemişti.

### SCORM hiç çalışmıyormuş (28.09.2026)
`serveScormContent` istenen yolu ilk `content/` geçtiği yerden kesiyordu. Ama
hosting rewrite yolu `/scorm-**content**/content/...` biçiminde veriyor; ayraçsız
arama `scorm-content/` içindeki parçaya denk geliyor ve yol `content/content/...`
oluyordu. Storage'da böyle bir nesne yok, fonksiyon hep **404 "not found"**
döndürüyordu — yani SCORM içeriği bugüne kadar hiç açılmamış (backlog'daki
"SCORM never tested with a real package" maddesi bu yüzden).

Arama ayraçlı hâle getirildi (`/content/`, sonra `idx + 1`); zaten `content/`
ile başlayan yol olduğu gibi kabul ediliyor. Canlıda doğrulandı: EWIS kursunun
iSpring paketi 200 dönüyor.

### Learn — bölüm seçimi ve SCORM teşhisi (28.09.2026)
- Raydaki bölümler artık **tıklanabilir**: tamamlanmış bir bölüme geri dönüp
  bakmak ya da ileriyi okumak serbest. **Tamamlama sırası değişmedi** —
  `completeSection` sunucuda "bu bölüm, tamamlanmamış ilk bölüm olmalı"
  kuralını uyguluyor. Tamamla düğmesi yalnızca sıradaki bölümde çıkıyor;
  ileri bir bölüme bakılıyorsa "önce bölüm N'i bitir" notu ve geri dönüş
  düğmesi, tamamlanmış bölümde "Completed" rozeti gösteriliyor.
- `ScormPlayer` artık adresi ayrıca `fetch` ile doğruluyor ve açılamazsa HTTP
  kodunu, adresi ve ne yapılacağını yazıyor; iframe bir 404 gövdesini sessizce
  gösteriyordu ve kullanıcı yalnızca boş bir kutu görüyordu. Yanına ⟳ Reload
  düğmesi eklendi (iframe `key` ile yeniden kuruluyor, `cache: "reload"`).

### Follow-Up — N/A yazısı ve hücreden kayıt girme (30.09.2026)
- Gerekli olmayan hücrede nokta yerine soluk **"N/A"** yazıyor; nokta,
  hücrenin boş mu kaldığı yoksa gerekli mi olmadığı belirsiz bırakıyordu.
- **Eksik hücre tıklanabilir**: dış eğitim kaydı formunu kişi ve kurs seçili
  olarak açıyor. Eskiden matriste eksiği görüp kişi sayfasına gitmek
  gerekiyordu. Hücre normalde "—", üzerine gelince "+ add" gösteriyor.
- Düğme yalnızca ADMIN'e ve kendi departmanındaki personel için MANAGER'a
  çıkıyor — `externalTrainings` Firestore kuralı da tam olarak bunu izin
  veriyor; eğitmene göstermek tıklandığında yetki hatası verirdi.

## Form penceresi — sade sayfa düzeni (30.09.2026)

`Modal` kabuğu: kırmızı gradyan başlık kaldırıldı (sistemdeki son kırmızı
kalıntıydı). Beyaz başlık, ince ayraç, yuvarlak kapatma düğmesi. Bu değişiklik
sistemdeki BÜTÜN formlara yansıyor.

`ExternalCertForm` iki adıma bölündü (kullanıcı kararı; tek sayfa düzeni
karışık bulundu):

1. **Bilgiler** — alanlar tek sütunda alt alta: eğitim adı, veren kurum,
   alınma tarihi, süre, geçerlilik. Kurs önceden seçilmemişse en üstte
   "Counts As" kutusu.
2. **Belge** — sürükle-bırak ya da tıklayıp seç; kâğıt kaydı için onay
   kutusu; sertifika no ve not.

Alan altlarındaki açıklama notları kaldırıldı — ekranı kalabalıklaştırıyordu.
Yalnızca gerçek uyarı kaldı (kursa bağlanmayan kayıt eksiği kapatmaz).
Düğmeler pencerenin dibindeki şeritte, birincil sağda.

### Düzeltilen belirsizlik
"Valid Until" ile "Or fill it from a period" **aynı değeri iki ayrı yerden**
dolduruyordu ve hangisinin kazandığı belli değildi (`touchedValid` bayrağıyla
idare ediliyordu). Tek bir segment kontrolüne indirildi: No expiry / 1 year /
2 years / 5 years / Pick date. Kurs seçilince kursun kendi periyodundan
öneriliyor; alınma tarihi değişince bitiş yeniden hesaplanıyor.
Ölü `every` / `unit` state'i ve `UNIT_LABEL` sabiti kaldırıldı.

## Yetki kapsamı — muafiyet ve NDT Staff (30.09.2026)

**Sorun:** Certifying Staff'ın zorunlu listesinde English Exam var; NDT Staff
onun alt yetkisi olarak modellenmişti ve alt yetki yalnızca EKLEYEBİLİYORDU.
Yani NDT personeli release yetkisi kullanmadığı hâlde İngilizce sınavı onlarda
da zorunlu görünüyordu. Model bu durumu ifade edemiyordu.

İki iş birden yapıldı (kullanıcı kararı).

### 1. Alt yetki artık eğitim düşürebiliyor
`SubScope.excludedCourseIds` eklendi. `requirementFor` önce muafiyete bakıyor —
muafiyet kapsamın zorunluluğunu eziyor. Yeni `exclusionFor()` hangi alt
yetkinin düşürdüğünü döndürüyor.

Settings → alt yetki satırında **"− Not required"** düğmesi; seçim yalnızca
kapsamın zorunlu tuttukları arasından yapılıyor. Muafiyetler satırda ayrı ve
kehribar renkli listeleniyor — sessizce düşen bir zorunluluk, uygunsuzluğu
gizlemekle aynı şey olurdu.

Follow-Up'ta muaf hücre N/A ama **noktalı altı çizili**; detay kartında
"Not required — <alt yetki> drops this training from the scope" yazıyor.

### 2. NDT Staff ayrı kapsam oldu
`scripts/create-ndt-scope.js` ile oluşturuldu (id `jPl1ZdeFu10YRlP40K6m`).
Başlangıç listesi **öneri**: Certifying Staff'ın 11 eğitimi eksi English Exam,
artı NDT training. NDT release yetkisi kullanmıyorsa SHT-66/SHT-145 gibi
kalemlerin gerekip gerekmediğini bilemem — Settings'ten gözden geçirilmeli.

**Kapsam henüz kimseye atanmadı**, dolayısıyla hiçbir uygunluk sonucu
değişmedi. Şu an Certifying Staff → NDT Staff alt yetkisi tikli olanlar:
**Cem GÜNGÖRMEZ** ve **Vehbi Kıvanç TÜRKER**. Bu ikisi yeni kapsama taşınırsa
eski alt yetki silinebilir.

## Metod bazlı eğitimler (30.09.2026)

Bazı eğitimler tek belge değil, birkaç ayrı yetki demek. NDT tipik örnek: kişi
PT ve MT'de yetkili olabilir, her metodun kendi belgesi ve kendi bitiş tarihi
vardır. Sistem tek kurs = tek kayıt varsaydığı için ikinci metod girilemiyordu.

**Düzeltilen hata:** matris kişi+kurs başına yalnızca EN SON kaydı alıyordu.
PT 2028'e geçerli, MT 2025'te dolmuş bir kişide en son tarih kazanıyor ve kişi
**uyumlu** görünüyordu. Artık kural açık: **en kötü metod belirler** — bir
metodun belgesi yoksa eksik, hepsi varsa geçerlilik en erken dolana göre.

### Model
- `courses/{id}.methods: string[]` — Settings → Tracked Trainings formunda
  virgülle girilir. Boşsa kurs metod bazlı değildir.
- `users/{uid}.courseMethods: { [courseId]: string[] }` — kişinin o eğitimde
  yetkili olduğu metodlar; Users formunda tiklenir. `createUser`/`updateUser`
  alanı temizleyip yazıyor (boş kalan kurs anahtarları atılıyor).
- `externalTrainings/{id}.method` — kaydın hangi metoda ait olduğu. Metod
  yazılmamış eski kayıtlar hiçbir metodu kapatmaz; bilinmeyen bir belgeyle
  yetkiyi geçerli saymak yanlış olurdu.

### Ortak hesap
`web/src/lib/methods.ts` — `methodsOf`, `heldMethods`, `methodBreakdown`,
`worstOf`. Follow-Up matrisi ve Dashboard uygunluk hesabı **aynı** fonksiyonları
kullanıyor; bu hesabın iki dosyada ayrı yazılması daha önce üç ekranın üç
farklı cevap vermesine yol açmıştı.

### Arayüz
- Follow-Up hücresi eksik metodları yazıyor (ör. "MT"), detay kartında her
  metodun kendi tarihi ayrı satırda.
- Metod bazlı kursta **dolu hücreden de** kayıt girilebiliyor — ikinci metod
  her zaman eklenebilmeli.
- Kayıt formunun 1. adımında metod seçimi zorunlu; StaffDetail'de kayıt
  satırında metod rozeti görünüyor.

**Metod listesi henüz boş** — kullanıcı kendi listesini yazacak
(Settings → Tracked Trainings → NDT training → Methods).

### Detay kartı fareyle tutuluyor (30.09.2026)
Kart `pointer-events-none` idi ve hücreden çıkar çıkmaz kapanıyordu; hücre ile
kart arasındaki boşluktan geçerken kayboluyor, içindeki metni okumak ya da
seçmek mümkün olmuyordu. Artık hücreden çıkışta 220 ms bekleniyor, kartın
üstüne girilince bekleme iptal ediliyor, karttan çıkılınca kapanıyor.

Hücrelerdeki `title` öznitelikleri kaldırıldı — tarayıcının siyah ipucu detay
kartının üstüne biniyor ve aynı bilgiyi daha kötü gösteriyordu.

### Metod belgeleri karttan açılıyor (30.09.2026)
Metod bazlı kursta hücre "kayıt ekle" düğmesine dönüştüğü için yüklenen
sertifikayı açacak bağlantı kalmamıştı (dosyalar Storage'da duruyordu, sorun
yalnızca arayüzdeydi). Detay kartında her metod satırı artık kendi belgesine
bağlantı: `MethodRecord.url` → `MethodRow.url`. Kâğıt kayıtta bağlantı yok,
düz metin kalıyor.

### Dashboard "Act on these" satırları kart oldu (30.09.2026)
Kalan gün sağda 11px gri bir metindi ("in 36d") — listenin en önemli bilgisi
olmasına rağmen görünmüyordu. Satırlar ayrı kartlara dönüştü:

- Solda 4px renkli şerit ve ikon; kart zemini de aynı aciliyet tonunda.
- Sağda **büyük rakam + altında "days left" / "days overdue"**; bugün dolan
  "Today", hiç alınmamış "Not taken".
- Ton eşiği: süresi geçmiş kırmızı, ≤30 gün turuncu, 31–90 gün kehribar,
  hiç alınmamış nötr gri.

Aciliyet artık üç yerden okunuyor (şerit, zemin, rakam); eski `KindTag`
rozetine gerek kalmadı, kaldırıldı.

## My Certificates — eğitim bazlı gruplama (30.09.2026)

Sayfa iki ayrı tabloydu: BonAcademy sertifikaları ve dış kayıtlar. Aynı
eğitimin hem sistem sertifikası hem dış belgesi hem de kâğıttan aktarılmış
kaydı olabiliyor (gerçek örnek: Talha Duygu'da Safety Training için üç kayıt)
ve iki tablo bunları ilişkilendirmediği için hangisinin geçerli olduğu
görünmüyordu.

Artık **satır başına bir eğitim**: üstte geçerli olan kayıt (kaynak, numara,
tarihler) ve sağda büyük rakamla kalan gün; altında "Show N earlier records"
ile aynı eğitimin geçmişi. Üstte üç sayı: in date / due in 90 days / expired.
Kazanan kayıt en son TAMAMLANAN — Dashboard ve Follow-Up ile aynı kural.

### Düzenleme boşluğu kapatıldı
Yüklenen kayıt hiçbir yerden düzeltilemiyordu (yanlış tarih, yeni belge).
İki yere düzenleme eklendi:
- **My Certificates** — her dış kaydın yanında "Edit".
- **Follow-Up detay kartı** — dolu hücrede "Edit record".

Düğme yalnızca ADMIN'e çıkıyor. Firestore kuralı dış kaydı admin'e ve kaydın
departmanının müdürüne açıyor; içe aktarılan kayıtlarda `userDepartmentId`
boş olduğu için müdür kendi kaydını bile değiştiremez — düğmeyi ona göstermek
tıklandığında yetki hatası verirdi.

### Dashboard listesi: başlık ve kaydırma (30.09.2026)
- "Act on these" → **"Needs attention"**. Emir değil durum bildiriyor ve
  listenin içeriğini doğru anlatıyor (süresi dolmuş + hiç alınmamış + yaklaşan).
- Liste artık **bütün** kayıtları gösteriyor; bölüm sabit yükseklikte
  (`max-h-[520px]`) kalıp kendi içinde kayıyor. Eskiden ilk 8 gösterilip
  gerisi "see the full matrix" bağlantısına havale ediliyordu — açığın
  tamamını görmek için sayfa değiştirmek gerekiyordu. O satır kaldırıldı.

## Sertifika numaralandırma — yıl bazlı ve otomatik (30.09.2026)

- Ön ek artık **yıl**: `26-001 … 26-137`, 2027'de kendiliğinden `27-001`.
  `nextSerialNo` sayaçta `year` tutuyor; yıl değişince seri 1'den başlıyor.
- **Elle numaralandırma kaldırıldı.** Register'daki "Numbering" penceresi ve
  `NumberingForm` silindi; `counters/{id}` artık client'a tamamen kapalı
  (`allow write: if false`). Yanlış bir ön ek ya da geri alınan bir numara
  sicili sessizce bozar, verilmiş numara geri alınamaz.
- `importCertificates` sayacı YALNIZCA içinde bulunulan yılın serisinden
  ilerletiyor. Eskiden serideki son rakamlara bakıyordu; 25-237 içe
  aktarılınca 26 serisinin sayacı 238'e atlamıştı (elle 138'e çekildi).

### Sıralama hatası düzeltildi
`serialKey` yalnızca sondaki rakamları alıyordu: 25-131 → 131, 26-001 → 1.
Yeni yılın ilk sertifikası listenin en altına düşüyordu. Artık önce yıl,
sonra sıra numarası.

Register'da **bütün kolonlar sıralanabilir** (numara, ad, doğum yeri/tarihi,
eğitim, eğitmen, süre, tarih). Aynı kolona tekrar tıklamak yönü çevirir;
metin kolonları A→Z, sayı/tarih kolonları büyükten küçüğe başlar.

### AÇIK SORUN — çakışan iki numara
Kâğıt sicil içe aktarıldıktan sonra iki numara iki kez kullanılıyor:
- **26-052** — Talha Duygu / Safety Training (IMPORT) **ve** Enes Şavk / MOE
  (sınıf oturumundan üretilmiş, `26-52` biçiminde)
- **26-131** — Hüseyin Kılcıoğlu / MOE (IMPORT) **ve** Enes Şavk / SHT-145
  (sınıf oturumundan üretilmiş)

Sistemden üretilen iki belge, numaralandırma birleştirilmeden önce oturumda
elle girilen numarayı kullanmıştı. Kararı kullanıcı verecek: sistemden
üretilen ikisini yeni numaraya (26-138, 26-139) taşımak ya da silmek.

### Deneme sertifikaları silindi (30.09.2026)
`scripts/delete-test-certificates.js` ile 4 kayıt ve doğrulama belgeleri
silindi: `BA-00001`, `BA-00002` (online tamamlama denemeleri) ve `26-52`,
`26-131` (sınıf oturumu denemeleri). Son ikisi kâğıt sicilden gelen gerçek
26-052 / 26-131 ile çakışıyordu; çakışma kalmadı.

Kalan sertifika 244, hepsi tekil, 26 serisinin en büyüğü 137, sayaç 138'de —
bir sonraki belge `26-138` olacak.

Artıklar `scripts/cleanup-test-runs.js` ile temizlendi: iki deneme sınıf
oturumu katılımcılarıyla birlikte silindi, sertifikası kalmayan iki atama
PENDING'e döndürüldü (atama silinmez — kişi eğitimi yeniden alabilsin diye
sıfırlanır).

**Silme sırasında çıkan yan hasar ve düzeltmesi:** `26-131` numarası hem
sınıf denemesinde hem içe aktarılan gerçek belgede kullanılıyordu.
`certVerify` dokümanı numaraya göre anahtarlandığı için ikisine tek belge
hizmet ediyordu; deneme kaydı silinince **kâğıt sertifikanın doğrulaması da
gitti**. Elle geri kondu. Kontrol: 244 sertifika, 244 doğrulama kaydı,
sahipsiz kayıt yok.

**Ders:** `certVerify` doküman anahtarı seri numarası. Aynı numara iki
sertifikada kullanılırsa doğrulama kaydı paylaşılır ve birini silmek
diğerini de bozar. Numara artık tek kaynaktan ve otomatik verildiği için
çakışma oluşmamalı, ama silme işlemlerinde kontrol edilmeli.

### Sidebar antet bandı (30.09.2026)
Logo 212px'lik menüde 24px yüksekliğinde, dar bir beyaz kutuya sıkışmıştı.
Menü **232px**'ye genişledi; beyaz alan kart olmaktan çıkıp menünün tepesine
tam genişlikte oturan bir **antet bandına** dönüştü, logo **38px**. Altında
iki yanı çizgili "BONACADEMY" ve onun altında "TRAINING MANAGEMENT SYSTEM"
etiketi — basılı evraktaki antet mantığı.

Logo koyu metinli olduğu için beyaz zemine oturmak zorunda; grafit menüde
doğrudan kullanılamıyor.

## Belge önizleme ve SCORM'da kaldığı yerden devam (30.09.2026)

### Uygulama içi belge önizleme
Yeni bileşen `components/FilePreview.tsx`. "Open" bağlantıları dosyayı yeni
sekmede açıyordu; kullanıcı uygulamadan çıkıyor, geri dönmek için sekme
kapatıyordu. Belge artık pencere içinde açılıyor, üstünde **Print** ve
**Download** düğmeleriyle.

Dosya `fetch` ile alınıp **blob** URL'ine çevriliyor. Sebebi: Storage adresi
başka bir origin, tarayıcı oradaki iframe'i yazdırmaya izin vermiyor ve
`download` özniteliğini yok sayıyor. Blob aynı origin sayıldığından ikisi de
çalışıyor (Storage CORS'u uygulama adresine zaten açık). Alınamazsa doğrudan
adrese düşüyor ve "Open in new tab" gösteriyor — sessizce boş kutu değil.

Bağlandığı yerler: My Certificates, StaffDetail (eğitim tablosu, satır menüsü
ve External Certificates paneli).

### SCORM ilerlemesi
`ScormPlayer` yalnızca bellekte `cmi` tutuyordu; sayfa kapanınca öğrenci
eğitime baştan başlıyordu. Artık `assignments/{id}/scorm/{contentId}` altında
saklanıyor (`userId` + `cmi`), kural zaten bu yolu kişinin kendisine açıyordu.

- Yazma `LMSSetValue`, `LMSCommit`, `LMSFinish`/`Terminate` üzerinden, 800 ms
  gecikmeli (250 ms) — paketler sayfa geçişinde arka arkaya onlarca değer yazıyor.
  Bileşen sökülürken bekleyen yazma hemen gönderiliyor.
- Okuma iframe basılmadan ÖNCE: paket `LMSInitialize` sırasında
  `lesson_location` / `suspend_data` okuyor, sonradan yüklemek işe yaramaz.
  Durum gelene kadar "Restoring your progress…" gösteriliyor.
- Kurs önizlemesinde (`CourseDetail`) id verilmiyor, ilerleme saklanmıyor.

## Eğitim atama sayfası + yoklama eşleştirmesi (30.09.2026)

### `/assignments` — Assign Training
Menüde Training grubunda, ADMIN ve MANAGER'a açık. Atama eskiden yalnızca
Users satır menüsünde kişi kişi yapılabiliyordu: bir eğitimi 20 kişiye vermek
20 ayrı pencere demekti ve "kime ne zaman ne atadım" sorusunun cevabı hiçbir
yerde yoktu.

- Üstte üç sayı: açık / vadesi geçmiş / tamamlanmış.
- Liste: kişi (departmanıyla), eğitim, atanma tarihi, vade (geçmişse kaç gün
  geciktiği), durum, tamamlanma tarihi ve nasıl tamamlandığı (online /
  sınıf / dış sertifika). Arama + eğitim/departman/durum filtresi, yazdırma.
- Toplu atama penceresi: bir eğitim seçilir, kişiler departman ve isim
  filtresiyle işaretlenir. **Zaten atanmış olanlar seçilemez** — fonksiyon
  onları zaten atlıyordu ama seçilebilir göstermek "20 kişiye atadım" deyip
  12'sinin sessizce atlanmasına yol açıyordu.
- `assignCourses` kişi başına çalışıyor; toplu atama istemcide döngüyle ve
  ilerleme göstererek yapılıyor.

Müdür yalnızca kendi departmanını görür (sorgular `userDepartmentId` /
`departmentId` ile daraltılıyor — kapsamsız sorgu kural tarafından reddedilir).

### QR yoklama: ad/soyad ayrı ve büyük harf
Tek kutuda "talha duygu" ile "Duygu Talha" ayırt edilemiyordu. Form artık
**First Name** ve **Surname** soruyor, ikisi de Türkçe kurallarıyla BÜYÜK
harfe çevriliyor (i→İ); doğum yeri de öyle. `fullName` bunlardan üretiliyor.

### Katılımcı → personel eşleştirmesi
QR formu girişsiz açıldığı için orada `users` okunamıyor — eşleştirme ancak
eğitmen/admin oturumunda yapılabilir. Oturum detay sayfası artık:
- Katılımcı adını personel listesiyle karşılaştırıp **tek aday varsa**
  otomatik yazıyor ("Soyad Ad" sırası da deneniyor). İki aynı isim varsa
  seçim yapmıyor.
- **Staff** kolonu açılır listeye dönüştü: eğitmen yanlış eşleşmeyi
  düzeltebiliyor ya da "Not staff — external" diyebiliyor. `matchChecked`
  bayrağı otomatik eşleştirmenin elle seçimi ezmesini engelliyor.

Eşleşme yazıldığı an sertifika o kişiye bağlanıyor ve Training Follow-Up
hücresi kendiliğinden doluyor — matris tamamlamaları `certificates`
koleksiyonundan okuyor.

## Herkese açık ekranlar — koyu cam düzen (30.09.2026)

Giriş, sertifika doğrulama ve QR yoklama ekranları baştan aşağı kırmızıydı.
Sistemin geri kalanında kırmızı vurgu rengine indirilmişti; bu üç ekran eski
kimlikte kalmıştı. Ayrıca kırmızı zeminde kırmızı hata mesajı ("Incorrect
email or password") neredeyse görünmüyordu.

Ortak kabuk: `components/PublicShell.tsx` — koyu grafit zemin, üstten hafif
kırmızı ışık, buzlu cam kart, marka kilidi ve altta kurum künyesi
(DGCA SHT-145 · TR.145.118). Kenar çubuğuyla aynı dünyada olduğu için giriş
yapınca renk şoku olmuyor. Kırmızı yalnızca birincil düğmede ve hatada.

Koyu zemine uygun form yardımcıları da orada: `pubLabel`, `pubInput`,
`pubButton`, `PublicError`. Üç sayfa da bunları kullanıyor; beyaz kart
sınıfları (`input`, `label`, `btn-primary`) koyu zeminde okunmuyordu.
