import { PageHead } from "../components/PageHead";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import JSZip from "jszip";
import { httpsCallable } from "firebase/functions";
import { db, functions, storage } from "../lib/firebase";
import { coverTone } from "../lib/coverTone";
import { downloadTemplate, parseWorkbook, type ParseResult } from "../lib/questionExcel";

type RecurUnit = "NONE" | "DAY" | "MONTH" | "YEAR";

/**
 * Teslim şekli. Bazı eğitimler sistemden verilmiyor — personel dışarıdan almak
 * zorunda (örn. yetkili kuruluş eğitimi). Bunlar kurs olarak tanımlanır ki
 * Training Follow-Up'ta takip edilebilsin, ama içerik/sınav adımları anlamsız
 * olduğu için gizlenir ve eğitim atamada listelenmezler.
 */
type Delivery = "ONLINE" | "EXTERNAL_ONLY";

type ExamCfg = {
  /** Kursun sınavı var mı — yoksa 3. ve 4. adım devre dışı kalır. */
  required: boolean;
  questionCount: number;
  passingScore: number;
  timeLimitMin: number | null;
  shuffle: boolean;
};

type Course = {
  title: string;
  category: string | null;
  /** Öğrenci kartındaki kapak görseli. Yoksa başlıktan renk türetilir. */
  coverUrl: string | null;
  coverPath: string | null;
  durationHours: number | null;
  delivery: Delivery;
  /** Revizyon elle girilir — havacılık dokümanlarında numarayı kurum belirler. */
  revisionNo: string;
  revisionDate: string | null; // YYYY-MM-DD
  recurrenceEvery: number | null;
  recurrenceUnit: RecurUnit;
  passingScore: number;
  isActive: boolean;
  scorm: { packagePath: string; entryPoint: string; version: string } | null;
  exam: ExamCfg;
};

type Option = { id: string; text: string; isCorrect: boolean };
type Question = { id: string; text: string; points: number; options: Option[] };

const UNIT_LABEL: Record<RecurUnit, string> = {
  NONE: "No recurrence",
  DAY: "Day(s)",
  MONTH: "Month(s)",
  YEAR: "Year(s)",
};

/** Eski kayıtlar recurrence'ı tek bir enum olarak tutuyordu. */
const LEGACY_RECUR: Record<string, { every: number; unit: RecurUnit }> = {
  SIX_MONTHS: { every: 6, unit: "MONTH" },
  ONE_YEAR: { every: 1, unit: "YEAR" },
  TWO_YEARS: { every: 2, unit: "YEAR" },
};

/** Yeni alanları okur; yoksa eski tek-enum kaydından türetir. */
function readRecurrence(data: Record<string, unknown>): {
  recurrenceEvery: number | null;
  recurrenceUnit: RecurUnit;
} {
  const unit = data.recurrenceUnit as RecurUnit | undefined;
  if (unit) {
    return {
      recurrenceUnit: unit,
      recurrenceEvery: (data.recurrenceEvery as number | null) ?? null,
    };
  }
  const legacy = LEGACY_RECUR[String(data.recurrence ?? "NONE")];
  return legacy
    ? { recurrenceEvery: legacy.every, recurrenceUnit: legacy.unit }
    : { recurrenceEvery: null, recurrenceUnit: "NONE" };
}

/**
 * Soru puanı elle girilmez: sınav 100 tam puan üzerinden, her soru eşit ağırlıkta.
 * 10 soruluk sınavda her soru 10 puan.
 */
function pointsPerQuestion(questionCount: number) {
  if (!questionCount || questionCount < 1) return 0;
  return Math.round((100 / questionCount) * 100) / 100;
}

function recurText(every: number | null, unit: RecurUnit) {
  if (unit === "NONE" || !every) return "No recurrence";
  const noun = unit === "DAY" ? "day" : unit === "MONTH" ? "month" : "year";
  return `Every ${every} ${noun}${every === 1 ? "" : "s"}`;
}

