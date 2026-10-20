import { PageHead } from "../components/PageHead";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { asLang, LANG_LABEL, publishedLangsOf, type Lang } from "../lib/lang";
import { certIdForCycle } from "../lib/records";
import { Flag } from "../components/Flag";
import { Modal } from "../components/Modal";
import { CertificateSheet, type Cert } from "../components/CertificateSheet";
import { printCertificate } from "../lib/print";
import { Link, useParams } from "react-router-dom";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import { ORG } from "../lib/org";
import { PdfReader } from "../components/PdfReader";
import { ScormPlayer } from "../components/ScormPlayer";
import { useScormSrc } from "../lib/scormAccess";
import { ExamRunner, type ExamQ } from "../components/ExamRunner";
import { ExamIntro } from "../components/ExamIntro";

// Aynı origin'den servis edilir (hosting rewrite / vite proxy) — SCORM paketi
// LMS API'sini window.parent üzerinde arıyor, çapraz origin'de erişemez.
const SCORM_SERVE_BASE = "/scorm-content";

type Content =
  | { id: string; type: "VIDEO"; url: string; fileName: string }
  | { id: string; type: "PDF"; url: string; fileName: string }
  | { id: string; type: "SCORM"; entryPoint: string; basePath: string; fileName: string };

/** Bölüm bir DİL SÜRÜMÜNE ait; başka dilin bölümleri ayrı kayıt. */
type Section = {
  id: string;
  order: number;
  title: string;
  lang?: string;
  contents?: Content[];
  content?: any;
};
type Assignment = {
  courseId: string;
  courseTitle: string;
  status: string;
  sectionsDone?: string[];
  /** Öğrencinin eğitimi aldığı dil. Kayıtta tutuluyor, görüntüleme tercihi değil. */
  contentLanguage?: Lang;
  /** Kişi dili bizzat seçti mi? Atama açılırken yazılan varsayılandan ayırır. */
  languageChosen?: boolean;
  /** Kaçıncı kez alınıyor — sertifika kimliği buna bağlı. */
  cycleNumber?: number;
  /** Geçilen sınavın notu (submitExam yazar). */
  examScore?: number | null;
  /** Yönetici erişimi engelledi (setAssignmentAccess). */
  accessBlocked?: boolean;
};

/** Bölümün ham içerik listesi (eski tek-içerik alanı dahil). */
function contentsOf(s: Section): Content[] {
  if (s.contents?.length) return s.contents;
  if (s.content) return [{ ...(s.content as any), id: s.content.id ?? "legacy" }];
  return [];
}

