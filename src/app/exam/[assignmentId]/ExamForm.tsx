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
  // Tek doğru cevap seçimi → soru başına sadece bir option id.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    // Tüm sorular cevaplanmadıysa uyar.
    const unanswered = questions.filter((q) => !answers[q.id]);
    if (unanswered.length > 0) {
      setError(`Lütfen tüm soruları cevaplayın (${unanswered.length} soru boş).`);
      return;
    }
    setError(null);
    setBusy(true);
    // Engine çoklu-seçim bekliyor → tek cevabı diziye sarıyoruz.
    const payload: Record<string, string[]> = {};
    for (const q of questions) payload[q.id] = [answers[q.id]];
    const res = await fetch(`/api/exam/${assignmentId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: payload }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.passed) {
      router.push(`/exam/${assignmentId}/result?attempt=${data.attemptNo}`);
    } else if (data.status === "RETAKE_REQUIRED") {
      router.push(`/exam/${assignmentId}/result?attempt=${data.attemptNo}&retake=1`);
    } else {
      router.push(`/exam/${assignmentId}/result?attempt=${data.attemptNo}`);
    }
  }

  function pick(qid: string, oid: string) {
    setAnswers((prev) => ({ ...prev, [qid]: oid }));
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
              <label
                key={o.id}
                className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-50 rounded px-1 py-0.5"
              >
                <input
                  type="radio"
                  name={`q_${q.id}`}
                  checked={answers[q.id] === o.id}
                  onChange={() => pick(q.id, o.id)}
                  className="h-4 w-4 accent-teal-600"
                />
                {o.text}
              </label>
            ))}
          </div>
        </div>
      ))}
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
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
