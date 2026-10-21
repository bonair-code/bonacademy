import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { ORG } from "../lib/org";

/**
 * Herkese açık ekranların ortak kabuğu: giriş, davet, sertifika doğrulama ve
 * QR yoklama formu.
 *
 * Tasarım "B" (onaylandı 21.10.2026; seçenekler docs/tasarim/giris-foto.html):
 * tam ekran fotoğraf + üstünde koyu perde + ortada beyaz kart. Fotoğraf
 * BonAir Technic'in kendi hat bakımı karesi — kuruma ait, telif sorunu yok.
 *
 * Kart BEYAZ: eskiden koyu cam kartı vardı ve form alanlarının kontrastı
 * düşüktü. Bu yüzden `pub*` yardımcıları da açık zemine göre yazıldı — koyu
 * zemin varsayan eski sınıflar bu kartta okunmazdı.
 */

/** Perde ŞART: fotoğrafın üstüne yazı ve kart geliyor; kontrast tesadüfe
 *  bırakılamaz. Fotoğraf değişse bile üst bar ve alt künye okunur kalır. */
const SCRIM =
  "linear-gradient(180deg,rgba(8,8,10,.66) 0%,rgba(8,8,10,.74) 55%,rgba(8,8,10,.84) 100%)," +
  "radial-gradient(62% 48% at 50% 0%,rgba(227,30,36,.22),transparent 72%)";

export function PublicShell({
  title,
  subtitle,
  children,
  width = "max-w-[400px]",
}: {
  /** Kartın başındaki başlık. */
  title?: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
}) {
  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-16 overflow-hidden bg-[#0d0d0f]">
      {/* Arka plan: `img` değil `div`, çünkü içerik değil dekor — ekran
          okuyucuya duyurulmasın. Yüklenene kadar koyu zemin duruyor. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/login-bg.jpg)" }}
      />
      <div aria-hidden className="absolute inset-0" style={{ background: SCRIM }} />

      {/* Üst bar — telefonda çentiğin altına iner (viewport-fit=cover). */}
      <div className="absolute top-0 inset-x-0 z-10 flex items-center px-5 sm:px-7 h-[72px] max-lg:pt-[env(safe-area-inset-top)] max-lg:h-[calc(72px+env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <img src="/Logo-mono.png" alt={ORG.name} className="h-[26px] w-auto" />
          <span className="text-[15px] font-semibold tracking-[-0.015em] text-white">
            {ORG.productName}
          </span>
        </div>
      </div>

      <div className={`relative z-10 w-full ${width}`}>
        <div
          className="rounded-[18px] bg-white px-7 py-7 sm:px-8"
          style={{
            border: "1px solid rgba(255,255,255,.5)",
            boxShadow: "0 40px 90px -30px rgba(0,0,0,.65), 0 2px 6px rgba(0,0,0,.18)",
          }}
        >
          {title && (
            <>
              <h1 className="text-[23px] font-semibold tracking-[-0.028em] text-slate-900">
                {title}
              </h1>
              {subtitle && (
                <p className="text-[13.5px] text-slate-500 mt-1.5 mb-6 leading-relaxed">
                  {subtitle}
                </p>
              )}
              {!subtitle && <div className="mb-6" />}
            </>
          )}
          {children}
        </div>
      </div>

      <p className="absolute bottom-0 inset-x-0 z-10 pb-6 max-lg:pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-center text-[11px] text-white/55">
        {ORG.publicFooter}
      </p>
    </div>
  );
}

/* ── Form parçaları — hepsi BEYAZ kart için ──────────────────────────── */

export const pubLabel = "block text-[12.5px] font-medium text-slate-700 mb-1.5";

/**
 * 46px yükseklik, 1px kenarlık, 10px yarıçap, 4px odak halkası.
 * 16px yazı boyutu bilinçli: daha küçüğünde iPhone Safari alana dokununca
 * sayfayı kendiliğinden yakınlaştırıyor.
 */
export const pubInput =
  "w-full h-[46px] rounded-[10px] px-3.5 text-[16px] sm:text-[15px] text-slate-900 " +
  "placeholder:text-slate-400 bg-white border border-slate-300 outline-none transition " +
  "focus:border-brand-600 focus:ring-4 focus:ring-brand-600/12";

/** Açık zeminde okunur hata kutusu. */
export function PublicError({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12.5px] rounded-[9px] px-3 py-2.5 mb-3 text-red-800 bg-red-50 border border-red-200">
      {children}
    </p>
  );
}

/** Birincil düğme — ekrandaki tek kırmızı öğe. */
export const pubButton =
  "w-full h-[46px] rounded-[10px] text-[15px] font-medium text-white bg-brand-600 " +
  "hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition";

/**
 * Şifre alanı + göster/gizle düğmesi.
 *
 * `pubInput` sınıfını olduğu gibi kullanır, yalnızca sağ kenara bir düğme
 * koyar — görünüm başka alanlarla aynı kalsın. Düğme form gönderimini
 * tetiklemesin diye type="button"; ekran okuyucu için durumu söyler.
 */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        type={show ? "text" : "password"}
        className={`${pubInput} pr-12 ${props.className ?? ""}`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        title={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 grid place-items-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
      >
        {show ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
            <path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a10.6 10.6 0 0 0 5.4-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
