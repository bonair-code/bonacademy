/**
 * Dil bayrakları.
 *
 * Emoji bayrak kullanılmıyor: Windows'ta emoji bayraklar desteklenmiyor ve
 * ekranda "TR" / "GB" harf çifti olarak çıkıyor — tam da bayrak kullanmanın
 * sebebini ortadan kaldırıyor. Bu yüzden çizildi.
 *
 * Yeni dil eklemek: FLAGS'e bir giriş, lib/lang.ts'e bir satır.
 */
import type { Lang } from "../lib/lang";

/**
 * Union Jack'in çapraz şeritleri tek bir clip-path ile kesiliyor. Sayfada bir
 * kez tanımlanması yeterli; aynı id'yi her bayrakta tekrar tanımlamak geçersiz
 * HTML üretirdi. <AppFlagDefs /> uygulama kökünde bir kez basılıyor.
 */
export function AppFlagDefs() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute" focusable="false">
      <defs>
        <clipPath id="bonacademy-uj">
          <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
        </clipPath>
      </defs>
    </svg>
  );
}

const FLAGS: Record<Lang, { viewBox: string; body: React.ReactNode }> = {
  TR: {
    viewBox: "0 0 30 20",
    body: (
      <>
        <rect width="30" height="20" fill="#E30A17" />
        <circle cx="11.25" cy="10" r="5" fill="#fff" />
        <circle cx="12.9" cy="10" r="4" fill="#E30A17" />
        <path fill="#fff" d="M17.7 10l3.5-1.14-2.16 2.98V8.16l2.16 2.98z" />
      </>
    ),
  },
  EN: {
    viewBox: "0 0 60 30",
    body: (
      <>
        <rect width="60" height="30" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path
          d="M0,0 L60,30 M60,0 L0,30"
          clipPath="url(#bonacademy-uj)"
          stroke="#C8102E"
          strokeWidth="4"
        />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </>
    ),
  },
};

export function Flag({ lang, size = 20 }: { lang: Lang; size?: number }) {
  const f = FLAGS[lang];
  if (!f) return null;
  return (
    <svg
      viewBox={f.viewBox}
      width={size}
      height={Math.round((size * 2) / 3)}
      aria-hidden
      focusable="false"
      className="shrink-0 rounded-[2px]"
      style={{ boxShadow: "0 0 0 1px rgba(15,23,42,.14)", display: "block" }}
      preserveAspectRatio="none"
    >
      {f.body}
    </svg>
  );
}
