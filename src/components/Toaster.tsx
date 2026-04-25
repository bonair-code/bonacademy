"use client";

import { useEffect, useState } from "react";
import type { FlashPayload } from "@/lib/flash";
import { clearFlash } from "@/app/actions/clearFlash";

// Sağ alt köşe toast — layout flash cookie'sini okur, varsa initial olarak
// geçer; bu component bir kez gösterip 4 saniye sonra fade-out ile kaldırır.

export function Toaster({ initial }: { initial: FlashPayload | null }) {
  const [toast, setToast] = useState<FlashPayload | null>(initial);
  const [closing, setClosing] = useState(false);

  // Layout her yeni flash için Toaster'a `key={flash.id}` veriyor; bu sayede
  // component tamamen unmount/mount oluyor ve useState taze initial alıyor.
  // Burada prop sync useEffect'ine gerek yok.

  useEffect(() => {
    if (!toast) return;
    setClosing(false);
    // Cookie'yi hemen temizle ki sayfa yenilendiğinde toast tekrar gözükmesin.
    void clearFlash().catch(() => {});
    const fade = setTimeout(() => setClosing(true), 3500);
    const remove = setTimeout(() => setToast(null), 4000);
    return () => {
      clearTimeout(fade);
      clearTimeout(remove);
    };
  }, [toast]);

  if (!toast) return null;

  const palette =
    toast.kind === "error"
      ? "bg-red-600 text-white border-red-700"
      : toast.kind === "info"
        ? "bg-slate-800 text-white border-slate-900"
        : "bg-emerald-600 text-white border-emerald-700";

  const icon =
    toast.kind === "error" ? "✕" : toast.kind === "info" ? "ℹ" : "✓";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 right-4 z-[70] max-w-sm rounded-xl border shadow-lg px-4 py-3 text-sm flex items-start gap-3 transition-all duration-500 ${palette} ${
        closing ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"
      }`}
    >
      <span className="text-base font-bold leading-none mt-0.5">{icon}</span>
      <span className="leading-snug">{toast.message}</span>
      <button
        type="button"
        onClick={() => setClosing(true)}
        className="ml-2 text-white/80 hover:text-white text-lg leading-none"
        aria-label="close"
      >
        ×
      </button>
    </div>
  );
}
