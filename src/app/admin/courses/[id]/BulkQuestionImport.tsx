"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export function BulkQuestionImport({ courseId }: { courseId: string }) {
  const router = useRouter();
  const t = useTranslations("adminCourses");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/admin/courses/${courseId}/questions/import`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg(t("bulk.errorPrefix", { msg: data.error || t("bulk.unknownError") }));
      return;
    }
    const errs = data.errors?.length ? t("bulk.errorCount", { count: data.errors.length }) : "";
    setMsg(
      t("bulk.result", { created: data.created, skipped: data.skipped, errs }) +
        (data.errors?.length ? `\n${data.errors.join("\n")}` : "")
    );
    form.reset();
    router.refresh();
  }

  return (
    <div className="border rounded-lg p-3 bg-slate-50 space-y-2 text-sm">
      <div className="font-medium">{t("bulk.title")}</div>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/admin/courses/${courseId}/questions/template`}
          className="border rounded-lg px-3 py-1.5 bg-white hover:bg-slate-100"
        >
          📥 {t("bulk.downloadTemplate")}
        </a>
        <form onSubmit={upload} className="flex items-center gap-2">
          <input name="file" type="file" accept=".xlsx" required className="text-xs" />
          <button
            disabled={busy}
            className="bg-slate-900 text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
          >
            {busy ? t("bulk.uploading") : t("bulk.bulkUpload")}
          </button>
        </form>
      </div>
      {msg && (
        <pre className="text-xs text-slate-700 whitespace-pre-wrap bg-white border rounded p-2">
          {msg}
        </pre>
      )}
      <p className="text-xs text-slate-500">
        {t("bulk.helpBefore")}
        <strong>{t("bulk.helpStrong")}</strong>
        {t("bulk.helpMiddle")}
        <code>{t("bulk.helpCode1")}</code>
        {t("bulk.helpOr")}
        <code>{t("bulk.helpCode2")}</code>
        {t("bulk.helpAfter")}
      </p>
    </div>
  );
}
