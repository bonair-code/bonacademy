"use client";

import { useEffect, useState } from "react";

type ScormItem = {
  id: string;
  startedAt: string;
  finishedAt?: string | null;
};

type ExamItem = {
  id: string;
  attemptNo: number;
  score: number;
  passed: boolean;
  createdAt: string;
};

export function AttemptsHistoryDrawer({
  scormAttempts,
  examAttempts,
}: {
  scormAttempts: ScormItem[];
  examAttempts: ExamItem[];
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  const total = scormAttempts.length + examAttempts.length;

  return (
    <>
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
            className="h-5 w-5 text-teal-600"
          >
            <path d="M12 8v5l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" />
          </svg>
          <span className="font-semibold text-slate-900">Geçmiş Denemeler</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{total} kayıt</span>
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

      {open && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[85vh] bg-white shadow-2xl border border-slate-200 rounded-2xl overflow-hidden flex flex-col"
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
                  className="h-5 w-5 text-teal-600"
                >
                  <path d="M12 8v5l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" />
                </svg>
                <h3 className="font-semibold text-slate-900">Geçmiş Denemeler</h3>
                <span className="text-xs text-slate-400">({total})</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="h-8 w-8 rounded-full hover:bg-slate-100 text-slate-500 flex items-center justify-center"
                aria-label="Kapat"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-6">
              {scormAttempts.length > 0 && (
                <section>
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                    Eğitim içeriği ({scormAttempts.length})
                  </div>
                  <ul className="text-sm space-y-2">
                    {scormAttempts.map((at, i) => (
                      <li
                        key={at.id}
                        className="flex items-center gap-2 text-slate-700"
                      >
                        <span className="badge-teal text-[10px] shrink-0">
                          #{scormAttempts.length - i}
                        </span>
                        <span>
                          {new Date(at.startedAt).toLocaleString("tr-TR")}
                          {at.finishedAt
                            ? ` → ${new Date(at.finishedAt).toLocaleString("tr-TR")}`
                            : " · devam ediyor"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {examAttempts.length > 0 && (
                <section>
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                    Sınav denemeleri ({examAttempts.length})
                  </div>
                  <ul className="text-sm space-y-2">
                    {examAttempts.map((e) => (
                      <li key={e.id} className="flex items-center gap-2">
                        <span className="badge-teal text-[10px] shrink-0">
                          #{e.attemptNo}
                        </span>
                        <span
                          className={
                            e.passed
                              ? "text-emerald-700 font-medium"
                              : "text-red-700"
                          }
                        >
                          %{Math.round(e.score)} · {e.passed ? "Geçti" : "Kaldı"}
                        </span>
                        <span className="text-xs text-slate-500">
                          {new Date(e.createdAt).toLocaleString("tr-TR")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {total === 0 && (
                <p className="p-8 text-center text-slate-400 text-sm">
                  Henüz deneme yok.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
