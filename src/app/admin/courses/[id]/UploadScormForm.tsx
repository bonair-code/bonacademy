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
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
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
    <form onSubmit={upload} className="flex gap-2 items-center">
      <input name="file" type="file" accept=".zip" required />
      <button
        disabled={busy}
        className="bg-slate-900 text-white rounded-lg px-4 py-2 disabled:opacity-50"
      >
        {busy ? "Yükleniyor…" : "SCORM Yükle"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  );
}