export function Learn() {
  const { id } = useParams<{ id: string }>();
  const [a, setA] = useState<Assignment | null>(null);
  const [gone, setGone] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Sınav durumu
  const [exam, setExam] = useState<{
    attemptNo: number;
    passingScore: number;
    questions: ExamQ[];
    language: Lang;
    deadlineMs: number | null;
    /** Sunucu saati − istemci saati; geri sayım sunucuya göre işler. */
    clockOffsetMs: number;
  } | null>(null);
  const [result, setResult] = useState<{
    passed: boolean;
    score: number;
    status: string;
    /** Süre dolduktan sonra kapanan deneme — cevaplar sayılmadı. */
    expired?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    // Atama kaldırıldıysa belge yok; kural da yok belgeyi okumaya izin
    // vermez (hata döner). İkisinde de "Loading…" sonsuza dek kalıyordu.
    return onSnapshot(
      doc(db, "assignments", id),
      (d) => (d.exists() ? setA(d.data() as Assignment) : setGone(true)),
      () => setGone(true)
    );
  }, [id]);

  /**
   * Yalnızca kişinin aldığı DİL SÜRÜMÜNÜN bölümleri. Diller ayrı sürüm:
   * İngilizce sürümün bölüm sayısı ve sırası Türkçeden farklı olabilir.
   */
  useEffect(() => {
    if (!a?.courseId) return;
    const lang = asLang(a.contentLanguage);
    return onSnapshot(
      query(collection(db, "courses", a.courseId, "sections"), orderBy("order")),
      (snap) =>
        setSections(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as any) }))
            .filter((s: Section) => asLang(s.lang) === lang)
        ),
      // Erişim engellenince/atama kalkınca kural okumayı reddeder.
      () => setSections([])
    );
  }, [a?.courseId, a?.contentLanguage]);

  /**
   * Kursun sınavı var mı — soldaki rayda sınav satırının en baştan görünmesi
   * için gerekli. Eskiden sınav ancak bütün bölümler bitince ayrı bir kutuda
   * beliriyordu; o ana kadar varlığından haberin olmuyordu.
   */
  const [examRequired, setExamRequired] = useState<boolean | null>(null);
  /** Kursun yayınlanmış dilleri — kapıda yalnızca bunlar gösterilir. */
  const [courseLangs, setCourseLangs] = useState<Lang[]>([]);
  useEffect(() => {
    if (!a?.courseId) return;
    return onSnapshot(doc(db, "courses", a.courseId), (d) => {
      const x = d.data() as any;
      setExamRequired(x?.exam?.required !== false);
      setCourseLangs(publishedLangsOf(x ?? {}));
    });
  }, [a?.courseId]);

  const done = useMemo(() => new Set(a?.sectionsDone || []), [a?.sectionsDone]);
  const currentIndex = sections.findIndex((s) => !done.has(s.id));

  // Bu oturumda hangi içerikler gerçekten tüketildi (id -> true). Tarayıcıda
  // SAKLANMIYOR: 2. başarısız sınavda bölümler sıfırlanıyor ve kişinin
  // yeniden okuması isteniyor; saklansaydı eski okuma sayılıp bölümler
  // kendiliğinden yeniden tamamlanırdı.
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
  /**
   * Sınav ya da "tamamlandı" ekranındayken raydan bir bölüm seçildi: o bölüm
   * gösterilir. Eskiden bu ekranlarda bölüm görünümü hiç çizilmiyordu,
   * raydaki bölüme tıklamak hiçbir şey yapmıyordu.
   */
  const reviewing = selectedIndex >= 0;
  const viewDone = viewIndex >= 0 ? done.has(sections[viewIndex].id) : false;

  /**
   * Seçili dil. Kaynak atama dokümanı — kişi hangi dilde çalıştıysa kaydın
   * parçası.
   */
  const lang: Lang = asLang(a?.contentLanguage);

  /**
   * Dil kapısı yalnızca gerçek bir seçim varsa çıkar: birden fazla dil
   * yayınlanmış VE kişi henüz seçmemiş. Atama açılırken bir dil yazıldığı için
   * `languageChosen` ayrı tutuluyor — "varsayılan atandı" ile "kişi seçti"
   * farklı şeyler.
   */
  const needsLangChoice =
    courseLangs.length > 1 &&
    !a?.languageChosen &&
    // Biten eğitimde dil sorulmaz: sertifika verildi ve sunucu zaten dil
    // değişimini reddediyor — kapı çıksaydı iki bayrak da hata verirdi.
    a?.status !== "COMPLETED" &&
    a?.status !== "EXAM_PASSED";

  const viewContents = viewIndex >= 0 ? contentsOf(sections[viewIndex]) : [];
  const currentContents = currentIndex >= 0 ? contentsOf(sections[currentIndex]) : [];
  /**
   * Bölüm içinde açık olan materyal. Varsayılan: bitmemiş ilk materyal.
   * Kullanıcı bitmiş olanlara geri dönebilir; ileriye atlayamaz.
   */
  const [itemIndex, setItemIndex] = useState<number | null>(null);
  const firstOpenItem = Math.max(
    0,
    viewContents.findIndex((c) => !consumed[c.id])
  );
  const itemAt =
    itemIndex !== null && itemIndex < viewContents.length ? itemIndex : firstOpenItem;
  // Bölüm değişince seçim sıfırlanmalı, yoksa yeni bölümde yanlış materyal açılır.
  useEffect(() => setItemIndex(null), [viewIndex]);


  /**
   * Bu atamanın BU DÖNGÜDEKİ sertifikası.
   *
   * Yenilemede atama aynı dokümanda kalıyor ama sertifika her döngüde ayrı
   * kimlikle yazılıyor; atama kimliğiyle okumak hep İLK belgeyi getiriyordu.
   */
  const [certOpen, setCertOpen] = useState(false);
  const [myCert, setMyCert] = useState<Cert | null>(null);
  const [certErr, setCertErr] = useState<string | null>(null);
  /* Pencere her açıldığında BU döngünün belgesi canlı dinlenir. Eskiden belge
     bir kez yüklenince hafızada kalıyordu: aynı oturumda eğitim yeniden
     alınıp yeni sertifika üretilse bile pencere eski döngünün belgesini
     (eski kurs adıyla) göstermeye devam ediyordu. */
  const certId = id ? certIdForCycle(id, a?.cycleNumber) : null;
  useEffect(() => {
    setMyCert(null);
    setCertErr(null);
    if (!certOpen || !certId) return;
    return onSnapshot(
      doc(db, "certificates", certId),
      (d) => {
        if (d.exists()) {
          setMyCert({ id: d.id, ...(d.data() as Omit<Cert, "id">) });
          setCertErr(null);
        } else {
          setMyCert(null);
          setCertErr("No certificate has been issued for this training.");
        }
      },
      (e) => setCertErr(e.message)
    );
  }, [certOpen, certId]);

  const remaining = currentContents.filter((c) => !consumed[c.id]);
  const canComplete = currentContents.length > 0 && remaining.length === 0;

  /**
   * Dili değiştir. Atamaya istemci yazamıyor, Function üzerinden geçiyor;
   * Function durumu yeni dilin bölümlerine göre baştan hesaplıyor.
   */
  const [langBusy, setLangBusy] = useState(false);
  /** Onay bekleyen dil değişikliği. */
  const [langAsk, setLangAsk] = useState<Lang | null>(null);
  /** Hangi bayrağa basıldı — yükleme göstergesi yalnızca onun üstünde. */
  const [langPicked, setLangPicked] = useState<Lang | null>(null);

  async function switchLang(next: Lang) {
    // Aynı dili seçmek de bir SEÇİMDİR: kapı "hangi dilde alacaksın" diye
    // soruyor ve atamada zaten yazılı olan varsayılan genelde Türkçe. Burada
    // "zaten o dildesin" deyip çıkılırsa Türkçe'ye basmak hiçbir şey yapmıyor,
    // seçim kaydedilmiyor ve kapı kapanmıyordu. Function idempotent: aynı
    // dilde yalnızca languageChosen işaretliyor.
    if (!id) return;
    setLangAsk(null);
    setErr(null);
    setLangBusy(true);
    try {
      await httpsCallable(functions, "setAssignmentLanguage")({ assignmentId: id, language: next });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLangBusy(false);
    }
  }

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

  /*
   * Bölüm KENDİLİĞİNDEN tamamlanmaz (CAPELLA isteği): materyalin son sayfasına
   * gelince ekran bir sonraki bölüme atlıyordu. Kişi materyali bitirir,
   * "Complete this section"a basar, sonra sıradaki bölüme geçilir.
   */

  async function beginExam(language?: Lang) {
    if (!id) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await httpsCallable(functions, "startExam")({ assignmentId: id, language });
      const d = res.data as any;
      // Yarım kalan denemenin süresi çoktan dolmuşsa sunucu onu kapatıp
      // sonucu döndürüyor.
      if (d?.expired) {
        setResult(d.result);
        return;
      }
      setExam({
        attemptNo: d.attemptNo,
        passingScore: d.passingScore,
        questions: d.questions,
        language: asLang(d.language),
        deadlineMs: d.deadlineMs ?? null,
        clockOffsetMs: d.serverNow ? d.serverNow - Date.now() : 0,
      });
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
      try {
        localStorage.removeItem(`exam:${id}:${exam.attemptNo}`);
      } catch {
        /* yok say */
      }
      // 2. başarısızlıkta sunucu bölümleri sıfırladı: bu oturumdaki okuma
      // sayılmamalı — kişi materyali yeniden bitirmeli.
      if ((res.data as any)?.status === "RETAKE_REQUIRED") setConsumed({});
      setExam(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (gone)
    return (
      <div className="card max-w-lg mx-auto mt-10 px-6 py-8 text-center">
        <div className="text-[15px] font-semibold text-slate-900">Training not available</div>
        <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">
          This training is no longer assigned to you. Any certificate you earned is in My Certificates.
        </p>
        <div className="flex justify-center gap-2 mt-5">
          <Link to="/certificates" className="btn-primary text-xs py-2">
            My Certificates
          </Link>
          <Link to="/dashboard" className="btn-secondary text-xs py-2">
            Dashboard
          </Link>
        </div>
      </div>
    );
  if (!a) return <div className="text-sm text-slate-400 py-10">Loading…</div>;
  if (a.accessBlocked)
    return (
      <div className="card max-w-lg mx-auto mt-10 px-6 py-8 text-center">
        <div className="text-[15px] font-semibold text-slate-900">Access suspended</div>
        <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">
          Your access to <b>{a.courseTitle}</b> has been suspended. Please contact{" "}
          <a href={`mailto:${ORG.contactEmail}`} className="text-brand-700 font-semibold hover:underline">
            {ORG.contactEmail}
          </a>
          .
        </p>
        <Link to="/dashboard" className="btn-secondary text-xs py-2 mt-5 inline-flex">
          Back to dashboard
        </Link>
      </div>
    );

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
      {err && <p className="text-xs text-red-700 mb-3">{err}</p>}

      {/* DİL KAPISI — eğitimin birden fazla dili yayınlanmışsa, içeriğe
          geçmeden önce tek soru. Seçim atama kaydına yazılıyor; bir daha
          sorulmuyor, üstteki küçük bayraktan değiştirilebiliyor.

          Tek dil yayınlandıysa kapı hiç çıkmaz: tek cevaplı soru sormak
          kullanıcıyı boşuna durdurmak olurdu. */}
      {needsLangChoice ? (
        <div className="card p-8 text-center max-w-md mx-auto">
          <div className="text-[15px] font-semibold text-slate-900 mb-1">{a.courseTitle}</div>
          <p className="text-[13px] text-slate-500 mb-5">
            Which language would you like to take this training in?
          </p>
          <div className="flex gap-3 justify-center">
            {courseLangs.map((l) => (
              <button
                key={l}
                type="button"
                disabled={langBusy}
                onClick={() => {
                  setLangPicked(l);
                  void switchLang(l);
                }}
                className="relative flex flex-col items-center gap-2.5 rounded-xl border border-slate-200 px-6 py-4 hover:border-brand-500 hover:bg-brand-50/30 transition disabled:opacity-60"
              >
                <Flag lang={l} size={44} />
                <span className="text-[13px] font-semibold text-slate-700">{LANG_LABEL[l]}</span>
                {/* Seçim sunucuya gidip atamayı güncelliyor ve bölümler
                    yeniden okunuyor; o bir saniyede ekran donmuş gibi
                    görünüyordu. */}
                {langBusy && langPicked === l && (
                  <span className="absolute inset-0 grid place-items-center rounded-xl bg-white/70">
                    <Spinner />
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-4">
            {langBusy
              ? "Preparing your training…"
              : "You can change it later; progress is kept separately for each language."}
          </p>
        </div>
      ) : (
      <>

      {/* Seçili dil + değiştirme. Eğitim başladıktan sonra dil değişimi
          ilerlemeyi silmez: her dilin ilerlemesi ayrı tutuluyor. */}
      {courseLangs.length > 1 && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11.5px] text-slate-500">Language</span>
          {courseLangs.map((l) => (
            <button
              key={l}
              type="button"
              disabled={langBusy || lang === l}
              onClick={() => lang !== l && setLangAsk(l)}
              title={LANG_LABEL[l]}
              className={`inline-flex items-center rounded-md p-1 border transition ${
                lang === l
                  ? "border-brand-500 ring-2 ring-brand-500/15 cursor-default"
                  : "border-slate-200 opacity-60 hover:opacity-100 disabled:opacity-30"
              }`}
            >
              <Flag lang={l} size={22} />
            </button>
          ))}
        </div>
      )}

      {/* Dil değiştirme onayı. Eğitimin ortasında yanlışlıkla bayrağa basmak,
          kişiyi bambaşka bir sürümün başına atıyor — sorulmadan yapılmamalı. */}
      {langAsk && (
        <Modal
          title="Change language"
          subtitle={`${LANG_LABEL[lang]} → ${LANG_LABEL[langAsk]}`}
          onClose={() => setLangAsk(null)}
          width="max-w-md"
        >
          <p className="text-sm text-slate-700">
            You are switching to the <b>{LANG_LABEL[langAsk]}</b> version of this training. That
            version has its own sections, so you start it <b>from the beginning</b> and must
            complete all of its sections to finish.
          </p>
          <p className="text-[12.5px] text-slate-500 mt-2">
            {done.size > 0
              ? `The ${done.size} section(s) you completed in ${LANG_LABEL[lang]} stay on your record — switch back and you carry on where you left off.`
              : "You have not completed any section in this version yet."}
          </p>
          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
            <button
              onClick={() => void switchLang(langAsk)}
              disabled={langBusy}
              className="btn-primary text-xs py-2 disabled:opacity-40"
            >
              {langBusy ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner />
                  Switching…
                </span>
              ) : (
                `Switch to ${LANG_LABEL[langAsk]}`
              )}
            </button>
            <button onClick={() => setLangAsk(null)} className="btn-secondary text-xs py-2">
              Cancel
            </button>
          </div>
        </Modal>
      )}

      <div className="grid lg:grid-cols-[260px_1fr] gap-3 items-start">
        <ProgressRail
          sections={sections}
          done={done}
          currentIndex={currentIndex}
          viewIndex={viewIndex}
          examRequired={examRequired !== false}
          status={a.status}
          examActive={!!exam}
          examScore={a.examScore}
          onSelect={(id) => setSelected(id)}
        />

        <div>

      {/* SINAV SONUCU */}
      {result && (
        <div
          className={`card p-4 sm:p-6 mb-4 border-l-4 ${
            result.passed ? "border-l-emerald-500" : "border-l-red-500"
          }`}
        >
          <div className={`text-xl font-bold ${result.passed ? "text-emerald-700" : "text-red-700"}`}>
            {result.passed ? "Congratulations, you passed! 🎉" : "You did not pass the exam."}
          </div>
          <p className="text-sm text-slate-600 mt-1">Your score: {result.score}%</p>
          {result.expired && (
            <p className="text-sm text-red-800 mt-2">
              The time limit had passed before the exam was submitted, so this attempt was closed
              without counting the answers.
            </p>
          )}
          {result.passed ? (
            <button onClick={() => setCertOpen(true)} className="btn-primary mt-4">
              View My Certificate
            </button>
          ) : result.status === "RETAKE_REQUIRED" ? (
            <p className="text-sm text-red-800 mt-3">
              You did not pass on your second attempt. Please consult your instructor or write to{" "}
              <a href={`mailto:${ORG.contactEmail}`} className="underline">{ORG.contactEmail}</a>.
            </p>
          ) : (
            <button onClick={() => setResult(null)} disabled={busy} className="btn-primary mt-4">
              Try Again
            </button>
          )}
        </div>
      )}

      {/* TAMAMLANDI */}
      {!result && !reviewing && a.status === "COMPLETED" && (
        <div className="card p-4 sm:p-6 border-l-4 border-l-emerald-500">
          <div className="text-xl font-bold text-emerald-700">You have completed this training ✓</div>
          <p className="text-[13px] text-slate-600 mt-1">
            You can go back through the material at any time — your result and certificate stay as they are.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <button onClick={() => setCertOpen(true)} className="btn-primary">
              View My Certificate
            </button>
            {sections.length > 0 && (
              <button onClick={() => setSelected(sections[0].id)} className="btn-secondary">
                Review training content
              </button>
            )}
          </div>
        </div>
      )}

      {/* SINAV */}
      {!result && exam && (
        <ExamRunner
          questions={exam.questions}
          passingScore={exam.passingScore}
          attemptNo={exam.attemptNo}
          busy={busy}
          lang={exam.language}
          deadlineMs={exam.deadlineMs}
          clockOffsetMs={exam.clockOffsetMs}
          storageKey={`exam:${id}:${exam.attemptNo}`}
          onSubmit={submit}
        />
      )}

      {/* SINAVA HAZIR — giriş ekranı: bilgiler, dil seçimi, kurallar */}
      {!result && !exam && !reviewing && id && (a.status === "SECTIONS_DONE" || a.status === "EXAM_FAILED") && (
        <ExamIntro assignmentId={id} busy={busy} onStart={(l) => void beginExam(l)} />
      )}

      {/* BÖLÜMLER */}
      {!result && !exam && (reviewing || (a.status !== "COMPLETED" && a.status !== "SECTIONS_DONE" &&
        a.status !== "EXAM_FAILED")) && (
          <div>
            {viewIndex >= 0 && sections[viewIndex] && (
              <div className="card p-3 sm:p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="text-[13px] font-bold text-slate-900">
                    Section {viewIndex + 1}: {sections[viewIndex].title}
                  </div>
                  {viewDone && (
                    <span className="text-[9.5px] font-bold uppercase tracking-[0.04em] px-2 py-1 rounded bg-emerald-50 text-emerald-700 shrink-0">
                      Completed
                    </span>
                  )}
                  {isViewingCurrent && canComplete && (
                    <button
                      onClick={completeCurrent}
                      disabled={busy}
                      className="btn-primary text-xs py-1.5 px-3 shrink-0 disabled:opacity-40"
                    >
                      {busy ? "Saving…" : "Complete this section →"}
                    </button>
                  )}
                </div>
                {/* Bir bölümde birden fazla materyal varsa TEK TEK gösteriliyor:
                    hepsini alt alta basmak hangisinin bitip hangisinin
                    beklediğini belirsiz kılıyordu. Bitmiş olana geri dönülebilir,
                    sıradakine ancak bir öncekini bitirince geçilir. */}
                {viewContents.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5 mb-3">
                    {viewContents.map((c, i) => {
                      const isDone = !!consumed[c.id];
                      const reachable = i <= firstOpenItem;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={!reachable}
                          onClick={() => setItemIndex(i)}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition ${
                            i === itemAt
                              ? "border-brand-500 ring-2 ring-brand-500/15 text-slate-900"
                              : isDone
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : reachable
                              ? "border-slate-200 text-slate-500 hover:border-slate-400"
                              : "border-slate-100 text-slate-300 cursor-not-allowed"
                          }`}
                          title={reachable ? c.fileName : "Finish the previous item first"}
                        >
                          {isDone ? "✓ " : !reachable ? "🔒 " : ""}
                          {i + 1}/{viewContents.length}
                        </button>
                      );
                    })}
                    <span className="text-[11px] text-slate-400 ml-1">
                      {viewContents.filter((c) => consumed[c.id]).length} of {viewContents.length}{" "}
                      finished
                    </span>
                  </div>
                )}

                <div className="space-y-4">
                  {viewContents[itemAt] && (
                    <ContentViewer
                      key={viewContents[itemAt].id}
                      item={viewContents[itemAt]}
                      done={!!consumed[viewContents[itemAt].id]}
                      onDone={() => markConsumed(viewContents[itemAt].id)}
                      assignmentId={id}
                    />
                  )}
                  {viewContents.length === 0 && (
                    <p className="text-sm text-slate-400">No content in this section.</p>
                  )}
                </div>

                {/* Sıradakine geçiş: bu materyal bitince beliriyor. */}
                {itemAt < viewContents.length - 1 && consumed[viewContents[itemAt]?.id ?? ""] && (
                  <button
                    onClick={() => setItemIndex(itemAt + 1)}
                    className="btn-secondary text-xs py-2 mt-3"
                  >
                    Next item ({itemAt + 2}/{viewContents.length}) →
                  </button>
                )}

                {/* Tamamlama düğmesi yalnızca sıradaki bölümde. Sunucu da
                    sırayı zorunlu tutuyor; başka bölümde düğme göstermek
                    tıklandığında hata verirdi. */}
                {isViewingCurrent ? (
                  <>
                    {!canComplete && viewContents.length > 0 && (
                      <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
                        <p className="text-[13px] font-semibold text-amber-900">
                          Go through the material, then press “Complete this section”.
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
                      {busy ? "Saving…" : "Complete this section →"}
                    </button>
                  </>
                ) : viewDone ? (
                  <button
                    onClick={() => setSelected(null)}
                    className="btn-secondary text-xs py-2 mt-4"
                  >
                    {currentIndex < 0
                      ? a.status === "COMPLETED"
                        ? "Back →"
                        : "Back to exam →"
                      : `Back to section ${currentIndex + 1} →`}
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
            {/* Ekranın altında yüzen çubuk. Düğme uzun PDF'in altında kalıyordu,
                öğrenci kaydırmadan göremiyordu. Materyal bitene kadar ne
                kaldığını söyler; bitince "Complete this section" olur. */}
            {isViewingCurrent && viewContents.length > 0 && (
              <>
                <div className="h-20" aria-hidden />
                <div className="fixed z-40 left-1/2 -translate-x-1/2 lg:left-[calc(50%+116px)] bottom-[calc(env(safe-area-inset-bottom)+1rem)] max-lg:bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] w-[min(560px,calc(100vw-2rem))] no-print">
                  {canComplete ? (
                    <div className="flex items-center gap-3 rounded-2xl bg-brand-600 text-white pl-4 pr-2 py-2 shadow-[0_12px_32px_rgba(24,40,75,.35)] animate-[app-land_.35s_ease-out]">
                      <span className="flex-1 min-w-0 text-[13px] leading-snug">
                        <b className="font-semibold">Material finished.</b>{" "}
                        <span className="text-white/75">Complete the section to continue.</span>
                      </span>
                      <button
                        onClick={completeCurrent}
                        disabled={busy}
                        className="shrink-0 rounded-xl bg-white text-brand-700 font-semibold text-[13px] px-4 py-2 hover:bg-brand-50 disabled:opacity-60"
                      >
                        {busy ? "Saving…" : "Complete this section →"}
                      </button>
                    </div>
                  ) : itemAt < viewContents.length - 1 && consumed[viewContents[itemAt]?.id ?? ""] ? (
                    <div className="flex items-center gap-3 rounded-2xl bg-white/95 backdrop-blur border border-slate-200 pl-4 pr-2 py-2 shadow-[0_12px_32px_rgba(15,23,42,.12)]">
                      <span className="flex-1 min-w-0 text-[13px] text-slate-700">
                        Item {itemAt + 1} of {viewContents.length} finished.
                      </span>
                      <button onClick={() => setItemIndex(itemAt + 1)} className="btn-primary text-[13px] px-4 py-2 shrink-0">
                        Next item →
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 rounded-2xl bg-white/95 backdrop-blur border border-slate-200 px-4 py-2.5 shadow-[0_12px_32px_rgba(15,23,42,.12)] text-[12.5px] text-slate-600">
                      <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" aria-hidden />
                      <span className="leading-snug">
                        Go through the material to the end
                        {viewContents.length > 1
                          ? ` (${remaining.length} of ${viewContents.length} items left)`
                          : ""}{" "}
                        — then you can complete this section.
                      </span>
                    </div>
                  )}
                </div>
              </>
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
      </>
      )}

      {/* Sertifika uygulamadan çıkmadan burada açılıyor. Eskiden
          "View My Certificate" listeye atıyordu ve kişi kendi belgesini
          listede tekrar aramak zorunda kalıyordu. */}
      {certOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 overflow-auto p-3 sm:p-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCertOpen(false);
          }}
        >
          <div className="mx-auto w-full max-w-5xl">
            <div className="flex items-center justify-between gap-3 mb-3 no-print">
              <span className="text-[13px] font-semibold text-white truncate">
                {myCert ? `Certificate ${myCert.serialNo ?? ""}` : "Certificate"}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => myCert && printCertificate(myCert)}
                  disabled={!myCert}
                  className="btn-primary text-xs py-2 disabled:opacity-40"
                >
                  Print / Download
                </button>
                <button
                  onClick={() => setCertOpen(false)}
                  className="btn-secondary text-xs py-2"
                >
                  Close
                </button>
              </div>
            </div>

            {myCert ? (
              <div className="overflow-x-auto">
                <div className="rounded-xl overflow-hidden shadow-2xl min-w-[640px] lg:min-w-0">
                  <CertificateSheet cert={myCert} />
                </div>
              </div>
            ) : (
              <div className="card p-8 text-center text-sm text-slate-500">
                {certErr ?? "Preparing your certificate…"}
              </div>
            )}
          </div>
        </div>
      )}
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
/** Küçük dönen gösterge — işlem sürerken ekranın donmadığını söyler. */
function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin text-brand-600" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Sol panel — "C, gruplu liste" tasarımı (CAPELLA/ilerleme-tasarimlari.html):
 * iPhone Ayarlar gibi gri zemin üstünde beyaz gruplar. Üstte her adım için
 * ayrı bir çubuk parçası; her satırda simge kutusu, başlık ve durum satırı.
 * Bitmiş bölüm ve sınav satırı tıklanınca açılır; sınav sürerken bölümler
 * kilitli (cevaplar ve süre sınav ekranında).
 */
function ProgressRail({
  sections,
  done,
  currentIndex,
  viewIndex,
  examRequired,
  status,
  examActive,
  examScore,
  onSelect,
}: {
  sections: Section[];
  done: Set<string>;
  currentIndex: number;
  /** Ekranda gösterilen bölüm — seçili satır bu. */
  viewIndex: number;
  examRequired: boolean;
  status: string;
  /** Sınav sürüyor: bölüme geçilmez (cevaplar ve süre sınav ekranında). */
  examActive: boolean;
  examScore?: number | null;
  onSelect: (sectionId: string | null) => void;
}) {
  /** Telefonda liste kapalı başlar; masaüstünde bu durum kullanılmıyor. */
  const [open, setOpen] = useState(false);
  const passed = status === "COMPLETED" || status === "EXAM_PASSED";
  const examOpen = status === "SECTIONS_DONE" || status === "EXAM_FAILED";
  const total = sections.length + (examRequired ? 1 : 0);
  const doneCount = done.size + (passed && examRequired ? 1 : 0);

  type Kind = "done" | "current" | "todo";
  const icon = (kind: Kind, label: string) => (
    <span
      className={`h-6 w-6 rounded-[7px] grid place-items-center text-[11px] font-bold text-white shrink-0 ${
        kind === "done" ? "bg-[#30b15a]" : kind === "current" ? "bg-brand-600" : "bg-[#c7c7cc]"
      }`}
      aria-hidden="true"
    >
      {label}
    </span>
  );
  const row = (opts: {
    key: string;
    kind: Kind;
    label: string;
    title: string;
    sub: string;
    active: boolean;
    disabled: boolean;
    onClick: () => void;
    hint?: string;
  }) => (
    <button
      key={opts.key}
      type="button"
      disabled={opts.disabled}
      onClick={() => {
        opts.onClick();
        setOpen(false);
      }}
      title={opts.hint ?? opts.title}
      className={`group relative w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition disabled:cursor-default ${
        opts.active ? "bg-[#fdeeee]" : "hover:bg-[#f8f8fa] disabled:hover:bg-transparent"
      } [&+&]:before:content-[''] [&+&]:before:absolute [&+&]:before:left-[46px] [&+&]:before:right-0 [&+&]:before:top-0 [&+&]:before:h-px [&+&]:before:bg-[#e5e5ea]`}
    >
      {icon(opts.kind, opts.label)}
      <span className="flex-1 min-w-0">
        <span
          // Ad tam görünür, gerekirse alt satıra iner (kesilmesin — CAPELLA isteği).
          className={`block text-[13px] leading-snug break-words ${
            opts.kind === "todo" && !opts.active ? "text-[#8e8e93]" : "text-slate-900"
          } ${opts.active ? "font-semibold" : "font-medium"}`}
        >
          {opts.title}
        </span>
        <span
          className={`block text-[11.5px] ${
            opts.kind === "current" ? "text-brand-600 font-medium" : "text-[#86868b]"
          }`}
        >
          {opts.sub}
        </span>
      </span>
      {!opts.disabled && <span className="text-[#c7c7cc] text-[15px] shrink-0">›</span>}
    </button>
  );

  const examKind: Kind = passed ? "done" : examOpen ? "current" : "todo";
  const examSub = passed
    ? examScore != null
      ? `Passed · ${examScore}%`
      : "Passed"
    : status === "EXAM_FAILED"
    ? "Retake available"
    : examOpen
    ? "Ready to start"
    : "After all sections";

  return (
    <div className="rounded-2xl bg-[#f2f2f7] p-3 lg:sticky lg:top-[72px]">
      <div className="flex items-baseline justify-between px-1.5 pb-2">
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">Progress</span>
        <span className={`text-[12px] ${doneCount === total && total > 0 ? "text-[#30b15a] font-semibold" : "text-[#86868b]"}`}>
          {doneCount} of {total}
        </span>
      </div>
      {/* Her adım için bir parça: hangi adımda olunduğu tek bakışta. */}
      <div className="flex gap-1 px-1.5 pb-3">
        {sections.map((s, i) => (
          <span
            key={s.id}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              done.has(s.id) ? "bg-[#30b15a]" : i === currentIndex ? "bg-brand-600" : "bg-[#d1d1d6]"
            }`}
          />
        ))}
        {examRequired && (
          <span
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              passed ? "bg-[#30b15a]" : examOpen ? "bg-brand-600" : "bg-[#d1d1d6]"
            }`}
          />
        )}
      </div>

      {/* Telefonda liste içeriğin ÜSTÜNE yığılıyor: bütün listeyi geçmeden
          eğitime ulaşılamıyordu. Kapalı başlar; çubuk üstte görünmeye devam eder. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="lg:hidden w-full flex items-center justify-between rounded-xl bg-white px-3 py-2.5 text-[13px] font-medium text-slate-800"
      >
        <span className="text-left leading-snug">
          {viewIndex >= 0 ? sections[viewIndex]?.title : "Exam"}
          <span className="ml-1.5 text-[#86868b] font-normal">
            {viewIndex >= 0 ? viewIndex + 1 : total}/{total}
          </span>
        </span>
        <span className={`text-[#c7c7cc] transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>

      <div className={open ? "mt-3" : "hidden lg:block"}>
        <div className="text-[11px] uppercase tracking-[0.04em] text-[#86868b] px-2.5 pb-1.5">Sections</div>
        <div className="rounded-xl bg-white overflow-hidden">
          {sections.map((s, i) => {
            const isDone = done.has(s.id);
            const isCurrent = i === currentIndex;
            return row({
              key: s.id,
              kind: isDone ? "done" : isCurrent ? "current" : "todo",
              label: isDone ? "✓" : String(i + 1),
              title: s.title,
              sub: isDone ? "Completed" : isCurrent ? "In progress" : "Not started",
              active: i === viewIndex,
              disabled: examActive,
              hint: examActive ? "Finish the exam first" : undefined,
              onClick: () => onSelect(isCurrent ? null : s.id),
            });
          })}
        </div>

        {examRequired && (
          <>
            <div className="text-[11px] uppercase tracking-[0.04em] text-[#86868b] px-2.5 pt-3.5 pb-1.5">
              Assessment
            </div>
            <div className="rounded-xl bg-white overflow-hidden">
              {row({
                key: "exam",
                kind: examKind,
                label: examKind === "done" ? "✓" : "★",
                title: "Exam",
                sub: examSub,
                active: (examOpen || passed) && viewIndex < 0,
                disabled: !examOpen && !passed,
                onClick: () => onSelect(null),
              })}
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
        <ScormContent item={item} onDone={onDone} assignmentId={assignmentId} />
      )}
    </div>
  );
}

/** SCORM, kursa özel erişim anahtarı alındıktan sonra açılır. */
function ScormContent({
  item,
  onDone,
  assignmentId,
}: {
  item: Extract<Content, { type: "SCORM" }>;
  onDone: () => void;
  assignmentId?: string;
}) {
  const { src, err } = useScormSrc(SCORM_SERVE_BASE, item.basePath, item.entryPoint);
  if (err) return <p className="text-sm text-red-600">Content could not be opened: {err}</p>;
  if (!src) return <p className="text-sm text-slate-400">Loading…</p>;
  return (
    <ScormPlayer
      src={src}
      fileName={item.fileName}
      onDone={onDone}
      assignmentId={assignmentId}
      contentId={item.id}
    />
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
