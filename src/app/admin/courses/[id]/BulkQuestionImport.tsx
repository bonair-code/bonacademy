"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function BulkQuestionImport({ courseId }: { courseId: string }) {
  const router = useRouter();
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
      setMsg(`Hata: ${data.error || "bilinmeyen"}`);
      return;
    }
    const errs = data.errors?.length ? ` · ${data.errors.length} hata` : "";
    setMsg(
      `${data.created} soru eklendi, ${data.skipped} satır atlandı${errs}` +
        (data.errors?.length ? `\n${data.errors.join("\n")}` : "")
    );
    form.reset();
    router.refresh();
  }

  return (
    <div className="border rounded-lg p-3 bg-slate-50 space-y-2 text-sm">
      <div className="font-medium">Toplu Soru Yükleme</div>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/admin/courses/${courseId}/questions/template`}
          className="border rounded-lg px-3 py-1.5 bg-white hover:bg-slate-100"
        >
          📥 Şablon İndir (xlsx)
        </a>
        <form onSubmit={upload} className="flex items-center gap-2">
          <input name="file" type="file" accept=".xlsx" required className="text-xs" />
          <button
            disabled={busy}
            className="bg-slate-900 text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
          >
            {busy ? "Yükleniyor…" : "Toplu Yükle"}
          </button>
        </form>
      </div>
      {msg && (
        <pre className="text-xs text-slate-700 whitespace-pre-wrap bg-white border rounded p-2">
          {msg}
        </pre>
      )}
      <p className="text-xs text-slate-500">
        Şablonu indir, Excel'de doldur ve aynı dosyayı buradan yükle. Format:
        Soru · Puan · Şık1–4 · Doğru1–4 (1/X = doğru).
      </p>
    </div>
  );
}
