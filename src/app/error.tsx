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
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  const friendly = error.message || "Beklenmeyen bir hata oluştu.";

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
