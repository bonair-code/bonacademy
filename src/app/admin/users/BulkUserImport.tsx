"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Result = {
  ok: boolean;
  created?: number;
  updated?: number;
  invitesSent?: number;
  errors?: string[];
  error?: string;
};

const TEMPLATE = `email,name,role,department,jobTitles,managerEmail
ali.veli@bonair.com.tr,Ali Veli,USER,Uçuş Operasyon,Pilot;Eğitmen,
ayse.demir@bonair.com.tr,Ayşe Demir,MANAGER,Kabin,Kabin Şefi,
mehmet.yilmaz@bonair.com.tr,Mehmet Yılmaz,USER,Kabin,Kabin Memuru,ayse.demir@bonair.com.tr
`;

export function BulkUserImport() {
  const router = useRouter();
  const t = useTranslations("admin.users");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    if (!file) return;
    setBusy(true);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    if ((form.elements.namedItem("sendInvites") as HTMLInputElement).checked) {
      fd.append("sendInvites", "on");
    }
    const res = await fetch("/api/admin/users/bulk-import", {
      method: "POST",
      body: fd,
    });
    const data: Result = await res.json();
    setBusy(false);
    setResult(data);
    if (res.ok) {
      form.reset();
      router.refresh();
    }
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kullanicilar-sablon.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card p-4 mt-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold">{t("bulkImportTitle")}</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            {t("bulkImportHelp")}
          </p>
        </div>
        <button
          type="button"
          onClick={downloadTemplate}
          className="btn-secondary text-xs"
        >
          {t("bulkImportTemplate")}
        </button>
      </div>

      <form onSubmit={upload} className="mt-4 space-y-3">
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="block text-sm"
        />
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            name="sendInvites"
            defaultChecked
            className="accent-brand-600"
          />
          {t("bulkImportSendInvites")}
        </label>
        <button type="submit" disabled={busy} className="btn-primary text-sm">
          {busy ? t("bulkImportUploading") : t("bulkImportSubmit")}
        </button>
      </form>

      {result && (
        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
            result.ok
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {result.ok ? (
            <>
              <p className="font-semibold mb-1">
                {t("bulkImportResult", {
                  created: result.created ?? 0,
                  updated: result.updated ?? 0,
                  invites: result.invitesSent ?? 0,
                })}
              </p>
              {result.errors && result.errors.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer underline">
                    {t("bulkImportErrorsCount", {
                      count: result.errors.length,
                    })}
                  </summary>
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    {result.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <p>{result.error}</p>
          )}
        </div>
      )}
    </section>
  );
}
