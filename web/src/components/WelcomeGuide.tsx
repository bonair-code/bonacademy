/**
 * İlk girişte bir defa açılan karşılama penceresi.
 *
 * Kâğıt "İlk Giriş Rehberi" ile AYNI metin değil, bilerek: o rehberin ilk üç
 * adımı (adresi aç, geçici şifreyle gir, şifreni belirle) bu pencere
 * göründüğünde zaten yapılmış oluyor. Burada yalnızca giriş SONRASI işe
 * yarayan kısım var — nerede ne olduğu, sertifikaya basılan bilgi uyarısı ve
 * yardım. Yapılmış bir işi anlatmak kullanıcıyı pencereyi okumadan kapatmaya
 * iter.
 *
 * Dil: kişinin profilindeki dille açılır, sağ üstteki bayraklarla değişir.
 * Seçim yalnızca bu pencereyi etkiler; uygulamanın geri kalanı İngilizce.
 *
 * Bir kez görülür: kapatılınca users/{uid}.guideSeenAt yazılır. Alan kişinin
 * kendi dokümanında ve güvenlik kuralı yalnızca bu alana izin veriyor.
 */
import { useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { Flag } from "./Flag";
import type { Lang } from "../lib/lang";

const ORG_URL = "academy.bonair.com.tr";

type Copy = {
  eyebrow: string;
  title: string;
  intro: string;
  places: { name: string; text: string }[];
  warnTitle: string;
  warnText: string;
  helpTitle: string;
  helpText: string;
  addressLabel: string;
  cta: string;
};

const COPY: Record<Lang, Copy> = {
  TR: {
    eyebrow: "BonAcademy",
    title: "Hoş geldiniz",
    intro:
      "Eğitim kayıtlarınız, sertifikalarınız ve size atanan eğitimler bundan sonra bu sistem üzerinden yürütülecektir. Kısaca nerede ne olduğunu aktaralım.",
    places: [
      {
        name: "Dashboard",
        text: "Size atanan eğitimler “Assigned to you” başlığı altında listelenir. “Start Training” ile eğitime başlanır; yarım kalan eğitime kaldığı yerden devam edilir.",
      },
      {
        name: "My Record",
        text: "Tüm eğitim kayıtlarınız ve sertifikalarınız tek sayfada görüntülenir. Kurum dışından alınan eğitimler de bu sayfada yer alır.",
      },
    ],
    warnTitle: "Doğum yeri ve tarihiniz",
    warnText:
      "Bu bilgiler düzenlenen tüm eğitim sertifikalarının üzerine basılmaktadır. Hatalı girildiyse eğitim birimine bildiriniz.",
    helpTitle: "Destek",
    helpText: "Giriş veya kayıtlarınızla ilgili sorunlarda eğitim birimi ile iletişime geçiniz.",
    addressLabel: "Sistem adresi",
    cta: "Başlayalım",
  },
  EN: {
    eyebrow: "BonAcademy",
    title: "Welcome",
    intro:
      "Your training records, your certificates and the training assigned to you are managed through this system from now on. Here is where things are.",
    places: [
      {
        name: "Dashboard",
        text: "Training assigned to you is listed under “Assigned to you”. Use “Start Training” to begin; an unfinished course resumes where you left it.",
      },
      {
        name: "My Record",
        text: "All of your training records and certificates appear on one page, including training taken outside the organisation.",
      },
    ],
    warnTitle: "Your place and date of birth",
    warnText:
      "These are printed on every training certificate issued to you. If either is wrong, inform the training department.",
    helpTitle: "Support",
    helpText: "Contact the training department for any problem with sign-in or with your records.",
    addressLabel: "System address",
    cta: "Get started",
  },
};

export function WelcomeGuide({ onDone }: { onDone: () => void }) {
  const { user, profile } = useAuth();
  const [lang, setLang] = useState<Lang>(profile?.locale === "en" ? "EN" : "TR");
  const [busy, setBusy] = useState(false);
  const t = COPY[lang];

  async function close() {
    setBusy(true);
    try {
      if (user) await updateDoc(doc(db, "users", user.uid), { guideSeenAt: serverTimestamp() });
    } catch {
      // Yazılamazsa pencere yine kapanır: karşılama metni yüzünden
      // kullanıcıyı uygulamanın dışında tutmak doğru olmaz.
    } finally {
      onDone();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center p-4 sm:p-6"
      style={{ background: "rgba(8,8,10,.55)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div className="w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        {/* Başlık + dil seçimi */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-700">
              {t.eyebrow}
            </div>
            <h2 id="welcome-title" className="text-[26px] font-extrabold text-slate-900 mt-1">
              {t.title}
            </h2>
          </div>
          <div className="flex items-center gap-1 shrink-0 pt-1">
            {(["TR", "EN"] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                aria-label={l === "TR" ? "Türkçe" : "English"}
                className={`rounded-md p-1 transition ${
                  lang === l ? "bg-slate-900/10 ring-1 ring-slate-300" : "opacity-50 hover:opacity-100"
                }`}
              >
                <Flag lang={l} size={22} />
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 pb-6">
          <p className="text-[13.5px] leading-relaxed text-slate-600">{t.intro}</p>

          {/* Nerede ne var */}
          <div className="mt-4 grid gap-2.5">
            {t.places.map((p) => (
              <div key={p.name} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[12.5px] font-bold text-brand-700">{p.name}</div>
                <p className="text-[12.5px] leading-relaxed text-slate-600 mt-0.5">{p.text}</p>
              </div>
            ))}
          </div>

          {/* Sertifikaya basılan bilgi — tek vurgulu uyarı */}
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="text-[12.5px] font-bold text-amber-900">{t.warnTitle}</div>
            <p className="text-[12.5px] leading-relaxed text-amber-900/90 mt-0.5">{t.warnText}</p>
          </div>

          {/* Adres + destek */}
          <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-2 border-t border-slate-100 pt-3">
            <div className="min-w-0">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                {t.addressLabel}
              </div>
              <div className="text-[13px] font-semibold text-slate-800">{ORG_URL}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                {t.helpTitle}
              </div>
              <p className="text-[12px] leading-snug text-slate-600">{t.helpText}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void close()}
            disabled={busy}
            className="btn-primary w-full mt-5 py-2.5 text-[14px]"
          >
            {t.cta}
          </button>
        </div>
      </div>
    </div>
  );
}
