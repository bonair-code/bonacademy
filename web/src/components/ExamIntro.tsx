import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import { Flag } from "./Flag";
import { LANG_LABEL, type Lang } from "../lib/lang";
import { EXAM_TEXT } from "../lib/examText";

export type ExamInfo = {
  courseTitle: string;
  questionCount: number;
  timeLimitMin: number | null;
  passingScore: number;
  shuffle: boolean;
  attemptNo: number;
  maxAttempts: number;
  defaultLang: Lang;
  languages: { lang: Lang; questions: number; available: boolean }[];
  resume: { attemptNo: number; lang: Lang; remainingSec: number | null } | null;
};

const ICON = {
  q: "M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.9M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17h.01",
  t: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2M9.5 2.5h5",
  p: "M4 12.5l5 5L20 6.5",
  a: "M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7",
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-[22px] w-[22px]" aria-hidden>
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Sınava girmeden önceki bilgi ekranı (tasarım A — özet kartları). Bilgiler
 * sunucudan gelir (`examInfo`): öğrenci soruları okuyamadığı için soru ve dil
 * sayıları istemcide hesaplanamıyor. Sınav dili burada bayrakla seçilir;
 * eğitimin dilini (ve bölüm ilerlemesini) değiştirmez.
 */
export function ExamIntro({
  assignmentId,
  busy,
  onStart,
}: {
  assignmentId: string;
  busy: boolean;
  onStart: (lang: Lang) => void;
}) {
  const [info, setInfo] = useState<ExamInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("TR");
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    let alive = true;
    httpsCallable(functions, "examInfo")({ assignmentId })
      .then((r) => {
        if (!alive) return;
        const d = r.data as ExamInfo;
        setInfo(d);
        const usable = d.languages.filter((l) => l.available).map((l) => l.lang);
        setLang(d.resume?.lang ?? (usable.includes(d.defaultLang) ? d.defaultLang : usable[0] ?? d.defaultLang));
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [assignmentId]);

  if (err) return <div className="card p-5 text-sm text-red-700">{err}</div>;
  if (!info) return <div className="card p-6 text-sm text-slate-400">Loading exam details…</div>;

  const t = EXAM_TEXT[lang];
  const bank = info.languages.find((l) => l.lang === lang)?.questions ?? 0;
  const count = Math.min(info.questionCount, bank || info.questionCount);
  const pts = count ? Math.round((100 / count) * 10) / 10 : 0;
  const timed = info.timeLimitMin != null;
  const resume = info.resume;

  return (
    <div className="max-w-[720px] mx-auto">
      <div className="card" style={{ borderTop: "4px solid var(--brand)" }}>
        <div className="px-5 sm:px-7 pt-6 pb-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600">{t.eyebrow}</div>
          <h2 className="text-[22px] font-bold tracking-[-0.015em] text-slate-900 mt-1.5">{info.courseTitle}</h2>
          <p className="text-[14px] text-slate-500 mt-1.5">{t.intro}</p>
        </div>

        {/* Dört bilgi kutusu */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 px-5 sm:px-7">
          {[
            { d: ICON.q, v: String(count), l: t.questions },
            { d: ICON.t, v: timed ? t.minutes(info.timeLimitMin!) : t.noLimit, l: t.duration },
            { d: ICON.p, v: lang === "EN" ? `${info.passingScore}%` : `%${info.passingScore}`, l: t.passMark },
            { d: ICON.a, v: `${info.attemptNo}/${info.maxAttempts}`, l: t.attempt },
          ].map((s) => (
            <div key={s.l} className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-3.5 flex flex-col items-center gap-0.5">
              <span className="text-brand-600">
                <Icon d={s.d} />
              </span>
              <b className="text-[22px] tracking-[-0.02em] text-brand-900 tabular-nums">{s.v}</b>
              <small className="text-[12px] text-slate-500">{s.l}</small>
            </div>
          ))}
        </div>

        {/* Sınav dili — öğrencinin seçimi. Sorusu olmayan dil kapalı. */}
        <div className="px-5 sm:px-7 pt-5">
          <div className="text-[12px] font-semibold text-slate-600 mb-2">{t.language}</div>
          <div className="flex flex-wrap gap-2">
            {info.languages.map((l) => {
              const on = l.lang === lang;
              const locked = !!resume && resume.lang !== l.lang;
              const disabled = !l.available || locked;
              return (
                <button
                  key={l.lang}
                  type="button"
                  onClick={() => setLang(l.lang)}
                  disabled={disabled}
                  aria-pressed={on}
                  title={!l.available ? EXAM_TEXT[l.lang].noQuestions : undefined}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[13.5px] font-semibold transition ${
                    on
                      ? "border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-200"
                      : "border-slate-200 bg-white text-slate-700 hover:border-brand-300"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <Flag lang={l.lang} size={20} />
                  {LANG_LABEL[l.lang]}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-[13px] text-slate-600">
            {pts > 0 && <span>{t.perQuestion(String(pts))}</span>}
          </div>
        </div>

        {resume ? (
          <div className="mx-5 sm:mx-7 mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <div className="text-[14px] font-semibold text-amber-900">{t.resumeTitle}</div>
            <p className="text-[13px] text-amber-800 mt-1">
              {t.resumeBody(resume.remainingSec == null ? null : Math.ceil(resume.remainingSec / 60))}
            </p>
          </div>
        ) : (
          <>
            <div className="mx-5 sm:mx-7 mt-5 rounded-xl border border-slate-200 p-4">
              <div className="text-[13px] font-bold text-slate-900 mb-2">{t.rulesTitle}</div>
              <ol className="list-decimal pl-5 space-y-1.5 text-[13.5px] text-slate-700 leading-relaxed">
                {t.rules({ timed, maxAttempts: info.maxAttempts }).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ol>
            </div>
            <label className="flex items-center gap-2 mx-5 sm:mx-7 mt-4 text-[14px] text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              {t.agree}
            </label>
          </>
        )}

        <div className="flex items-center justify-between gap-3 px-5 sm:px-7 pt-5 pb-6">
          <Link to="/dashboard" className="btn-secondary">
            {t.back}
          </Link>
          <button
            onClick={() => onStart(lang)}
            disabled={busy || (!resume && !agreed) || !info.languages.some((l) => l.lang === lang && l.available)}
            className="btn-primary disabled:cursor-not-allowed"
          >
            {busy ? t.starting : resume ? t.resume : t.start}
          </button>
        </div>
      </div>
    </div>
  );
}
