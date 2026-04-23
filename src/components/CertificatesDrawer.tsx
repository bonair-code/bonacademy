"use client";

import { useState, useEffect } from "react";

type Cert = {
  id: string;
  serialNo: string;
  issuedAt: string; // ISO
  courseTitle: string;
};

export function CertificatesDrawer({ certs }: { certs: Cert[] }) {
  const [open, setOpen] = useState(false);

  // Esc ile kapat.
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  // Açıldığında body scroll'u kilitle.
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  return (
    <>
      {/* Trigger (card-görünümlü başlık) */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="card w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50/60 transition"
      >
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5 text-emerald-600"
          >
            <path d="M9 12l2 2 4-4M5 4h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-4l-3 4-3-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
          </svg>
          <span className="font-semibold text-slate-900">Sertifikalarım</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{certs.length} kayıt</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 text-slate-400"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </div>
      </button>

      {/* Overlay + Drawer */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`fixed bottom-0 left-0 right-0 z-50 w-full max-h-[80vh] bg-white shadow-2xl border-t border-slate-200 rounded-t-2xl transform transition-transform duration-200 ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 text-emerald-600"
            >
              <path d="M9 12l2 2 4-4M5 4h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-4l-3 4-3-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
            </svg>
            <h3 className="font-semibold text-slate-900">Sertifikalarım</h3>
            <span className="text-xs text-slate-400">({certs.length})</span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="h-8 w-8 rounded-full hover:bg-slate-100 text-slate-500 flex items-center justify-center"
            aria-label="Kapat"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto max-h-[calc(80vh-3.5rem)] divide-y divide-slate-100">
          {certs.length === 0 && (
            <p className="p-8 text-center text-slate-400 text-sm">
              Henüz sertifikanız yok.
            </p>
          )}
          {certs.map((c) => (
            <a
              key={c.id}
              href={`/api/certificate/${c.id}`}
              className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50/70 transition"
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-900 truncate">
                  {c.courseTitle}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Seri No: {c.serialNo}
                </div>
              </div>
              <span className="text-xs text-slate-500 shrink-0">
                {new Date(c.issuedAt).toLocaleDateString("tr-TR")}
              </span>
            </a>
          ))}
        </div>
      </aside>
    </>
  );
}
