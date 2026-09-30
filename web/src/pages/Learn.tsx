import { PageHead } from "../components/PageHead";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import { PdfReader } from "../components/PdfReader";
import { ScormPlayer } from "../components/ScormPlayer";
import { ExamRunner, type ExamQ } from "../components/ExamRunner";

// Aynı origin'den servis edilir (hosting rewrite / vite proxy) — SCORM paketi
// LMS API'sini window.parent üzerinde arıyor, çapraz origin'de erişemez.
const SCORM_SERVE_BASE = "/scorm-content";

type Content =
  | { id: string; type: "VIDEO"; url: string; fileName: string }
  | { id: string; type: "PDF"; url: string; fileName: string }
  | { id: string; type: "SCORM"; entryPoint: string; basePath: string; fileName: string };

type Section = { id: string; order: number; title: string; contents?: Content[]; content?: any };
type Assignment = {
  courseId: string;
  courseTitle: string;
  status: string;
  sectionsDone?: string[];
};

function contentsOf(s: Section): Content[] {
  if (s.contents?.length) return s.contents;
  if (s.content) return [{ ...(s.content as any), id: s.content.id ?? "legacy" }];
  return [];
}

export function Learn() {
  const { id } = useParams<{ id: string }>();
  const [a, setA] = useState<Assignment | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Sınav durumu
  const [exam, setExam] = useState<{ attemptNo: number; passingScore: number; questions: ExamQ[] } | null>(null);
  const [result, setResult] = useState<{ passed: boolean; score: number; status: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, "assignments", id), (d) => setA(d.data() as Assignment));
  }, [id]);

  useEffect(() => {
    if (!a?.courseId) return;
    return onSnapshot(
      query(collection(db, "courses", a.courseId, "sections"), orderBy("order")),
      (snap) => setSections(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
    );
  }, [a?.courseId]);

  /**
   * Kursun sınavı var mı — soldaki rayda sınav satırının en baştan görünmesi
   * için gerekli. Eskiden sınav ancak bütün bölümler bitince ayrı bir kutuda
   * beliriyordu; o ana kadar varlığından haberin olmuyordu.
   */
  const [examRequired, setExamRequired] = useState<boolean | null>(null);
  useEffect(() => {
    if (!a?.courseId) return;
    return onSnapshot(doc(db, "courses", a.courseId), (d) => {
      const x = d.data() as any;
      setExamRequired(x?.exam?.required !== false);
    });
  }, [a?.courseId]);

  const done = useMemo(() => new Set(a?.sectionsDone || []), [a?.sectionsDone]);
  const currentIndex = sections.findIndex((s) => !done.has(s.id));

  // Bu oturumda hangi içerikler gerçekten tüketildi (id -> true).
  const [consumed, setConsumed] = useState<Record<string, boolean>>({});
  const markConsumed = useCallback(
    (contentId: string) => setConsumed((p) => (p[contentId] ? p : { ...p, [contentId]: true })),
    []
  );

  /**
   * Raydan seçilen bölüm. Boşsa sıradaki bölüm gösterilir. Tamamlanmış ya da
   * ileri bölümler okunabilir — tamamlama sırası sunucuda korunuyor, okuma
   * sırası zorlamanın bir faydası yok ve geri dönüp bakmayı imkânsız kılıyordu.
   */
  const [selected, setSelected] = useState<string | null>(null);
  const selectedIndex = selected ? sections.findIndex((s) => s.id === selected) : -1;
  const viewIndex = selectedIndex >= 0 ? selectedIndex : currentIndex;
  const isViewingCurrent = viewIndex === currentIndex;
  const viewDone = viewIndex >= 0 ? done.has(sections[viewIndex].id) : false;

  const viewContents = viewIndex >= 0 ? contentsOf(sections[viewIndex]) : [];
  const currentContents = currentIndex >= 0 ? contentsOf(sections[currentIndex]) : [];
  const remaining = currentContents.filter((c) => !consumed[c.id]);
  const canComplete = currentContents.length > 0 && remaining.length === 0;

  async function completeCurrent() {
    if (!id || currentIndex < 0) return;
    setBusy(true);
    setErr(null);
    try {
      await httpsCallable(functions, "completeSection")({ assignmentId: id, sectionId: sections[currentIndex].id });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function beginExam() {
    if (!id) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await httpsCallable(functions, "startExam")({ assignmentId: id });
      setExam(res.data as any);
      setResult(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(answers: Record<string, string>) {
    if (!id || !exam) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await httpsCallable(functions, "submitExam")({
        assignmentId: id,
        attemptNo: exam.attemptNo,
        answers,
      });
      setResult(res.data as any);
      setExam(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!a) return <div className="text-sm text-slate-400 py-10">Loading…</div>;

  return (
    <div>
      <Link to="/dashboard" className="text-xs text-slate-500 hover:text-slate-800">
        ← Dashboard
      </Link>
      <PageHead
        title={a.courseTitle}
        subtitle={
          examRequired === false
            ? "Work through each section to complete this training."
            : "Complete each section, then take the exam."
        }
      />
      <div className="mb-4" />
      {err && <p className="text-xs text-brand-700 mb-3">{err}</p>}

      <div className="grid lg:grid-cols-[230px_1fr] gap-3 items-start">
        <ProgressRail
          sections={sections}
          done={done}
          currentIndex={currentIndex}
          viewIndex={viewIndex}
          examRequired={examRequired !== false}
          status={a.status}
          onSelect={(id) => setSelected(id)}
        />

        <div>

      {/* SINAV SONUCU */}
      {result && (
        <div
          className={`card p-6 mb-4 border-l-4 ${
            result.passed ? "border-l-emerald-500" : "border-l-red-500"
          }`}
        >
          <div className={`text-xl font-bold ${result.passed ? "text-emerald-700" : "text-red-700"}`}>
            {result.passed ? "Congratulations, you passed! 🎉" : "You did not pass the exam."}
          </div>
          <p className="text-sm text-slate-600 mt-1">Your score: {result.score}%</p>
          {result.passed ? (
            <Link to="/certificates" className="btn-primary mt-4 inline-flex">
              View My Certificate
            </Link>
          ) : result.status === "RETAKE_REQUIRED" ? (
            <p className="text-sm text-red-800 mt-3">
              You failed twice — you must retake the training from the beginning.
            </p>
          ) : (
            <button onClick={beginExam} disabled={busy} className="btn-primary mt-4">
              Try Again
            </button>
          )}
        </div>
      )}

      {/* TAMAMLANDI */}
      {!result && a.status === "COMPLETED" && (
        <div className="card p-6 border-l-4 border-l-emerald-500">
          <div className="text-xl font-bold text-emerald-700">You have completed this training ✓</div>
          <Link to="/certificates" className="btn-primary mt-4 inline-flex">
            View My Certificate
          </Link>
        </div>
      )}

      {/* SINAV */}
      {!result && exam && (
        <ExamRunner
          questions={exam.questions}
          passingScore={exam.passingScore}
          attemptNo={exam.attemptNo}
          busy={busy}
          onSubmit={submit}
        />
      )}

      {/* SINAVA HAZIR */}
      {!result && !exam && (a.status === "SECTIONS_DONE" || a.status === "EXAM_FAILED") && (
        <div className="card p-6 text-center">
          <div className="text-[15px] font-semibold text-slate-900 mb-1">
            All sections completed 🎯
          </div>
          <p className="text-sm text-slate-500 mb-4">You can now take the exam.</p>
          <button onClick={beginExam} disabled={busy} className="btn-primary">
            {busy ? "Preparing…" : "Start Exam"}
          </button>
        </div>
      )}

      {/* BÖLÜMLER */}
      {!result && !exam && a.status !== "COMPLETED" && a.status !== "SECTIONS_DONE" &&
        a.status !== "EXAM_FAILED" && (
          <div>
            {viewIndex >= 0 && sections[viewIndex] && (
              <div className="card p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="text-[13px] font-bold text-slate-900">
                    Section {viewIndex + 1}: {sections[viewIndex].title}
                  </div>
                  {viewDone && (
                    <span className="text-[9.5px] font-bold uppercase tracking-[0.04em] px-2 py-1 rounded bg-emerald-50 text-emerald-700 shrink-0">
                      Completed
                    </span>
                  )}
                </div>
                <div className="space-y-4">
                  {viewContents.map((c) => (
                    <ContentViewer
                      key={c.id}
                      item={c}
                      done={!!consumed[c.id]}
                      onDone={() => markConsumed(c.id)}
                      assignmentId={id}
                    />
                  ))}
                  {viewContents.length === 0 && (
                    <p className="text-sm text-slate-400">No content in this section.</p>
                  )}
                </div>

                {/* Tamamlama düğmesi yalnızca sıradaki bölümde. Sunucu da
                    sırayı zorunlu tutuyor; başka bölümde düğme göstermek
                    tıklandığında hata verirdi. */}
                {isViewingCurrent ? (
                  <>
                    {!canComplete && viewContents.length > 0 && (
                      <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
                        <p className="text-[13px] font-semibold text-amber-900">
                          Go through the material before you finish this section.
                        </p>
                        <p className="text-[11px] text-amber-800 mt-0.5">
                          {remaining.length} of {viewContents.length} item(s) still open — read
                          every page of a document, watch the video to the end, or finish the SCORM
                          package.
                        </p>
                      </div>
                    )}
                    <button
                      onClick={completeCurrent}
                      disabled={busy || !canComplete}
                      title={canComplete ? undefined : "Finish the material above first"}
                      className="btn-primary mt-4 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {busy ? "Saving…" : "I completed this section →"}
                    </button>
                  </>
                ) : viewDone ? (
                  <button
                    onClick={() => setSelected(null)}
                    className="btn-secondary text-xs py-2 mt-4"
                  >
                    Back to section {currentIndex + 1} →
                  </button>
                ) : (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-[12px] text-slate-600">
                      You can read ahead, but sections must be completed in order — finish section{" "}
                      {currentIndex + 1} first.
                    </p>
                    <button
                      onClick={() => setSelected(null)}
                      className="btn-secondary text-xs py-1.5 px-3 shrink-0"
                    >
                      Go to section {currentIndex + 1}
                    </button>
                  </div>
                )}
              </div>
            )}
            {currentIndex < 0 && sections.length > 0 && (
              <p className="text-sm text-slate-400">All sections finished, updating status…</p>
            )}
            {sections.length === 0 && (
              <p className="text-sm text-slate-400">This course has no sections yet.</p>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

/**
 * Soldaki ilerleme rayı. Eğitim tek oturuşta bitmiyor; ertesi gün girildiğinde
 * "nerede kalmıştım, ne kaldı" sorusunun cevabı ekranda olmalı. Sınav da
 * rayın son satırı — akışın parçası olduğu baştan görünüyor.
 *
 * Satırlar tıklanabilir: tamamlanmış bir bölüme geri dönüp bakmak ya da
 * ileriyi okumak serbest. Tamamlama sırası sunucuda korunuyor — okuma sırasını
 * da zorlamanın faydası yoktu, geri dönüp bakmayı imkânsız kılıyordu.
 */
function ProgressRail({
  sections,
  done,
  currentIndex,
  viewIndex,
  examRequired,
  status,
  onSelect,
}: {
  sections: Section[];
  done: Set<string>;
  currentIndex: number;
  /** Ekranda gösterilen bölüm — seçili satır bu. */
  viewIndex: number;
  examRequired: boolean;
  status: string;
  onSelect: (sectionId: string | null) => void;
}) {
  /** Telefonda bölüm listesi kapalı başlar; masaüstünde bu durum kullanılmıyor. */
  const [open, setOpen] = useState(false);
  const passed = status === "COMPLETED" || status === "EXAM_PASSED";
  const examOpen = status === "SECTIONS_DONE" || status === "EXAM_FAILED";
  const total = sections.length + (examRequired ? 1 : 0);
  const doneCount = done.size + (passed && examRequired ? 1 : 0);
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const bubble = (kind: "done" | "current" | "locked", label: string) => (
    <span
      className={`h-[18px] w-[18px] rounded-full grid place-items-center text-[9.5px] font-extrabold shrink-0 ${
        kind === "done"
          ? "bg-emerald-100 text-emerald-700"
          : kind === "current"
          ? "bg-brand-600 text-white"
          : "bg-slate-100 text-slate-400"
      }`}
      aria-hidden="true"
    >
      {label}
    </span>
  );

  return (
    <div className="card p-1.5 lg:sticky lg:top-[72px]">
      <div className="px-2.5 pt-2 pb-1">
        <div className="flex justify-between text-[11px] text-slate-500">
          <span>Progress</span>
          <span className={`font-semibold ${pct === 100 ? "text-emerald-700" : "text-slate-700"}`}>
            {doneCount}/{total}
          </span>
        </div>
        <div className="h-[5px] rounded-full bg-slate-100 overflow-hidden mt-1.5">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${pct}%`, background: pct === 100 ? "#30b15a" : "#e31e24" }}
          />
        </div>
      </div>

      {/* Telefonda raf içeriğin ÜSTÜNE yığılıyor: bütün bölüm listesini
          geçmeden eğitime ulaşılamıyordu. Kapalı başlar, ilerleme çubuğu
          yukarıda görünmeye devam eder. Masaüstünde her zaman açık. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="lg:hidden w-full flex items-center justify-between px-2.5 py-2 mt-1 rounded-lg text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
      >
        <span>
          Sections
          <span className="ml-1.5 font-normal text-slate-400">
            {Math.min(viewIndex + 1, total)}/{total}
          </span>
        </span>
        <span className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>

      <div className={open ? "" : "hidden lg:block"}>
      <div className="hidden lg:block text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400 px-2.5 pt-2.5 pb-1">
        Sections
      </div>
      {sections.map((s, i) => {
        const isDone = done.has(s.id);
        const isCurrent = i === currentIndex;
        const isViewed = i === viewIndex;
        return (
          <button
            key={s.id}
            onClick={() => {
              onSelect(isCurrent ? null : s.id);
              setOpen(false);
            }}
            title={s.title}
            className={`w-full text-left flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[12.5px] transition ${
              isViewed
                ? "bg-slate-100 text-slate-900 font-semibold"
                : isDone
                ? "text-slate-600 hover:bg-slate-50"
                : "text-slate-400 hover:bg-slate-50"
            }`}
          >
            {bubble(
              isDone ? "done" : isCurrent ? "current" : "locked",
              isDone ? "✓" : isCurrent ? String(i + 1) : String(i + 1)
            )}
            <span className="min-w-0 truncate">{s.title}</span>
          </button>
        );
      })}

      {examRequired && (
        <>
          <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400 px-2.5 pt-2.5 pb-1">
            Assessment
          </div>
          <div
            className={`flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[12.5px] ${
              passed
                ? "text-slate-600"
                : examOpen
                ? "bg-slate-100 text-slate-900 font-semibold"
                : "text-slate-400"
            }`}
          >
            {bubble(passed ? "done" : examOpen ? "current" : "locked", passed ? "✓" : examOpen ? "!" : "🔒")}
            <span className="min-w-0 truncate">Exam</span>
          </div>
        </>
      )}
      </div>
    </div>
  );
}

function ContentViewer({
  item,
  done,
  onDone,
  assignmentId,
}: {
  item: Content;
  done: boolean;
  onDone: () => void;
  /** SCORM ilerlemesi buna göre saklanır. */
  assignmentId?: string;
}) {
  return (
    <div className={`rounded-lg border p-3 ${done ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200"}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
          {item.type}
        </span>
        <span
          className={`text-[11px] font-semibold ${done ? "text-emerald-700" : "text-slate-400"}`}
        >
          {done ? "✓ Completed" : "In progress"}
        </span>
      </div>
      {item.type === "VIDEO" && <VideoContent item={item} onDone={onDone} />}
      {item.type === "PDF" && (
        <PdfReader
          url={item.url}
          fileName={item.fileName}
          onProgress={(seen, total) => {
            if (total > 0 && seen >= total) onDone();
          }}
        />
      )}
      {item.type === "SCORM" && (
        <ScormPlayer
          src={`${SCORM_SERVE_BASE}/${item.basePath}${item.entryPoint}`}
          fileName={item.fileName}
          onDone={onDone}
          assignmentId={assignmentId}
          contentId={item.id}
        />
      )}
    </div>
  );
}

/** Video sonuna gelindiğinde tamamlanmış sayılır; ileri sarma engellenir. */
function VideoContent({
  item,
  onDone,
}: {
  item: Extract<Content, { type: "VIDEO" }>;
  onDone: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const furthest = useRef(0);
  const [pct, setPct] = useState(0);

  return (
    <div>
      <video
        ref={ref}
        controls
        src={item.url}
        className="w-full rounded bg-black"
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          // İzlenen en ileri nokta; geri sarıp tekrar izlemek serbest.
          if (v.currentTime > furthest.current) furthest.current = v.currentTime;
          if (v.duration) setPct(Math.round((furthest.current / v.duration) * 100));
        }}
        onSeeking={(e) => {
          const v = e.currentTarget;
          // İzlenmemiş kısma atlamayı geri al.
          if (v.currentTime > furthest.current + 1.5) v.currentTime = furthest.current;
        }}
        onEnded={onDone}
      />
      <div className="flex items-center justify-between mt-1">
        <span className="text-[11px] text-slate-500 truncate">{item.fileName}</span>
        <span className="text-[11px] font-semibold text-slate-600 tabular-nums">
          {pct}% watched
        </span>
      </div>
    </div>
  );
}
