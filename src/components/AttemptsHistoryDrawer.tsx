"use client";

import { useState } from "react";

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
  const total = scormAttempts.length + examAttempts.length;

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50/60 transition"
        aria-expanded={open}
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
            className={`h-4 w-4 text-slate-400 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 p-5 space-y-6">
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
                      {new Date(at.startedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}
                      {at.finishedAt
                        ? ` → ${new Date(at.finishedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}`
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
                      {new Date(e.createdAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {total === 0 && (
            <p className="p-4 text-center text-slate-400 text-sm">
              Henüz deneme yok.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
