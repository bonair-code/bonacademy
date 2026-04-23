"use client";

import { useMemo, useState } from "react";

type Item = {
  id: string;
  serialNo: string;
  issuedAt: string;
  courseTitle: string;
};

export function CertificatesList({ items }: { items: Item[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    if (!needle) return items;
    return items.filter(
      (c) =>
        c.courseTitle.toLocaleLowerCase("tr").includes(needle) ||
        c.serialNo.toLocaleLowerCase("tr").includes(needle)
    );
  }, [items, q]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Kurs adı veya seri no ile ara..."
          className="input w-full pl-9"
        />
      </div>

      <div className="card divide-y divide-slate-100">
        {filtered.length === 0 ? (
          <p className="p-8 text-center text-slate-400 text-sm">
            {items.length === 0
              ? "Henüz sertifikanız yok."
              : "Aramanızla eşleşen sertifika bulunamadı."}
          </p>
        ) : (
          filtered.map((c) => (
            <a
              key={c.id}
              href={`/api/certificate/${c.id}`}
              target="_blank"
              rel="noopener"
              className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50/70 transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-9 w-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    <path d="M9 12l2 2 4-4M5 4h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-4l-3 4-3-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">
                    {c.courseTitle}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Seri No: {c.serialNo}
                  </div>
                </div>
              </div>
              <span className="text-xs text-slate-500 shrink-0">
                {new Date(c.issuedAt).toLocaleDateString("tr-TR")}
              </span>
            </a>
          ))
        )}
      </div>
    </div>
  );
}
