import { useMemo, useState } from "react";

export type ExamQ = { id: string; text: string; options: { id: string; text: string }[] };

/**
 * Tek soru ekranlı sınav. Üstte soru gezgini (işaretli / boş / şu anki),
 * altta ileri-geri. Gönderirken boş soru varsa uyarır.
 */
export function ExamRunner({
  questions,
  passingScore,
  attemptNo,
  busy,
  onSubmit,
}: {
  questions: ExamQ[];
  passingScore: number;
  attemptNo: number;
  busy: boolean;
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [i, setI] = useState(0);
  const [confirming, setConfirming] = useState(false);

  const q = questions[i];
  const answeredCount = useMemo(
    () => questions.filter((x) => answers[x.id]).length,
    [questions, answers]
  );
  const unanswered = questions.length - answeredCount;
  const isLast = i === questions.length - 1;

  function pick(optionId: string) {
    setAnswers((a) => ({ ...a, [q.id]: optionId }));
  }

  function go(n: number) {
    setConfirming(false);
    setI(Math.max(0, Math.min(questions.length - 1, n)));
  }

  if (!q) return null;

  return (
    <div className="card p-5">
      {/* Başlık + ilerleme */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-[13px] font-bold text-slate-900">
            Exam · attempt {attemptNo}
          </div>
          <div className="text-[11px] text-slate-500">
            Passing score {passingScore}% · {questions.length} questions
          </div>
        </div>
        <div className="text-[11px] font-semibold text-slate-600 tabular-nums">
          {answeredCount} / {questions.length} answered
        </div>
      </div>

      {/* İlerleme çubuğu */}
      <div className="h-1 w-full rounded bg-slate-100 overflow-hidden mb-4">
        <div
          className="h-full bg-brand-600 transition-all"
          style={{ width: `${(answeredCount / questions.length) * 100}%` }}
        />
      </div>

      {/* Soru gezgini */}
      <div className="flex flex-wrap gap-1.5 mb-5" role="tablist" aria-label="Questions">
        {questions.map((x, n) => {
          const answered = !!answers[x.id];
          const current = n === i;
          return (
            <button
              key={x.id}
              role="tab"
              aria-selected={current}
              aria-label={`Question ${n + 1}${answered ? ", answered" : ", not answered"}`}
              onClick={() => go(n)}
              className={`h-7 w-7 rounded-md text-[11px] font-bold tabular-nums transition ${
                current
                  ? "bg-brand-600 text-white ring-2 ring-brand-200"
                  : answered
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300"
                  : "bg-white text-slate-400 ring-1 ring-slate-200 hover:ring-slate-300"
              }`}
            >
              {n + 1}
            </button>
          );
        })}
      </div>

      {/* Soru */}
      <div className="mb-5">
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
          Question {i + 1} of {questions.length}
        </div>
        <p className="text-[15px] font-semibold text-slate-900 mb-4">{q.text}</p>
        <div className="space-y-2">
          {q.options.map((o) => {
            const on = answers[q.id] === o.id;
            return (
              <label
                key={o.id}
                className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition ${
                  on
                    ? "border-brand-400 bg-brand-50/60 ring-1 ring-brand-200"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name={q.id}
                  checked={on}
                  onChange={() => pick(o.id)}
                  className="accent-brand-600 mt-0.5"
                />
                <span className="text-[13px] text-slate-800">{o.text}</span>
              </label>
            );
          })}
        </div>
        {answers[q.id] && (
          <button
            onClick={() => setAnswers((a) => {
              const n = { ...a };
              delete n[q.id];
              return n;
            })}
            className="mt-2 text-[11px] font-semibold text-slate-500 hover:text-brand-700"
          >
            Clear this answer
          </button>
        )}
      </div>

      {/* Gönderim onayı */}
      {confirming && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 mb-3">
          <p className="text-[13px] text-amber-900 font-semibold mb-1">
            {unanswered} question{unanswered === 1 ? "" : "s"} left unanswered.
          </p>
          <p className="text-[11px] text-amber-800 mb-2">
            Unanswered questions are scored as wrong. You can go back and finish them.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onSubmit(answers)}
              disabled={busy}
              className="btn-primary text-xs py-1.5"
            >
              Submit anyway
            </button>
            <button
              onClick={() => {
                const first = questions.findIndex((x) => !answers[x.id]);
                if (first >= 0) go(first);
              }}
              className="btn-secondary text-xs py-1.5"
            >
              Go to first unanswered
            </button>
          </div>
        </div>
      )}

      {/* Alt navigasyon */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-4">
        <button
          onClick={() => go(i - 1)}
          disabled={i === 0}
          className="btn-secondary text-xs py-2 disabled:opacity-40"
        >
          ← Previous
        </button>
        {isLast ? (
          <button
            onClick={() => (unanswered > 0 ? setConfirming(true) : onSubmit(answers))}
            disabled={busy}
            className="btn-primary text-xs py-2"
          >
            {busy ? "Submitting…" : "Submit Exam"}
          </button>
        ) : (
          <button onClick={() => go(i + 1)} className="btn-primary text-xs py-2">
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
