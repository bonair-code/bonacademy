export const runtime = "nodejs";
export const metadata = { title: "KVKK Aydınlatma Metni — BonAcademy" };

// KVKK 6698 sayılı kanun kapsamında aydınlatma metni. Login sayfasından
// link verilir. Hukuk ekibinin gözden geçirmesi gerekir — bu bir şablondur,
// son metin Bon Air hukuk/İK tarafından onaylanmadan kullanıcılara duyurulmamalıdır.

export default function KvkkPage() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto card p-8 space-y-4 text-sm text-slate-700 leading-relaxed">
        <div className="h-1 w-10 bg-brand-600 rounded-full" />
        <h1 className="text-2xl font-semibold text-slate-900">
          KVKK Aydınlatma Metni
        </h1>
        <p className="text-xs text-slate-500">Son güncelleme: {new Date().toLocaleDateString("tr-TR")}</p>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">1. Veri Sorumlusu</h2>
          <p>
            Bon Air Havacılık Sanayi ve Ticaret A.Ş. (“Bon Air”), 6698 sayılı Kişisel
            Verilerin Korunması Kanunu (“KVKK”) kapsamında veri sorumlusu sıfatıyla
            hareket eder. İletişim: <a className="underline" href="mailto:kvkk@bonair.com.tr">kvkk@bonair.com.tr</a>.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">2. İşlenen Kişisel Veriler</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Kimlik: ad, soyad, doğum tarihi, doğum yeri</li>
            <li>İletişim: kurumsal e-posta adresi</li>
            <li>Çalışan bilgisi: departman, yönetici, rol</li>
            <li>Eğitim/sınav kayıtları: SCORM ilerleme verisi (CMI), sınav cevapları, skorlar, sertifikalar</li>
            <li>Denetim kayıtları: giriş/çıkış zamanları, yönetici eylem logları (audit log), IP adresi</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">3. İşleme Amaçları ve Hukuki Sebep</h2>
          <p>
            Kişisel verileriniz; (a) zorunlu eğitimlerin planlanması, takibi ve
            yasal uyum (SHGM, EASA vb. havacılık mevzuatı) yükümlülüklerinin
            yerine getirilmesi, (b) sertifikaların üretilmesi ve doğrulanması,
            (c) bilgi güvenliği ve denetim kayıtlarının tutulması amaçlarıyla
            işlenir. Hukuki sebep: KVKK m.5/2-(a) kanunlarda açıkça öngörülmesi,
            m.5/2-(c) sözleşmenin kurulması/ifası, m.5/2-(ç) hukuki yükümlülük,
            m.5/2-(f) meşru menfaat.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">4. Aktarım</h2>
          <p>
            Veriler; barındırma hizmeti için Vercel Inc. (ABD) ve Neon Inc. (ABD)
            altyapısında, e-posta gönderimi için Microsoft 365 (Microsoft
            Ireland Operations Ltd.), güvenlik doğrulaması için Google LLC
            (reCAPTCHA) ile paylaşılır. Yurt dışına aktarım KVKK m.9 kapsamında
            açık rıza ve/veya gerekli güvence taahhütnameleri çerçevesinde
            gerçekleştirilir.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">5. Saklama Süresi</h2>
          <p>
            Eğitim ve sertifika kayıtları, ilgili havacılık mevzuatının öngördüğü
            süre boyunca (tipik olarak istihdam süresi + 10 yıl) saklanır. Audit
            loglar bilgi güvenliği standartları gereği en az 1 yıl tutulur.
            Süre sonunda veriler silinir, yok edilir veya anonim hâle getirilir.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">6. Haklarınız (KVKK m.11)</h2>
          <p>
            Kişisel verilerinizin işlenip işlenmediğini öğrenme, işlenmişse
            bilgi talep etme, düzeltme, silme/yok etme, aktarıldığı üçüncü
            kişileri öğrenme, işleme itiraz etme ve zarar hâlinde tazminat
            talep etme haklarına sahipsiniz. Başvurularınızı{" "}
            <a className="underline" href="mailto:kvkk@bonair.com.tr">kvkk@bonair.com.tr</a>{" "}
            adresine iletebilirsiniz.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-slate-900 mt-2">7. Çerezler</h2>
          <p>
            Yalnızca oturum açma (authentication session cookie) ve güvenlik
            doğrulaması (Google reCAPTCHA) için zorunlu çerezler kullanılır.
            Reklam veya pazarlama amaçlı izleme çerezi kullanılmaz.
          </p>
        </section>

        <div className="pt-4 text-xs">
          <a href="/login" className="underline hover:text-slate-900">
            ← Giriş sayfasına dön
          </a>
        </div>
      </div>
    </div>
  );
}
