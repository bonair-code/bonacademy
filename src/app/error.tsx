"use client";

import { useEffect } from "react";

// Root-level error boundary. Server action veya render sırasında fırlatılan
// (yakalanmamış) hatalar burada gösterilir — jenerik Next.js hata ekranı
// yerine. Hata mesajı kullanıcıya sunulur ama stack trace gizli tutulur.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Yeni deploy sonrası eski sekme artık olmayan chunk'ı ister → "Loading chunk
  // X failed". Bu durumda tek mantıklı çözüm tam sayfa yenileme: yeni HTML yeni
  // chunk hash'lerini çeker. reset() işe yaramaz çünkü client bundle hâlâ eski.
  const isChunkLoadError =
    /Loading chunk [\w\d]+ failed|ChunkLoadError|Failed to fetch dynamically imported module/i.test(
      `${error?.name} ${error?.message}`
    );

  useEffect(() => {
    console.error("[app-error]", error);
    if (isChunkLoadError && typeof window !== "undefined") {
      // Sonsuz döngüyü önlemek için zaman damgalı bayrak: son 30 sn içinde
      // zaten bir kez yenilediyseysek tekrar yenileme (reload loop riski).
      // 30 sn'den eskiyse sıfırla — aynı sekmede ikinci, ilgisiz chunk
      // hatası olursa o da yenilenebilsin.
      const key = "bonacademy:chunk-reload-at";
      const last = Number(sessionStorage.getItem(key) || "0");
      const now = Date.now();
      if (now - last > 30_000) {
        sessionStorage.setItem(key, String(now));
        window.location.reload();
      }
    }
  }, [error, isChunkLoadError]);

  const friendly = isChunkLoadError
    ? "Uygulama güncellendi. Sayfa yenileniyor…"
    : error.message || "Beklenmeyen bir hata oluştu.";

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-6 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center text-2xl mb-3">
          !
        </div>
        <h1 className="text-lg font-semibold text-slate-900 mb-1">
          Bir sorun oluştu
        </h1>
        <p className="text-sm text-slate-600 mb-4 break-words">{friendly}</p>
        {error.digest && (
          <p className="text-[11px] text-slate-400 mb-4">
            Referans: <code>{error.digest}</code>
          </p>
        )}
        <div className="flex gap-2 justify-center">
          <button onClick={reset} className="btn-primary text-sm">
            Yeniden Dene
          </button>
          <a href="/dashboard" className="btn-secondary text-sm">
            Gösterge Paneli
          </a>
        </div>
      </div>
    </main>
  );
}
