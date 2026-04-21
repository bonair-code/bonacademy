"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Q = { id: string; text: string; options: { id: string; text: string }[] };

export function ExamForm({
  assignmentId,
  questions,
}: {
  assignmentId: string;
  questions: Q[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await fetch(`/api/exam/${assignmentId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.passed) {
      alert(`Tebrikler! Puan: ${data.score.toFixed(0)}`);
      router.push("/dashboard");
    } else if (data.status === "RETAKE_REQUIRED") {
      alert("İki deneme de başarısız oldu. Eğitimi tekrar etmeniz gerekiyor.");
      router.push(`/course/${assignmentId}`);
    } else {
      alert(`Başarısız. Puan: ${data.score.toFixed(0)}. Bir deneme hakkınız kaldı.`);
      router.push("/dashboard");
    }
  }

  function toggle(qid: string, oid: string) {
    setAnswers((prev) => {
      const cur = prev[qid] ?? [];
      return { ...prev, [qid]: cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid] };
    });
  }

  return (
    <div className="space-y-4">
      {questions.map((q, i) => (
        <div key={q.id} className="bg-white border rounded-xl p-4">
          <div className="font-medium mb-2">
            {i + 1}. {q.text}
          </div>
          <div className="space-y-1">
            {q.options.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={(answers[q.id] ?? []).includes(o.id)}
                  onChange={() => toggle(q.id, o.id)}
                />
                {o.text}
              </label>
            ))}
          </div>
        </div>
      ))}
      <button
        onClick={submit}
        disabled={busy}
        className="bg-slate-900 text-white rounded-lg px-5 py-2 hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? "Gönderiliyor…" : "Sınavı Gönder"}
      </button>
    </div>
  );
}
