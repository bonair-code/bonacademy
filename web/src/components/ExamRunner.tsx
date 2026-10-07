import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../lib/lang";
import { EXAM_TEXT } from "../lib/examText";

export type ExamQ = { id: string; text: string; options: { id: string; text: string }[] };

/** Kalan saniyeyi "mm:ss" (bir saati aşarsa "s:mm:ss") yazar. */
function clock(sec: number) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

/**
 * Tek soru ekranlı sınav. Üstte soru gezgini (işaretli / boş / şu anki) ve
 * süreli sınavda geri sayım, altta ileri-geri. Gönderirken boş soru varsa
 * uyarır.
 *
 * Süre: bitiş anı SUNUCUDAN gelir (`deadlineMs`), istemci saatiyle arasındaki
 * fark `clockOffsetMs` ile düzeltilir. Süre dolunca cevaplar bir kez,
 * otomatik gönderilir. Cevaplar tarayıcıda deneme başına saklanır: sayfa
 * yenilenirse ya da kapanıp açılırsa verilen cevaplar kaybolmaz (sunucu da
 * aynı soruları ve aynı bitiş anını geri veriyor).
 */
export function ExamRunner({
  questions,
  passingScore,
  attemptNo,
  busy,
  lang,
  deadlineMs,
  clockOffsetMs,
  storageKey,
  onSubmit,
}: {
  questions: ExamQ[];
  passingScore: number;
  attemptNo: number;
  busy: boolean;
  lang: Lang;
  deadlineMs: number | null;
  clockOffsetMs: number;
  storageKey: string;
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const t = EXAM_TEXT[lang];
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(answers));
    } catch {
      /* depolama kapalı — sınav yine çalışır, yalnızca yenilemede cevaplar kaybolur */
    }
  }, [storageKey, answers]);

  const [i, setI] = useState(0);
  const [confirming, setConfirming] = useState(false);

  // Geri sayım
  const remaining = () =>
    deadlineMs == null ? null : Math.ceil((deadlineMs - (Date.now() + clockOffsetMs)) / 1000);
  const [left, setLeft] = useState<number | null>(remaining);
  useEffect(() => {
    if (deadlineMs == null) return;
    const tick = () => setLeft(remaining());
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineMs, clockOffsetMs]);

  // Süre dolunca BİR KEZ otomatik gönder.
  const autoSent = useRef(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const timeUp = left != null && left <= 0;
  useEffect(() => {
    if (!timeUp || autoSent.current) return;
    autoSent.current = true;
    onSubmit(answersRef.current);
  }, [timeUp, onSubmit]);

  const q = questions[i];
  const answeredCount = useMemo(
    () => questions.filter((x) => answers[x.id]).length,
    [questions, answers]
  );
  const unanswered = questions.length - answeredCount;
  const isLast = i === questions.length - 1;
  const locked = timeUp || busy;

  function pick(optionId: string) {
    if (locked) return;
    setAnswers((a) => ({ ...a, [q.id]: optionId }));
  }

  function go(n: number) {
    setConfirming(false);
    setI(Math.max(0, Math.min(questions.length - 1, n)));
  }

  if (!q) return null;

  const warn = left != null && left <= 300;
  const critical = left != null && left <= 60;

  return (
    <div className="card p-5">
      {/* Başlık + ilerleme + süre */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-[13px] font-bold text-slate-900">{t.examLabel(attemptNo)}</div>
          <div className="text-[11px] text-slate-500">
            {t.passMark} {lang === "EN" ? `${passingScore}%` : `%${passingScore}`} · {questions.length}{" "}
            {t.questions.toLowerCase()}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="text-[12px] font-semibold text-slate-600 tabular-nums">
            {t.answered(answeredCount, questions.length)}
          </div>
          {left != null && (
            <div
              className={`rounded-lg px-3 py-1.5 text-right border ${
                critical
                  ? "bg-red-50 border-red-300 text-red-700"
                  : warn
                  ? "bg-amber-50 border-amber-300 text-amber-800"
                  : "bg-brand-50 border-brand-100 text-brand-900"
              }`}
              role="timer"
              aria-live={critical ? "assertive" : "off"}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide opacity-75">
                {critical && !timeUp ? t.lastMinute : t.timeLeft}
              </div>
              <div className="text-[18px] font-bold tabular-nums leading-tight">{clock(left)}</div>
            </div>
          )}
          {/* Bitir düğmesi üstte, soru gezinmesinden ayrı: altta "Sonraki"nin
              yanında dururken yanlışlıkla basılıyordu. */}
          <button
            onClick={() => (unanswered > 0 ? setConfirming(true) : onSubmit(answers))}
            disabled={locked}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-600 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-brand-700 hover:bg-brand-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? t.submitting : t.submit}
          </button>
        </div>
      </div>

      {timeUp && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 mb-3 text-[13px] font-semibold text-red-800">
          {t.timeUp}
        </div>
      )}

      {/* Gönderim onayı */}
      {confirming && !timeUp && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 mb-3">
          <p className="text-[13px] text-amber-900 font-semibold mb-1">{t.unanswered(unanswered)}</p>
          <p className="text-[11px] text-amber-800 mb-2">{t.unansweredHint}</p>
          <div className="flex gap-2">
            <button
              onClick={() => onSubmit(answers)}
              disabled={busy}
              className="btn-primary text-xs py-1.5"
            >
              {t.submitAnyway}
            </button>
            <button
              onClick={() => {
                const first = questions.findIndex((x) => !answers[x.id]);
                if (first >= 0) go(first);
              }}
              className="btn-secondary text-xs py-1.5"
            >
              {t.firstUnanswered}
            </button>
          </div>
        </div>
      )}

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
              aria-label={`${t.questionOf(n + 1, questions.length)}${answered ? " ✓" : ""}`}
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
          {t.questionOf(i + 1, questions.length)}
        </div>
        <p className="text-[15px] font-semibold text-slate-900 mb-4">{q.text}</p>
        <div className="space-y-2">
          {q.options.map((o) => {
            const on = answers[q.id] === o.id;
            return (
              <label
                key={o.id}
                className={`flex items-start gap-3 rounded-lg border p-3 transition ${
                  locked ? "cursor-not-allowed opacity-70" : "cursor-pointer"
                } ${
                  on
                    ? "border-brand-400 bg-brand-50/60 ring-1 ring-brand-200"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name={q.id}
                  checked={on}
                  disabled={locked}
                  onChange={() => pick(o.id)}
                  className="accent-brand-600 mt-0.5"
                />
                <span className="text-[13px] text-slate-800">{o.text}</span>
              </label>
            );
          })}
        </div>
        {answers[q.id] && !locked && (
          <button
            onClick={() => setAnswers((a) => {
              const n = { ...a };
              delete n[q.id];
              return n;
            })}
            className="mt-2 text-[11px] font-semibold text-slate-500 hover:text-brand-700"
          >
            {t.clear}
          </button>
        )}
      </div>

      {/* Alt navigasyon: yalnızca sorular arasında gezinme. */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
        <button
          onClick={() => go(i - 1)}
          disabled={i === 0}
          className="btn-secondary text-xs py-2 disabled:opacity-40"
        >
          {t.prev}
        </button>
        {!isLast && (
          <button onClick={() => go(i + 1)} className="btn-primary text-xs py-2">
            {t.next}
          </button>
        )}
      </div>
    </div>
  );
}
