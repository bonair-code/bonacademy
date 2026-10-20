import { useState, type InputHTMLAttributes, type ReactNode } from "react";

/**
 * Herkese açık ekranların ortak kabuğu: giriş, sertifika doğrulama ve QR
 * yoklama formu.
 *
 * Üçü de sistemin dışından görülüyor ve aynı kimliği taşımalı. Koyu grafit
 * zemin uygulamanın kenar çubuğuyla aynı dünyada — giriş yapınca renk şoku
 * olmuyor. Kırmızı yalnızca vurgu: üstten gelen hafif ışık ve birincil düğme.
 *
 * Kart buzlu cam; içerik beyaz kutular yerine koyu zemine oturduğu için
 * `publicField` yardımcıları kullanılmalı.
 */
export function PublicShell({
  title,
  subtitle,
  children,
  width = "max-w-[400px]",
}: {
  /** Kartın üstündeki marka bloğunun altında görünen başlık. */
  title?: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
}) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{
        background:
          "radial-gradient(60% 45% at 50% 6%, rgba(227,30,36,.20), transparent 70%), linear-gradient(180deg,#232327 0%,#141416 100%)",
      }}
    >
      <div className={`w-full ${width}`}>
        <div className="flex flex-col items-center mb-6">
          {/* Logo koyu metinli; beyaz bir zemine oturmak zorunda. */}
          <span className="bg-white rounded-xl px-4 py-2.5 shadow-lg">
            <img src="/Logo.png" alt="Bon Air" className="h-8 w-auto block" />
          </span>
          <h1 className="text-white text-[19px] font-semibold tracking-[-0.018em] mt-4">
            BonAcademy
          </h1>
          <p
            className="text-[9px] font-semibold uppercase mt-1.5"
            style={{ color: "#98989d", letterSpacing: "0.15em" }}
          >
            Training Management System
          </p>
        </div>

        <div
          className="rounded-2xl px-6 py-6 shadow-2xl"
          style={{
            background: "rgba(255,255,255,.07)",
            border: "1px solid rgba(255,255,255,.12)",
            backdropFilter: "blur(18px)",
          }}
        >
          {title && (
            <>
              <h2 className="text-[17px] font-semibold text-white tracking-[-0.018em]">{title}</h2>
              {subtitle && (
                <p className="text-[12px] mt-1 mb-5" style={{ color: "#98989d" }}>
                  {subtitle}
                </p>
              )}
            </>
          )}
          {children}
        </div>

        <p className="text-center text-[10.5px] mt-5" style={{ color: "#6e6e73" }}>
          BonAir Aviation · Turkish DGCA SHT-145 · TR.145.118
        </p>
      </div>
    </div>
  );
}

/** Koyu zemine uygun form alanı sınıfları. */
export const pubLabel =
  "block text-[9.5px] font-semibold uppercase mb-1.5 text-[#98989d] tracking-[0.09em]";
export const pubInput =
  "w-full rounded-[10px] px-3 py-2.5 text-[13px] text-white placeholder:text-white/30 outline-none " +
  "bg-white/[.08] border border-white/[.14] focus:border-white/30 focus:bg-white/[.12] transition";

/** Koyu zeminde okunur hata kutusu. */
export function PublicError({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-[11.5px] rounded-[9px] px-2.5 py-2 mb-3"
      style={{
        color: "#ffb4b1",
        background: "rgba(224,51,44,.16)",
        border: "1px solid rgba(224,51,44,.35)",
      }}
    >
      {children}
    </p>
  );
}

/** Koyu zeminde birincil düğme — tek kırmızı öğe. */
export const pubButton =
  "w-full rounded-[10px] py-2.5 text-[13px] font-semibold text-white bg-brand-600 " +
  "hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition";

/**
 * Şifre alanı + göster/gizle düğmesi.
 *
 * Giriş ekranının görünümünü değiştirmez: `pubInput` sınıfını olduğu gibi
 * kullanır, yalnızca sağ kenara bir düğme koyar. Invite ve Login sayfaları
 * bunu kullanıyor. Düğme form gönderimini tetiklemesin diye type="button";
 * ekran okuyucu için durumu söyleyen etiket taşır.
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
        className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded-full text-white/75 hover:text-white hover:bg-white/10 transition"
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