export function CourseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [c, setC] = useState<Course | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [sectionCount, setSectionCount] = useState(0);
  const [step, setStep] = useState(1);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    const unC = onSnapshot(doc(db, "courses", id), (d) => {
      if (!d.exists()) return;
      const data = d.data() as Partial<Course>;
      setC({
        title: data.title ?? "",
        category: data.category ?? null,
        coverUrl: data.coverUrl ?? null,
        coverPath: data.coverPath ?? null,
        durationHours: data.durationHours ?? null,
        delivery: data.delivery ?? "ONLINE",
        revisionNo: data.revisionNo ?? "",
        revisionDate: data.revisionDate ?? null,
        ...readRecurrence(data),
        passingScore: data.passingScore ?? 70,
        isActive: data.isActive ?? true,
        scorm: data.scorm ?? null,
        exam: {
          questionCount: 10,
          passingScore: data.passingScore ?? 70,
          timeLimitMin: null,
          shuffle: true,
          ...(data.exam ?? {}),
          // Eski kayıtlarda alan yok; o kurslarda sınav vardı sayılır.
          required: data.exam?.required ?? true,
        },
      });
    });
    const unQ = onSnapshot(collection(db, "courses", id, "questions"), (snap) =>
      setQuestions(snap.docs.map((q) => ({ id: q.id, ...(q.data() as Omit<Question, "id">) })))
    );
    const unS = onSnapshot(collection(db, "courses", id, "sections"), (snap) =>
      setSectionCount(snap.size)
    );
    return () => {
      unC();
      unQ();
      unS();
    };
  }, [id]);

  function set<K extends keyof Course>(k: K, v: Course[K]) {
    setC((prev) => (prev ? { ...prev, [k]: v } : prev));
  }
  function setExam<K extends keyof ExamCfg>(k: K, v: ExamCfg[K]) {
    setC((prev) => (prev ? { ...prev, exam: { ...prev.exam, [k]: v } } : prev));
  }

  /**
   * Kapak görseli. Kaydet'i beklemeden doğrudan yazılır — dosya zaten Storage'a
   * çıktı, dokümanı güncellemezsek yüklenen ama hiçbir yere bağlı olmayan bir
   * dosya kalırdı.
   */
  async function uploadCover(file: File) {
    if (!id) return;
    setErr(null);
    setCoverBusy(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `covers/${id}/${Date.now()}-${safe}`;
      const snap = await uploadBytes(ref(storage, path), file);
      const url = await getDownloadURL(snap.ref);
      await updateDoc(doc(db, "courses", id), {
        coverUrl: url,
        coverPath: path,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCoverBusy(false);
      if (coverRef.current) coverRef.current.value = "";
    }
  }

  async function removeCover() {
    if (!id) return;
    setCoverBusy(true);
    try {
      // Dosyanın kendisi Storage'da kalır: aynı görsel başka bir revizyonda
      // kullanılmış olabilir ve silme geri alınamaz.
      await updateDoc(doc(db, "courses", id), {
        coverUrl: null,
        coverPath: null,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCoverBusy(false);
    }
  }

  async function save(): Promise<boolean> {
    if (!id || !c) return false;
    setErr(null);
    try {
      await updateDoc(doc(db, "courses", id), {
        title: c.title.trim(),
        category: c.category?.trim() || null,
        durationHours: c.durationHours ?? null,
        delivery: c.delivery,
        revisionNo: c.revisionNo.trim(),
        revisionDate: c.revisionDate || null,
        recurrenceEvery: c.recurrenceUnit === "NONE" ? null : c.recurrenceEvery ?? 1,
        recurrenceUnit: c.recurrenceUnit,
        passingScore: c.passingScore,
        isActive: c.isActive,
        exam: c.exam,
        updatedAt: serverTimestamp(),
      });
      // Soru sayısı değişmiş olabilir; bankadaki puanları yeni değere çek.
      const per = c.exam.required ? pointsPerQuestion(c.exam.questionCount) : 0;
      const stale = questions.filter((q) => q.points !== per);
      if (stale.length > 0) {
        for (let i = 0; i < stale.length; i += 400) {
          const batch = writeBatch(db);
          for (const q of stale.slice(i, i + 400)) {
            batch.update(doc(db, "courses", id, "questions", q.id), { points: per });
          }
          await batch.commit();
        }
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    }
  }

  if (!c) return <div className="text-sm text-slate-400 py-10">Loading…</div>;

  // Görünen adımlar. Dışarıdan alınan eğitimde içerik ve sınav yok; sınavsız
  // kursta Question Bank yok. Gezinme bu listeye göre ilerler.
  const externalOnly = c.delivery === "EXTERNAL_ONLY";
  const stepNos = externalOnly
    ? [1, 5]
    : c.exam.required
    ? [1, 2, 3, 4, 5]
    : [1, 2, 3, 5];
  const atIdx = Math.max(0, stepNos.indexOf(step));
  const show = (n: number) => step === n && stepNos.includes(n);
  const goStep = (delta: number) =>
    setStep(stepNos[Math.min(stepNos.length - 1, Math.max(0, atIdx + delta))]);

  /**
   * Adımların hazırlık durumu. Sol ray hem gezinme hem kontrol listesi:
   * "bu kurs yayına hazır mı" sorusu sayfa açılır açılmaz cevaplanmalı.
   * `null` = bu kursta geçerli değil (dış eğitimde içerik/sınav yok).
   */
  const readiness: Record<number, boolean | null> = {
    // Revizyon numarası denetimde zorunlu; başlık zaten hep dolu.
    1: !!c.revisionNo.trim(),
    2: externalOnly ? null : sectionCount > 0,
    3: externalOnly ? null : true,
    4: externalOnly || !c.exam.required ? null : questions.length >= c.exam.questionCount,
    5: c.isActive,
  };
  const applicable = stepNos.filter((n) => readiness[n] !== null);
  const doneCount = applicable.filter((n) => readiness[n]).length;

  const railLabel: Record<number, string> = {
    1: "General information",
    2: externalOnly ? "Content" : `Content · ${sectionCount} section${sectionCount === 1 ? "" : "s"}`,
    3: c.exam.required ? `Exam · pass ${c.passingScore}%` : "Exam · not required",
    4: `Question bank · ${questions.length}`,
    5: c.isActive ? "Published" : "Summary & publish",
  };

  return (
    <div>
      <Link to="/courses" className="text-xs text-slate-500 hover:text-slate-800">
        ← Courses
      </Link>
      <PageHead title={c.title} subtitle="Course content, sections and exam questions." />
      <div className="mb-4" />

      {/* Kurs künyesi. Başlık üst barda zaten sabit duruyor, burada tekrar
          edilmiyor; burada olması gereken kapak, künye ve kaydetme. */}
      <div className="card px-4 py-3 mb-3 flex items-center gap-3.5 flex-wrap">
        <div
          className="w-[62px] h-[36px] rounded-lg shrink-0"
          style={
            c.coverUrl
              ? {
                  backgroundImage: `url(${c.coverUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : { background: `linear-gradient(140deg, ${coverTone(c.title).from}, ${coverTone(c.title).to})` }
          }
        />
        <div className="text-[11.5px] text-slate-500 min-w-0 flex-1">
          {[
            c.category || null,
            c.revisionNo ? `Rev ${c.revisionNo}` : null,
            c.durationHours != null ? `${c.durationHours} hours` : null,
            recurText(c.recurrenceEvery, c.recurrenceUnit),
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        <span
          className={`text-[9.5px] font-bold uppercase tracking-[0.04em] px-2 py-1 rounded shrink-0 ${
            !c.isActive
              ? "bg-slate-100 text-slate-600"
              : !externalOnly && sectionCount === 0
              ? "bg-amber-50 text-amber-800"
              : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {!c.isActive ? "Draft" : !externalOnly && sectionCount === 0 ? "Empty" : "Published"}
        </span>
        {saved && <span className="text-[11px] font-semibold text-emerald-600">✓ Saved</span>}
        <button onClick={() => void save()} className="btn-secondary text-xs py-1.5 px-3 shrink-0">
          Save
        </button>
      </div>

      <div className="grid lg:grid-cols-[214px_1fr] gap-3 items-start">
        <StepRail
          steps={stepNos}
          step={step}
          onStep={setStep}
          readiness={readiness}
          label={railLabel}
          doneCount={doneCount}
          total={applicable.length}
        />

        <div>
      {show(1) && (
      <Section title="General Information">
        {/* Kapak — öğrencinin kart ızgarasında gördüğü görsel. Önizleme
            kartın gerçek oranıyla (16:9'a yakın) basılır ki sürpriz olmasın. */}
        <div className="mb-5 flex flex-wrap items-start gap-4">
          <div
            className="relative w-[228px] h-[116px] rounded-xl overflow-hidden shrink-0 flex items-end border border-slate-200"
            style={
              c.coverUrl
                ? {
                    backgroundImage: `url(${c.coverUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : { background: `linear-gradient(140deg, ${coverTone(c.title).from}, ${coverTone(c.title).to})` }
            }
          >
            <div className="w-full px-3 pb-2.5">
              {c.category && (
                <span className="block text-[9px] font-semibold uppercase tracking-[0.08em] text-white/70">
                  {c.category}
                </span>
              )}
              <div className="text-[12.5px] font-semibold text-white leading-snug line-clamp-2">
                {c.title || "Untitled course"}
              </div>
            </div>
          </div>

          <div className="min-w-[220px]">
            <div className="text-[12px] font-semibold text-slate-800">Cover image</div>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed max-w-[42ch]">
              Shown on the learner's training card. Landscape works best (about 2:1). Leave it
              empty and the card uses a colour derived from the course title.
            </p>
            <div className="flex items-center gap-2 mt-2.5">
              <input
                ref={coverRef}
                type="file"
                accept="image/*"
                disabled={coverBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadCover(f);
                }}
                className="block text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold hover:file:bg-slate-200"
              />
              {c.coverUrl && !coverBusy && (
                <button
                  type="button"
                  onClick={() => void removeCover()}
                  className="text-[11px] font-semibold text-slate-500 hover:text-brand-700"
                >
                  Remove
                </button>
              )}
              {coverBusy && <span className="text-[11px] text-slate-400">Uploading…</span>}
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Course Title">
            <input className="input" value={c.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Category">
            <input
              className="input"
              value={c.category ?? ""}
              onChange={(e) => set("category", e.target.value)}
              placeholder="e.g. Safety / Quality"
            />
          </Field>
          <Field label="Revision No">
            <input
              className="input"
              value={c.revisionNo}
              onChange={(e) => set("revisionNo", e.target.value)}
              placeholder="e.g. 00, 01, Rev.02"
            />
          </Field>
          <Field label="Revision Date">
            <input
              className="input"
              type="date"
              value={c.revisionDate ?? ""}
              onChange={(e) => set("revisionDate", e.target.value || null)}
            />
          </Field>
          <Field label="Duration (hours)">
            <input
              className="input"
              type="number"
              min={0}
              step={0.5}
              value={c.durationHours ?? ""}
              onChange={(e) =>
                set("durationHours", e.target.value ? Number(e.target.value) : null)
              }
              placeholder="e.g. 1.5"
            />
          </Field>
          <Field label="Validity Period (recurrence)">
            <div className="flex gap-2">
              <input
                className="input w-24"
                type="number"
                min={1}
                step={1}
                value={c.recurrenceUnit === "NONE" ? "" : c.recurrenceEvery ?? 1}
                disabled={c.recurrenceUnit === "NONE"}
                onChange={(e) =>
                  set("recurrenceEvery", e.target.value ? Number(e.target.value) : null)
                }
                aria-label="Repeat every"
              />
              <select
                className="input flex-1"
                value={c.recurrenceUnit}
                onChange={(e) => {
                  const unit = e.target.value as RecurUnit;
                  set("recurrenceUnit", unit);
                  if (unit !== "NONE" && !c.recurrenceEvery) set("recurrenceEvery", 1);
                }}
                aria-label="Repeat unit"
              >
                {(Object.keys(UNIT_LABEL) as RecurUnit[]).map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABEL[u]}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              {recurText(c.recurrenceEvery, c.recurrenceUnit)} — how often staff must retake this
              training.
            </p>
          </Field>
        </div>
      </Section>

      )}
      {show(2) && (
      <Section title="Training Content — Sections">
        <Sections courseId={id!} />
      </Section>
      )}
      {show(3) && (
      <Section title="Exam Settings">
        <Field label="Does this course have an exam?">
          <select
            className="input md:w-72"
            value={c.exam.required ? "1" : "0"}
            onChange={(e) => setExam("required", e.target.value === "1")}
          >
            <option value="1">Yes — staff must pass an exam</option>
            <option value="0">No — completing the content is enough</option>
          </select>
        </Field>

        {!c.exam.required ? (
          <p className="text-[12px] text-slate-500 mt-3">
            No exam for this course. Staff complete it as soon as they finish every section, and
            the certificate is issued right away. The Question Bank step is skipped.
          </p>
        ) : (
        <div className="grid md:grid-cols-4 gap-4 mt-4">
          <Field label="Passing Score (%)">
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              value={c.passingScore}
              onChange={(e) => {
                set("passingScore", Number(e.target.value));
                setExam("passingScore", Number(e.target.value));
              }}
            />
          </Field>
          <Field label="Number of Questions">
            <input
              className="input"
              type="number"
              min={1}
              value={c.exam.questionCount}
              onChange={(e) => setExam("questionCount", Number(e.target.value))}
            />
          </Field>
          <Field label="Time Limit (min)">
            <input
              className="input"
              type="number"
              value={c.exam.timeLimitMin ?? ""}
              onChange={(e) =>
                setExam("timeLimitMin", e.target.value ? Number(e.target.value) : null)
              }
              placeholder="Unlimited"
            />
          </Field>
          <Field label="Shuffle Questions">
            <select
              className="input"
              value={c.exam.shuffle ? "1" : "0"}
              onChange={(e) => setExam("shuffle", e.target.value === "1")}
            >
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </Field>
        </div>
        )}
        {c.exam.required && (
          <p className="text-[11px] text-slate-500 mt-3">
            Each question is worth{" "}
            <b className="text-slate-800">{pointsPerQuestion(c.exam.questionCount)} points</b> — the
            exam is scored out of 100 and every question carries equal weight. Points are applied to
            all questions in the bank when you save this step.
          </p>
        )}
      </Section>

      )}
      {show(4) && !c.exam.required && (
      <Section title="Exam Question Bank">
        <p className="text-sm text-slate-500 py-6 text-center">
          This course has no exam. Turn it on under Exam Settings to add questions.
        </p>
      </Section>
      )}
      {show(4) && c.exam.required && (
      <Section title={`Exam Question Bank (${questions.length})`}>
        <QuestionBank
          courseId={id!}
          courseTitle={c.title}
          questions={questions}
          pointsPer={pointsPerQuestion(c.exam.questionCount)}
        />
      </Section>
      )}
      {show(5) && (
      <Section title="Summary & Publish">
        <div className="text-sm">
          <SummaryRow label="Course Title" value={c.title} />
          <SummaryRow
            label="Revision"
            value={
              c.revisionNo
                ? `${c.revisionNo}${c.revisionDate ? ` · ${c.revisionDate}` : ""}`
                : "— not set —"
            }
          />
          <SummaryRow label="Category" value={c.category || "—"} />
          <SummaryRow
            label="Validity Period"
            value={recurText(c.recurrenceEvery, c.recurrenceUnit)}
          />
          <SummaryRow label="Sections" value={String(sectionCount)} />
          {c.exam.required && (
            <SummaryRow label="Question Bank" value={`${questions.length} question(s)`} />
          )}
          <SummaryRow
            label="Exam"
            value={c.exam.required ? `${c.exam.questionCount} question(s)` : "No exam"}
          />
          {c.exam.required && (
            <SummaryRow label="Passing Score" value={`${c.passingScore}%`} />
          )}
          <label className="flex items-center gap-2 mt-4 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              checked={c.isActive}
              onChange={() => set("isActive", !c.isActive)}
              className="accent-brand-600 h-4 w-4"
            />
            {externalOnly
              ? "Published (tracked as a requirement)"
              : "Published (assignable to employees)"}
          </label>
        </div>
      </Section>
      )}

      {/* Alt navigasyon — yeni kurs kurarken sırayla ilerlemek için;
          mevcut kursta soldaki raydan istenen adıma doğrudan gidilir. */}
      <div className="flex items-center justify-between mt-3">
        <button
          onClick={() => goStep(-1)}
          disabled={atIdx === 0}
          className="btn-secondary disabled:opacity-40"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-emerald-600 font-semibold">✓ Saved</span>}
          {err && <span className="text-xs text-brand-700">{err}</span>}
          {atIdx < stepNos.length - 1 ? (
            <button
              onClick={async () => {
                if (step === 1 || step === 3) await save();
                goStep(1);
              }}
              className="btn-primary"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={async () => {
                if (!(await save())) return;
                try {
                  // Yayın = yeni revizyon. Anlık kopya Function tarafında yazılır.
                  await httpsCallable(functions, "publishCourse")({ courseId: id });
                } catch (e) {
                  setErr((e as Error).message);
                  return;
                }
                navigate("/courses");
              }}
              className="btn-primary"
            >
              Save &amp; Publish
            </button>
          )}
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-2">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card mb-3">
      <div className="px-5 py-3 border-b border-slate-100">
        <div className="text-[13px] font-semibold text-slate-900 tracking-[-0.01em]">{title}</div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/**
 * Sol ray — hem gezinme hem kontrol listesi. Eski sihirbaz çubuğu yalnızca
 * "kaçıncı adımdasın" diyordu; asıl soru "bu kurs yayına hazır mı" idi ve
 * cevabı hiçbir yerde yoktu.
 */
function StepRail({
  steps,
  step,
  onStep,
  readiness,
  label,
  doneCount,
  total,
}: {
  steps: number[];
  step: number;
  onStep: (n: number) => void;
  readiness: Record<number, boolean | null>;
  label: Record<number, string>;
  doneCount: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 100;
  const complete = doneCount === total;

  const GROUP: Record<number, string> = { 1: "Course", 3: "Exam", 5: "Publish" };

  return (
    <div className="card p-1.5 lg:sticky lg:top-[72px]">
      {steps.map((n) => {
        const state = readiness[n];
        const on = step === n;
        return (
          <div key={n}>
            {GROUP[n] && (
              <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400 px-2.5 pt-2.5 pb-1">
                {GROUP[n]}
              </div>
            )}
            <button
              onClick={() => onStep(n)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-left text-[12.5px] transition ${
                on
                  ? "bg-slate-100 text-slate-900 font-semibold"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span
                className={`h-[15px] w-[15px] rounded-full grid place-items-center text-[9px] font-extrabold shrink-0 ${
                  state === null
                    ? "bg-slate-100 text-slate-400"
                    : state
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-800"
                }`}
                aria-hidden="true"
              >
                {state === null ? "·" : state ? "✓" : "!"}
              </span>
              <span className="min-w-0 truncate">{label[n]}</span>
            </button>
          </div>
        );
      })}

      <div className="border-t border-slate-100 mt-1.5 pt-2 px-2.5 pb-1">
        <div className="flex justify-between text-[11px] text-slate-500">
          <span>Readiness</span>
          <span className={`font-semibold ${complete ? "text-emerald-700" : "text-amber-700"}`}>
            {doneCount}/{total}
          </span>
        </div>
        <div className="h-[5px] rounded-full bg-slate-100 overflow-hidden mt-1.5">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${pct}%`, background: complete ? "#30b15a" : "#f0a020" }}
          />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

type SectionContent =
  | { id: string; type: "VIDEO"; url: string; fileName: string; storagePath: string }
  | { id: string; type: "PDF"; url: string; fileName: string; storagePath: string }
  | { id: string; type: "SCORM"; entryPoint: string; version: string; basePath: string; fileName: string };

type SectionT = {
  id: string;
  order: number;
  title: string;
  contents?: SectionContent[];
  // Eski tek-içerik alanı (geri uyum) — sectionContents() ile listeye çevrilir.
  content?: (Partial<SectionContent> & { type: SectionContent["type"] }) | null;
};

const CONTENT_LABEL: Record<SectionContent["type"], string> = {
  VIDEO: "Video",
  PDF: "PDF / Document",
  SCORM: "SCORM",
};

function sectionContents(s: SectionT): SectionContent[] {
  if (s.contents?.length) return s.contents;
  if (s.content) return [{ ...(s.content as SectionContent), id: s.content.id ?? "legacy" }];
  return [];
}

function Sections({ courseId }: { courseId: string }) {
  const [rows, setRows] = useState<SectionT[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, "courses", courseId, "sections"), orderBy("order")),
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SectionT, "id">) })))
    );
  }, [courseId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const nextOrder = rows.length ? Math.max(...rows.map((r) => r.order)) + 1 : 1;
      await addDoc(collection(db, "courses", courseId, "sections"), {
        title: title.trim(),
        order: nextOrder,
        content: null,
        createdAt: serverTimestamp(),
      });
      setTitle("");
    } catch (e2) {
      setErr("Could not add section: " + (e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const a = rows[i];
    const b = rows[j];
    await Promise.all([
      updateDoc(doc(db, "courses", courseId, "sections", a.id), { order: b.order }),
      updateDoc(doc(db, "courses", courseId, "sections", b.id), { order: a.order }),
    ]);
  }

  async function remove(id: string) {
    if (!confirm("Delete this section?")) return;
    await deleteDoc(doc(db, "courses", courseId, "sections", id));
  }

  return (
    <div>
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 mb-4 text-[12px] text-slate-500">
        Sections are completed <b>in order</b> — the next one unlocks only after the current one
        is finished. <b>Click a section</b> to add or change its content.
      </div>

      <form onSubmit={add} className="flex items-end gap-2 mb-4">
        <div className="flex-1">
          <label className="label">New Section Title</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Section 1 — Introduction"
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          Add Section
        </button>
      </form>
      {err && <p className="text-xs text-brand-700 mb-3">{err}</p>}

      {rows.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-3">No sections yet.</p>
      )}
      <ol className="space-y-2">
        {rows.map((s, i) => {
          const cs = sectionContents(s);
          return (
          <li key={s.id} className="rounded-lg border border-slate-200 overflow-hidden">
            <div
              className={`flex items-center gap-3 p-3 cursor-pointer ${
                openId === s.id ? "bg-slate-50" : "hover:bg-slate-50/70"
              }`}
              onClick={() => setOpenId(openId === s.id ? null : s.id)}
            >
              <div className="h-7 w-7 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center text-xs font-bold shrink-0">
                {i + 1}
              </div>
              <svg
                viewBox="0 0 20 20"
                className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${
                  openId === s.id ? "rotate-90" : ""
                }`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-slate-900 truncate">{s.title}</div>
                <div className="text-[11px]">
                  {cs.length ? (
                    <span className="text-emerald-600">
                      ● {cs.length} item(s): {cs.map((c) => CONTENT_LABEL[c.type]).join(", ")}
                    </span>
                  ) : (
                    <span className="text-amber-600">● No content</span>
                  )}
                </div>
              </div>
              <div
                className="flex items-center gap-1 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="btn-secondary text-xs py-1 px-2 disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                  className="btn-secondary text-xs py-1 px-2 disabled:opacity-40"
                >
                  ↓
                </button>
                <button
                  onClick={() => remove(s.id)}
                  className="text-[11px] text-brand-700 hover:underline px-2"
                >
                  Delete
                </button>
              </div>
            </div>
            {openId === s.id && (
              <div className="border-t border-slate-200 bg-slate-50/60 p-3">
                <SectionContentEditor courseId={courseId} section={s} />
              </div>
            )}
          </li>
          );
        })}
      </ol>
    </div>
  );
}

/** İçerik tipi kartları — "ne yükleyeceğim" sorusunun cevabı. */
const CONTENT_TYPES = [
  { type: "VIDEO" as const, icon: "🎬", label: "Video", hint: "mp4" },
  { type: "PDF" as const, icon: "📄", label: "Document", hint: "PDF" },
  { type: "SCORM" as const, icon: "📦", label: "SCORM", hint: ".zip package" },
];

function uploadError(e: unknown) {
  const m = (e as Error).message || String(e);
  if (/storage\/unauthorized|permission/i.test(m))
    return "Permission error — are Storage rules deployed? (firebase deploy --only storage)";
  if (/storage\/(unknown|retry-limit|object-not-found)|bucket|CORS/i.test(m))
    return "Storage error — is Storage enabled? (Console → Storage → Get started). " + m;
  return m;
}

function SectionContentEditor({ courseId, section }: { courseId: string; section: SectionT }) {
  // Önce "ne yükleyeceğim" sorulur; tip seçilmeden yükleme alanı açılmaz.
  const [type, setType] = useState<SectionContent["type"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const secRef = doc(db, "courses", courseId, "sections", section.id);
  const existing = sectionContents(section);

  async function addContent(item: SectionContent) {
    // Yeni içeriği listeye ekle; eski tek-içerik alanını temizle.
    await updateDoc(secRef, { contents: [...existing, item], content: deleteField() });
  }

  async function removeContent(id: string) {
    if (!confirm("Delete this content item?")) return;
    await updateDoc(secRef, {
      contents: existing.filter((c) => c.id !== id),
      content: deleteField(),
    });
  }

  async function uploadFile(file: File, kind: "VIDEO" | "PDF") {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const cid = crypto.randomUUID();
      const path = `content/${courseId}/${section.id}/${kind.toLowerCase()}/${cid}-${file.name}`;
      const r = ref(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      await addContent({ id: cid, type: kind, url, fileName: file.name, storagePath: path });
      setMsg(`${kind === "VIDEO" ? "Video" : "PDF"} added.`);
      setType(null);
    } catch (e) {
      setErr(uploadError(e));
    } finally {
      setBusy(false);
    }
  }

  // SCORM'u tarayıcıda işle: zip'i aç, imsmanifest.xml'den giriş noktası +
  // sürümü bul, tüm dosyaları Storage'a çıkar, bölüme ekle. Function gerekmez.
  async function processScorm(file: File) {
    setErr(null);
    setMsg(null);
    setBusy(true);
    setProgress(null);
    try {
      const cid = crypto.randomUUID();
      const zip = await JSZip.loadAsync(file);
      const names = Object.keys(zip.files);
      const manifestName = names.find((n) => n.toLowerCase().endsWith("imsmanifest.xml"));
      if (!manifestName)
        throw new Error("No imsmanifest.xml in the package — not a valid SCORM zip.");
      const baseDir = manifestName.includes("/")
        ? manifestName.slice(0, manifestName.lastIndexOf("/") + 1)
        : "";
      const manifestXml = await zip.files[manifestName].async("string");
      const version: "SCORM_12" | "SCORM_2004" =
        /2004|adlseq|adlnav|imsss/i.test(manifestXml) ? "SCORM_2004" : "SCORM_12";
      const dom = new DOMParser().parseFromString(manifestXml, "text/xml");
      const withHref = Array.from(dom.getElementsByTagName("resource")).filter((r) =>
        r.getAttribute("href")
      );
      const sco = withHref.find((r) =>
        (r.getAttribute("adlcp:scormtype") || r.getAttribute("adlcp:scormType") || "")
          .toLowerCase()
          .includes("sco")
      );
      const entryPoint = (sco || withHref[0])?.getAttribute("href") || "index.html";

      const basePath = `content/${courseId}/${section.id}/scorm/${cid}/`;
      const fileEntries = names.filter(
        (n) => !zip.files[n].dir && (n.startsWith(baseDir) ? n.slice(baseDir.length) : n)
      );
      if (fileEntries.length === 0) throw new Error("No files found in the package.");
      // Paralel yükleme (6'lı havuz) — yüzlerce dosyalı paketler için hızlı.
      let done = 0;
      let cursor = 0;
      const worker = async () => {
        while (cursor < fileEntries.length) {
          const n = fileEntries[cursor++];
          const rel = n.startsWith(baseDir) ? n.slice(baseDir.length) : n;
          const blob = await zip.files[n].async("blob");
          try {
            await uploadBytes(ref(storage, basePath + rel), blob);
          } catch (e) {
            throw new Error(`Failed to upload "${rel}": ${(e as Error).message}`);
          }
          done++;
          setProgress(`${done} / ${fileEntries.length} files`);
        }
      };
      await Promise.all(Array.from({ length: 6 }, () => worker()));
      await addContent({ id: cid, type: "SCORM", entryPoint, version, basePath, fileName: file.name });
      setMsg(
        `SCORM processed — entry: ${entryPoint} (${version === "SCORM_2004" ? "2004" : "1.2"})`
      );
      setType(null);
    } catch (e) {
      setErr(uploadError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div>
      {/* Mevcut içerikler + önizleme */}
      {existing.length > 0 && (
        <div className="space-y-2 mb-4">
          {existing.map((c) => (
            <ContentItem key={c.id} item={c} onRemove={() => removeContent(c.id)} />
          ))}
        </div>
      )}

      {/* Yeni içerik ekle — önce tip kartları */}
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">
        + Add Content
      </div>

      {type === null ? (
        <div className="grid grid-cols-3 gap-2">
          {CONTENT_TYPES.map((t) => (
            <button
              key={t.type}
              type="button"
              onClick={() => {
                setType(t.type);
                setMsg(null);
                setErr(null);
              }}
              className="rounded-lg border border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/40 transition p-3 text-center"
            >
              <div className="text-xl leading-none mb-1.5">{t.icon}</div>
              <div className="text-[12px] font-semibold text-slate-800">{t.label}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{t.hint}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[12px] font-semibold text-slate-800">
              {CONTENT_TYPES.find((t) => t.type === type)?.icon}{" "}
              {CONTENT_TYPES.find((t) => t.type === type)?.label}
            </span>
            <button
              type="button"
              onClick={() => setType(null)}
              disabled={busy}
              className="text-[11px] font-semibold text-slate-500 hover:text-brand-700 disabled:opacity-40"
            >
              ← Change type
            </button>
          </div>

      {type === "VIDEO" && (
        <div>
          <label className="label">Upload Video (mp4)</label>
          <input
            type="file"
            accept="video/mp4,video/*"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], "VIDEO")}
            className="text-sm"
          />
        </div>
      )}

      {type === "PDF" && (
        <div>
          <label className="label">Upload PDF / Document</label>
          <input
            type="file"
            accept=".pdf,application/pdf"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0], "PDF")}
            className="text-sm"
          />
        </div>
      )}

      {type === "SCORM" && (
        <div>
          <label className="label">SCORM Package (.zip)</label>
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && processScorm(e.target.files[0])}
            className="text-sm"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            The zip is unpacked, the entry point is detected and files are uploaded.
          </p>
        </div>
      )}

          {busy && (
            <p className="text-xs text-slate-500 mt-2">Uploading… {progress ?? ""}</p>
          )}
        </div>
      )}

      {msg && <p className="text-xs text-emerald-600 mt-2">✓ {msg}</p>}
      {err && <p className="text-xs text-brand-700 mt-2">{err}</p>}
    </div>
  );
}

function ContentItem({ item, onRemove }: { item: SectionContent; onRemove: () => void }) {
  const [preview, setPreview] = useState(false);
  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-white flex items-center justify-between px-3 py-2 gap-3">
        <div className="text-[12px] min-w-0 flex items-center gap-2">
          <span className="inline-block px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 text-[10px] font-bold">
            {CONTENT_LABEL[item.type]}
          </span>
          <span className="text-slate-700 truncate">{item.fileName}</span>
        </div>
        <div className="flex gap-3 shrink-0">
          <button onClick={() => setPreview(true)} className="text-[11px] text-sky-700 hover:underline">
            Preview
          </button>
          <button onClick={onRemove} className="text-[11px] text-brand-700 hover:underline">
            Delete
          </button>
        </div>
      </div>
      {preview && <PreviewModal item={item} onClose={() => setPreview(false)} />}
    </>
  );
}

// SCORM/içerik servis eden Cloud Function'ın taban URL'i (aynı-origin dizin servisi).
const SCORM_SERVE_BASE =
  "https://europe-west3-bonair-academy.cloudfunctions.net/serveScormContent";

function PreviewModal({ item, onClose }: { item: SectionContent; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[88vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 sticky top-0 bg-white">
          <div className="text-sm font-semibold text-slate-900 truncate">
            <span className="text-brand-700">{CONTENT_LABEL[item.type]}</span> — {item.fileName}
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center shrink-0"
            aria-label="Kapat"
          >
            ✕
          </button>
        </div>
        <div className="p-4">
          {item.type === "VIDEO" && (
            <video controls autoPlay src={item.url} className="w-full rounded bg-black" />
          )}
          {item.type === "PDF" && (
            <div>
              <iframe
                src={item.url}
                className="w-full h-[68vh] rounded border border-slate-200"
                title={item.fileName}
              />
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-sky-700 hover:underline mt-1 inline-block"
              >
                Open in new tab ↗
              </a>
            </div>
          )}
          {item.type === "SCORM" && (
            <div>
              <iframe
                src={`${SCORM_SERVE_BASE}/${item.basePath}${item.entryPoint}`}
                className="w-full h-[68vh] rounded border border-slate-200 bg-white"
                title={item.fileName}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Entry: {item.entryPoint} ({item.version === "SCORM_2004" ? "2004" : "1.2"}) ·
                If it appears blank, the Cloud Function may not be deployed yet.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Excel şablonu indirme + toplu soru yükleme. */
function BulkImport({
  courseId,
  courseTitle,
  pointsPer,
}: {
  courseId: string;
  courseTitle: string;
  pointsPer: number;
}) {
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setParsed(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    setMsg(null);
    setFileName(f.name);
    try {
      setParsed(await parseWorkbook(f, pointsPer));
    } catch (e2) {
      setErr(`Could not read the file: ${(e2 as Error).message}`);
      setParsed(null);
    }
  }

  async function importAll() {
    if (!parsed || parsed.questions.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      // Firestore toplu yazımı 500 işlemle sınırlı; parçalara böl.
      const col = collection(db, "courses", courseId, "questions");
      for (let i = 0; i < parsed.questions.length; i += 400) {
        const batch = writeBatch(db);
        for (const q of parsed.questions.slice(i, i + 400)) {
          batch.set(doc(col), {
            text: q.text,
            points: q.points,
            options: q.options.map((o) => ({
              id: crypto.randomUUID(),
              text: o.text,
              isCorrect: o.isCorrect,
            })),
          });
        }
        await batch.commit();
      }
      setMsg(`${parsed.questions.length} question(s) imported.`);
      reset();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-slate-900">Bulk import from Excel</div>
          <p className="text-[11px] text-slate-500">
            Download the template, fill one question per row, then upload it back here.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => downloadTemplate(courseTitle)}
            className="btn-secondary text-xs py-1.5"
          >
            ↓ Download Template
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="btn-primary text-xs py-1.5"
          >
            ↑ Upload Excel
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm,.xls,.csv"
            onChange={onPick}
            className="hidden"
          />
        </div>
      </div>

      {parsed && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="text-[12px] text-slate-600 mb-2">
            <b>{fileName}</b> · sheet “{parsed.sheetName}” ·{" "}
            <span className="text-emerald-700 font-semibold">
              {parsed.questions.length} ready
            </span>
            {parsed.errors.length > 0 && (
              <>
                {" · "}
                <span className="text-brand-700 font-semibold">
                  {parsed.errors.length} skipped
                </span>
              </>
            )}
          </div>

          {parsed.errors.length > 0 && (
            <ul className="mb-3 max-h-32 overflow-auto rounded-md bg-brand-50/60 border border-brand-100 p-2 space-y-0.5">
              {parsed.errors.map((e) => (
                <li key={e.row} className="text-[11px] text-brand-700">
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}

          {parsed.questions.length === 0 ? (
            <p className="text-[12px] text-slate-500">
              Nothing to import. Fix the rows above and upload the file again.
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={importAll}
                disabled={busy}
                className="btn-primary text-xs py-1.5"
              >
                {busy ? "Importing…" : `Import ${parsed.questions.length} Question(s)`}
              </button>
              <button type="button" onClick={reset} className="btn-secondary text-xs py-1.5">
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {msg && <p className="mt-2 text-xs text-emerald-600 font-semibold">✓ {msg}</p>}
      {err && <p className="mt-2 text-xs text-brand-700">{err}</p>}
    </div>
  );
}

function QuestionBank({
  courseId,
  courseTitle,
  questions,
  pointsPer,
}: {
  courseId: string;
  courseTitle: string;
  questions: Question[];
  pointsPer: number;
}) {
  const [text, setText] = useState("");
  const [opts, setOpts] = useState(["", "", "", ""]);
  const [correct, setCorrect] = useState(0);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const filled = opts.map((t) => t.trim());
    if (!text.trim() || filled.filter(Boolean).length < 2) return;
    setBusy(true);
    try {
      const options: Option[] = filled
        .map((t, i) => ({ id: crypto.randomUUID(), text: t, isCorrect: i === correct }))
        .filter((o) => o.text);
      await addDoc(collection(db, "courses", courseId, "questions"), {
        text: text.trim(),
        points: pointsPer,
        options,
      });
      setText("");
      setOpts(["", "", "", ""]);
      setCorrect(0);
    } finally {
      setBusy(false);
    }
  }

  async function remove(qid: string) {
    await deleteDoc(doc(db, "courses", courseId, "questions", qid));
  }

  return (
    <div>
      <BulkImport courseId={courseId} courseTitle={courseTitle} pointsPer={pointsPer} />

      <form onSubmit={add} className="rounded-lg border border-slate-200 p-4 mb-4 bg-slate-50/50">
        <label className="label">Question Text</label>
        <input
          className="input mb-3"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type the question…"
        />
        <label className="label">Options (select the correct one)</label>
        <div className="space-y-2 mb-3">
          {opts.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name="correct"
                checked={correct === i}
                onChange={() => setCorrect(i)}
                className="accent-brand-600"
              />
              <input
                className="input"
                value={o}
                onChange={(e) => setOpts((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`Option ${i + 1}`}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Adding…" : "Add Question"}
          </button>
          <span className="text-[11px] text-slate-500">
            Worth <b className="text-slate-700">{pointsPer} points</b> — set automatically from the
            question count in Exam Settings.
          </span>
        </div>
      </form>

      {questions.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-4">No questions yet.</p>
      )}
      <ol className="space-y-2">
        {questions.map((q, i) => (
          <li key={q.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-medium text-slate-900">
                {i + 1}. {q.text}{" "}
                <span className="text-[11px] text-slate-400">({q.points} pts)</span>
              </div>
              <button
                onClick={() => remove(q.id)}
                className="text-[11px] text-brand-700 hover:underline shrink-0"
              >
                Delete
              </button>
            </div>
            <ul className="mt-2 space-y-1 text-[13px]">
              {q.options.map((o) => (
                <li
                  key={o.id}
                  className={o.isCorrect ? "text-emerald-700 font-medium" : "text-slate-600"}
                >
                  {o.isCorrect ? "✓" : "○"} {o.text}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
