"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function UploadScormForm({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    const changeNote = (form.elements.namedItem("changeNote") as HTMLInputElement).value;
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    if (changeNote) fd.append("changeNote", changeNote);
    const res = await fetch(`/api/admin/courses/${courseId}/upload`, {
      method: "POST",
      body: fd,
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error || "Yükleme başarısız");
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={upload} className="space-y-2">
      <div className="flex gap-2 items-center">
        <input name="file" type="file" accept=".zip" required />
        <button
          disabled={busy}
          className="btn-primary disabled:opacity-50"
        >
          {busy ? "Yükleniyor…" : "SCORM Yükle"}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
      <input
        name="changeNote"
        type="text"
        maxLength={1000}
        placeholder="Revizyon notu (örn. 'FAA kural güncellemesi 2026-Q1') — isteğe bağlı"
        className="input w-full text-sm"
      />
      <p className="text-[11px] text-slate-500">
        Her yeni SCORM yüklemesi otomatik olarak yeni bir revizyon oluşturur.
      </p>
    </form>
  );
}
