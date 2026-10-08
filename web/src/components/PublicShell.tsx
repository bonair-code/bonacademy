import { lazy, Suspense, useCallback, useEffect, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { ORG } from "../lib/org";
import { useLoginFlight } from "../lib/loginFlight";

/* 3D uçak tembel yükleniyor: three.js yalnızca herkese açık ekranlarda iner. */
const PlaneScene = lazy(() => import("./PlaneScene"));

/**
 * Herkese açık ekranların ortak kabuğu: giriş, şifre sıfırlama, sertifika
 * doğrulama ve QR yoklama formu.
 *
 * Tasarım "gece uçuşu" (C2): yıldızlı lacivert gökyüzü, 3D uçak (Cessna 172,
 * bkz. PlaneScene) ve sağda buzlu cam panel. Giriş başarılı olunca uçak sağa
 * uçar, panel kaybolur, ekran kararır (lib/loginFlight). 3D hazır olana kadar
 * — ya da WebGL yoksa — sertifikadaki uçak çizimi görünür. Logo kutusuz, beyaz — koyu zemine
 * doğrudan oturuyor. Telefonda panel ortalanır, uçak küçülür.
 *
 * İçerik koyu zemine oturduğu için alanlar `pub*` yardımcılarıyla
 * çizilmeli; şifre alanı için `PasswordInput`.
 */

/** Sağ üstteki saat. Yalnızca dakika değişince yeniden çizilir. */
function Clock() {
  const fmt = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const [t, setT] = useState(fmt);
  useEffect(() => {
    const h = setInterval(() => setT(fmt()), 15_000);
    return () => clearInterval(h);
  }, []);
  return <span className="text-[15px] font-semibold text-white/90 tabular-nums">{t}</span>;
}

/** Yıldızlar: tek katman, birkaç radial-gradient — görsel dosyası yok. */
const STARS = [
  "12% 18%", "32% 8%", "48% 26%", "64% 12%", "22% 42%", "8% 70%", "40% 62%", "55% 80%",
  "85% 40%", "75% 22%", "92% 70%", "28% 88%", "68% 52%", "4% 32%",
]
  .map((p, i) => `radial-gradient(${i % 3 === 0 ? 1.5 : 1}px ${i % 3 === 0 ? 1.5 : 1}px at ${p}, rgba(255,255,255,${i % 2 ? 0.45 : 0.7}), transparent)`)
  .join(",");

export function PublicShell({
  title,
  subtitle,
  children,
  width = "max-w-[400px]",
}: {
  /** Panelin başlığı. */
  title?: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
}) {
  const flight = useLoginFlight();
  const [plane3d, setPlane3d] = useState(false);
  const onReady = useCallback(() => setPlane3d(true), []);
  return (
    <div
      className="relative min-h-screen overflow-hidden flex flex-col transition-opacity duration-[450ms] ease-out"
      style={{
        opacity: flight.fading ? 0 : 1,
        background:
          "radial-gradient(120% 90% at 70% 10%, #1d3260 0%, #0d1730 55%, #070d1d 100%)",
      }}
    >
      <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: STARS }} aria-hidden />
      {/* Sertifikadaki kurşun kalem uçak çizimi, ters çevrilip ışıklı siluete
          dönüştürülmüş. Dekor — ekran okuyucudan gizli. */}
      <img
        src="/cert-watermark.jpg"
        alt=""
        aria-hidden
        className={`pointer-events-none select-none absolute transition-opacity duration-700 ${plane3d ? "!opacity-0" : ""} left-[-40px] top-[22%] w-[min(760px,70vw)] max-lg:left-1/2 max-lg:-translate-x-1/2 max-lg:top-[8%] max-lg:w-[520px] max-lg:opacity-[0.18]`}
        style={{
          // Kâğıt zemini ters çevrilince tam siyah olmuyor, kutu gibi
          // seçiliyordu: kontrast zemini siyaha çekiyor (screen'de görünmez),
          // maske de kenarları eritiyor.
          filter: "invert(1) contrast(1.8) brightness(1.15)",
          mixBlendMode: "screen",
          opacity: 0.3,
          maskImage: "radial-gradient(ellipse 60% 55% at 55% 50%, #000 55%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 60% 55% at 55% 50%, #000 55%, transparent 100%)",
        }}
      />

      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${plane3d ? "opacity-100" : "opacity-0"}`}>
        <Suspense fallback={null}>
          <PlaneScene onReady={onReady} />
        </Suspense>
      </div>

      {/* Üst şerit: kutusuz beyaz logo, sağda saat */}
      <header className="relative z-10 flex items-center justify-between px-5 sm:px-7 pt-5">
        <img
          src="/Logo.png"
          alt={ORG.name}
          className="h-9 sm:h-10 w-auto"
          style={{ filter: "brightness(0) invert(1)" }}
        />
        <Clock />
      </header>

      {/* Telefonda panel aşağıda: üstteki gökyüzü uçağa kalır */}
      <main className="relative z-10 flex-1 flex items-end lg:items-center justify-center lg:justify-end px-4 sm:px-8 lg:pr-[7vw] pt-[30vh] pb-6 lg:py-10">
        <div
          className={`w-full ${width} rounded-3xl px-7 sm:px-8 py-8 sm:py-9 text-white transition-[opacity,transform] duration-500 ${
            flight.flying ? "opacity-0 translate-x-[60px] scale-[.96]" : ""
          }`}
          style={{
            background: "rgba(255,255,255,.10)",
            border: "1px solid rgba(255,255,255,.20)",
            backdropFilter: "blur(40px)",
            WebkitBackdropFilter: "blur(40px)",
            boxShadow: "0 30px 60px rgba(0,0,0,.35)",
          }}
        >
          <div className="text-[13px] font-semibold text-[#a9c1ef] mb-1">{ORG.productName}</div>
          {title && (
            <>
              <h2 className="text-[28px] sm:text-[30px] font-semibold tracking-[-0.025em] leading-tight">{title}</h2>
              {subtitle && <p className="text-[15px] text-white/70 mt-1.5 mb-5">{subtitle}</p>}
              {!subtitle && <div className="mb-5" />}
            </>
          )}
          {children}
        </div>
      </main>

      <footer className="relative z-10 px-5 sm:px-7 pb-5 flex items-center justify-between gap-4 text-[12px] text-white/50">
        <span>{ORG.publicFooter}</span>
        {plane3d && <ModelCredit />}
      </footer>
    </div>
  );
}

/**
 * 3D modelin kredisi: küçük küp simgesi, üzerine gelince (dokunmatik ekranda
 * dokununca) yapan kişinin adı. Link yok. Lisans (CC BY 4.0) yapan kişinin
 * adının ve lisansın anılmasını şart koşuyor — ikisi de burada.
 */
function ModelCredit() {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative group">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        aria-label="3D Model by Sousinho, CC BY 4.0"
        className="h-7 w-7 grid place-items-center rounded-full text-white/45 hover:text-white/80 hover:bg-white/10 focus-visible:text-white/80 transition"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
          <path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z" />
          <path d="M4 7.4l8 4.6 8-4.6M12 12v9.2" />
        </svg>
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-lg px-3 py-2 text-right transition-opacity duration-150 ${
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
        style={{ background: "rgba(10,16,32,.85)", border: "1px solid rgba(255,255,255,.15)", backdropFilter: "blur(12px)" }}
      >
        <span className="block text-[12.5px] font-medium text-white/90">3D Model by Sousinho</span>
        <span className="block text-[10.5px] text-white/50 mt-0.5">CC BY 4.0</span>
      </span>
    </span>
  );
}

/** Koyu zemine uygun form alanı sınıfları. */
export const pubLabel = "block text-[12.5px] font-medium mb-1.5 text-white/75";
export const pubInput =
  "w-full rounded-xl px-4 py-3 text-[15px] text-white placeholder:text-white/40 outline-none " +
  "bg-white/[.14] border border-white/25 focus:border-white/60 focus:bg-white/[.20] transition";

/**
 * Şifre alanı + göster/gizle düğmesi. Düğme form gönderimini tetiklemesin
 * diye type="button"; ekran okuyucu için durumu söyleyen etiket taşır.
 */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? "text" : "password"} className={`${pubInput} pr-12 ${props.className ?? ""}`} />
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

/** Koyu zeminde okunur hata kutusu. */
export function PublicError({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-[13px] rounded-xl px-3 py-2.5 mb-3"
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

/** Koyu zeminde birincil düğme — beyaz hap. */
export const pubButton =
  "w-full rounded-full py-3 text-[16px] font-semibold text-brand-900 bg-white " +
  "hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition";
