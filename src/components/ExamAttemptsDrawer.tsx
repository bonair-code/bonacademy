"use client";

import { useEffect, useState } from "react";

type Attempt = {
  id: string;
  attemptNo: number;
  score: number;
  passed: boolean;
  finishedAt?: string | null;
};

export function ExamAttemptsDrawer({ attempts }: { attempts: Attempt[] }) {
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

  const sorted = attempts.slice().sort((a, b) => b.attemptNo - a.attemptNo);

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
          <span className="font-semibold text-slate-900">Önceki Denemeler</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{attempts.length} kayıt</span>
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
                <h3 className="font-semibold text-slate-900">Önceki Denemeler</h3>
                <span className="text-xs text-slate-400">({attempts.length})</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="h-8 w-8 rounded-full hover:bg-slate-100 text-slate-500 flex items-center justify-center"
                aria-label="Kapat"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
              {sorted.length === 0 && (
                <p className="p-8 text-center text-slate-400 text-sm">
                  Henüz deneme yok.
                </p>
              )}
              {sorted.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="badge-teal text-[10px] shrink-0">
                      #{e.attemptNo}
                    </span>
                    <div className="min-w-0">
                      <div
                        className={`font-medium ${
                          e.passed ? "text-emerald-700" : "text-red-700"
                        }`}
                      >
                        %{Math.round(e.score)} · {e.passed ? "Geçti" : "Kaldı"}
                      </div>
                      {e.finishedAt && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          {new Date(e.finishedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
