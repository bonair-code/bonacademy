import { useEffect, useRef, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
  type UploadTask,
} from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { db, functions, storage } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { addValidity } from "../lib/records";

export type RecurUnit = "NONE" | "DAY" | "MONTH" | "YEAR";

/**
 * Dış eğitim kaydı — kişinin eksik bir eğitimi için. Kurs ve personel dışarıdan
 * verilir; form yalnızca belgeyi ve tarihleri sorar.
 */
type CourseLite = {
  id: string;
  title: string;
  recurrenceEvery?: number | null;
  recurrenceUnit?: string;
  /** Metodlara bölünmüş eğitimlerde (ör. NDT) metod listesi. */
  methods?: string[];
};

/** Düzenlenebilmesi için mevcut kaydın alanları. */
export type ExternalRecord = {
  id: string;
  courseId: string | null;
  title: string;
  provider: string;
  completedAt?: { toDate?: () => Date } | null;
  expiresAt?: { toDate?: () => Date } | null;
  durationHours?: number | null;
  externalSerialNo?: string | null;
  notes?: string | null;
  /** Metod bazlı eğitimde bu kaydın hangi metoda ait olduğu. */
  method?: string | null;
  fileName?: string;
  fileUrl?: string;
  /** Aslı kâğıtta; dijital kopya yok. Belge zorunluluğunu kaldırır. */
  paperOnly?: boolean;
};

const iso = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** Geçerlilik seçenekleri — kâğıt sertifikalarda görülen süreler. */
type ValidityKey = "NONE" | "Y1" | "Y2" | "Y5" | "CUSTOM";
const VALIDITY_CHOICES: { key: ValidityKey; label: string }[] = [
  { key: "NONE", label: "No expiry" },
  { key: "Y1", label: "1 year" },
  { key: "Y2", label: "2 years" },
  { key: "Y5", label: "5 years" },
  { key: "CUSTOM", label: "Pick date" },
];
const YEARS_OF: Record<ValidityKey, number | null> = {
  NONE: null, Y1: 1, Y2: 2, Y5: 5, CUSTOM: null,
};

/** Kursun tekrar periyodu hangi seçeneğe denk geliyor. */
function validityFromCourse(c?: { recurrenceEvery?: number | null; recurrenceUnit?: string } | null): ValidityKey {
  const u = (c?.recurrenceUnit as RecurUnit) ?? "NONE";
  if (u === "NONE") return "NONE";
  if (u !== "YEAR") return "CUSTOM";
  const n = c?.recurrenceEvery ?? 0;
  return n === 1 ? "Y1" : n === 2 ? "Y2" : n === 5 ? "Y5" : "CUSTOM";
}

export function ExternalCertForm({
  user,
  course,
  courses,
  existing,
  onDone,
  onCancel,
}: {
  user: { id: string; name: string; departmentId: string | null };
  /** Önceden seçilmiş kurs (eksik satırdan gelindiğinde). null ise kullanıcı seçer. */
  course: CourseLite | null;
  /** Seçilebilecek kurslar — kurs bağlanmazsa kayıt hiçbir ekranda sayılmaz. */
  courses: CourseLite[];
  /** Verilirse düzenleme kipi: belge zorunlu değil, kayıt güncellenir. */
  existing?: ExternalRecord | null;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const { profile } = useAuth();
  const editing = !!existing;
  // Kurs önceden geldiyse sabit; gelmediyse kullanıcı seçer.
  const [courseId, setCourseId] = useState(existing?.courseId ?? course?.id ?? "");
  const picked = courses.find((c) => c.id === courseId) ?? course ?? null;
  const [title, setTitle] = useState(existing?.title ?? course?.title ?? "");
  const [provider, setProvider] = useState(existing?.provider ?? "");
  const [completed, setCompleted] = useState(iso(existing?.completedAt?.toDate?.()));
  const [durationHours, setDurationHours] = useState(
    existing?.durationHours != null ? String(existing.durationHours) : ""
  );
  /**
   * Geçerlilik tarihi doğrudan girilebilir. Dış sertifikada bitiş tarihi
   * belgenin üstünde yazar; kursun tekrar periyodundan türetmek her zaman
   * doğru sonuç vermiyordu. Periyot seçilirse bu alan otomatik dolar,
   * kullanıcı elle değiştirirse bir daha ezilmez.
   */
  const [validUntil, setValidUntil] = useState(iso(existing?.expiresAt?.toDate?.()));
  /**
   * Geçerlilik seçimi. Düzenleme kipinde kayıtlı bir bitiş tarihi varsa
   * "CUSTOM"; yeni kayıtta kursun kendi periyodundan başlar.
   */
  const [validity, setValidity] = useState<ValidityKey>(() => {
    if (existing) return existing.expiresAt ? "CUSTOM" : "NONE";
    return validityFromCourse(course);
  });
  const [serialNo, setSerialNo] = useState(existing?.externalSerialNo ?? "");
  const [method, setMethod] = useState(existing?.method ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  /**
   * Geçmişten gelen kayıtların dijital kopyası yok — aslı personel dosyasında
   * duruyor. Belgeyi zorunlu tutmak bu kayıtların hiç girilememesine yol
   * açıyordu; işaretlenirse belge istenmez, kayıt kâğıt olarak etiketlenir.
   */
  const [paperOnly, setPaperOnly] = useState(!!existing?.paperOnly);
  const [step, setStep] = useState<1 | 2>(1);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Belge SEÇİLİR SEÇİLMEZ yüklenir; kullanıcı alanları doldururken dosya
   * arkada gider ve "Save Record" anında tamamlanır. Eskiden yükleme
   * kaydetme anında başlıyordu ve büyük dosyada kullanıcı düğmeye bakarak
   * bekliyordu.
   *
   * `uploadBytes` hiçbir ilerleme olayı yaymıyor; yüzde göstermek için
   * `uploadBytesResumable` şart — iptal de onunla mümkün.
   */
  const [pct, setPct] = useState<number | null>(null);
  const [uploaded, setUploaded] = useState<{ path: string; url: string } | null>(null);
  const taskRef = useRef<UploadTask | null>(null);
  /** Kayıt gerçekten yazıldıysa yüklenen dosya ARTIK öksüz değil. */
  const savedRef = useRef(false);

  /**
   * Pencere kaydedilmeden kapanırsa yüklenen dosya Storage'da öksüz kalır.
   * Süren yükleme iptal edilir (parça kalmaz); tamamlanmışsa silinmeye
   * çalışılır. Silme kurallarda YALNIZCA admin'e açık — müdürde sessizce
   * başarısız olur ve dosya kalır. Zararsız (hiçbir kayıt göstermiyor,
   * okuması kısıtlı) ama temizlik gerekir; bkz. docs/BACKLOG.md.
   */
  /** Temizlik efekti bağımlılıksız çalışır; güncel değeri ref'ten okur. */
  const uploadedRef = useRef<{ path: string; url: string } | null>(null);
  uploadedRef.current = uploaded;

  useEffect(() => {
    return () => {
      taskRef.current?.cancel();
      const up = uploadedRef.current;
      if (up && !savedRef.current) {
        deleteObject(storageRef(storage, up.path)).catch(() => undefined);
      }
    };
  }, []);

  /** Dosyayı hemen yüklemeye başlar. */
  function beginUpload(f: File) {
    setErr(null);
    /**
     * Kurallar 20 MB ve PDF/PNG/JPEG/WEBP sınırını zaten koyuyor, ama orada
     * reddedilince kullanıcı boşuna bekleyip ham bir yetki hatası görüyor.
     * Baştan söylemek hem hızlı hem anlaşılır.
     */
    if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(f.type)) {
      setErr("Only PDF, PNG, JPEG or WEBP files can be uploaded.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (f.size >= 20 * 1024 * 1024) {
      setErr(`That file is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is 20 MB.`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFile(f);
    setPct(0);
    setUploaded(null);
    const safeName = f.name.replace(/[^\w.\-]+/g, "_");
    const path = `externalCertificates/${user.id}/${Date.now()}-${safeName}`;
    const task = uploadBytesResumable(storageRef(storage, path), f);
    taskRef.current = task;
    task.on(
      "state_changed",
      (snap) => setPct(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (e) => {
        taskRef.current = null;
        setPct(null);
        // İptal kullanıcının kendi eylemi — hata gibi gösterilmez.
        if ((e as { code?: string }).code !== "storage/canceled") {
          setErr(`Upload failed: ${e.message}`);
          setFile(null);
          // Girdi sıfırlanmazsa AYNI dosya tekrar seçilince onChange hiç
          // tetiklenmiyor ve kullanıcı yeniden deneyemiyor.
          if (fileRef.current) fileRef.current.value = "";
        }
      },
      async () => {
        taskRef.current = null;
        try {
          setUploaded({ path, url: await getDownloadURL(task.snapshot.ref) });
          setPct(100);
        } catch (e) {
          setErr(`Uploaded, but the address could not be read: ${(e as Error).message}`);
          setPct(null);
        }
      }
    );
  }

  /** Süren yüklemeyi iptal eder ya da yükleneni kaldırır. */
  function clearFile() {
    taskRef.current?.cancel();
    taskRef.current = null;
    if (uploaded) deleteObject(storageRef(storage, uploaded.path)).catch(() => undefined);
    setUploaded(null);
    setPct(null);
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const uploading = pct !== null && !uploaded;

  // Belge yalnızca YENİ kayıtta zorunlu; düzenlerken mevcut dosya korunur.
  // Yükleme sürerken kaydedilemez: dosyanın adresi henüz yok.
  const canSubmit =
    !!title.trim() &&
    !!provider.trim() &&
    !!completed &&
    !uploading &&
    (editing || paperOnly || !!file);

  /** Seçilen geçerliliği alınma tarihine uygular. */
  function applyValidity(key: ValidityKey, fromDate = completed) {
    setValidity(key);
    if (key === "CUSTOM") return; // tarihi kullanıcı girer
    const years = YEARS_OF[key];
    setValidUntil(
      years && fromDate ? iso(addValidity(new Date(fromDate), years, "YEAR")) : ""
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !profile) return;
    setBusy(true);
    setErr(null);
    try {
      const completedDate = new Date(completed);
      // Belge seçildiyse önce yüklenir; belgesiz YENİ kayıt oluşmasın.
      // Dosya seçildiği anda yüklendi; burada yalnızca adresi yazılıyor.
      let fileFields: Record<string, unknown> = {};
      if (file && uploaded) {
        fileFields = { fileName: file.name, filePath: uploaded.path, fileUrl: uploaded.url };
      }
      const expiry = validUntil ? new Date(validUntil) : null;

      const payload = {
        userId: user.id,
        userName: user.name,
        userDepartmentId: user.departmentId ?? null,
        title: title.trim(),
        provider: provider.trim(),
        courseId: picked?.id ?? null,
        courseTitle: picked?.title ?? null,
        completedAt: Timestamp.fromDate(completedDate),
        durationHours: durationHours ? Number(durationHours) : null,
        expiresAt: expiry ? Timestamp.fromDate(expiry) : null,
        externalSerialNo: serialNo.trim() || null,
        method: method || null,
        notes: notes.trim() || null,
        paperOnly,
        ...fileFields,
      };

      if (existing) {
        await updateDoc(doc(db, "externalTrainings", existing.id), {
          ...payload,
          updatedById: profile.uid,
          updatedAt: serverTimestamp(),
        });
        savedRef.current = true;
        onDone(`${title.trim()} updated.`);
        return;
      }

      const docRef = await addDoc(collection(db, "externalTrainings"), {
        ...payload,
        createdById: profile.uid,
        createdAt: serverTimestamp(),
      });
      // Kursa bağlıysa aynı kursun açık atamasını kapat — kişi zaten aldı.
      let closed = false;
      if (picked) {
        try {
          const res = await httpsCallable(functions, "closeAssignmentExternally")({
            userId: user.id,
            courseId: picked.id,
            externalTrainingId: docRef.id,
          });
          closed = !!(res.data as { closed?: boolean })?.closed;
        } catch {
          // Atama kapatılamazsa kayıt yine de geçerli; sessizce geç.
        }
      }
      savedRef.current = true;
      onDone(
        `${title.trim()} recorded for ${user.name}${closed ? " — assignment closed." : "."}`
      );
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Belge adımında sürükle-bırak. */
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (paperOnly) return;
    const f = e.dataTransfer.files?.[0];
    if (f) beginUpload(f);
  }

  /** Seçili kursun metodları; metod bazlı değilse boş. */
  const methodChoices = picked?.methods ?? [];
  const step1Ready =
    !!title.trim() && !!provider.trim() && !!completed && (methodChoices.length === 0 || !!method);

  return (
    <form onSubmit={submit}>
      {/* Adım göstergesi */}
      <div className="flex gap-1.5 mb-4">
        {[1, 2].map((n) => (
          <span
            key={n}
            className={`h-[3px] flex-1 rounded-full ${step >= n ? "bg-brand-600" : "bg-slate-200"}`}
          />
        ))}
      </div>

      {step === 1 ? (
        <div className="space-y-3.5">
          {/* Kurs önceden seçilmediyse neyin yerine geçeceği sorulmalı —
              bağlanmayan kayıt hiçbir eksiği kapatmaz. */}
          {!course && (
            <div>
              <label className="label">Counts As</label>
              <select
                className="input"
                value={courseId}
                onChange={(e) => {
                  const id = e.target.value;
                  setCourseId(id);
                  const c = courses.find((x) => x.id === id);
                  if (c) {
                    if (!title.trim()) setTitle(c.title);
                    applyValidity(validityFromCourse(c));
                  }
                }}
              >
                <option value="">— None, track separately —</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              {!courseId && (
                <p className="text-[10.5px] text-amber-700 font-medium mt-1">
                  Not linked to a course — it will not close any training gap.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="label">Training Name</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. B737 MAX Type Training"
            />
          </div>

          {/* Metod bazlı eğitimde bu kaydın hangi metoda ait olduğu. Her
              metodun kendi belgesi ve kendi bitiş tarihi var; metod
              yazılmazsa kayıt hiçbir metodu kapatmaz. */}
          {methodChoices.length > 0 && (
            <div>
              <label className="label">Method</label>
              <div className="inline-flex flex-wrap gap-1.5">
                {methodChoices.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg transition ${
                      method === m
                        ? "bg-brand-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="label">Training Provider</label>
            <input
              className="input"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="e.g. Turkish Technic, Boeing"
            />
          </div>

          <div>
            <label className="label">Completion Date</label>
            <input
              className="input"
              type="date"
              value={completed}
              onChange={(e) => {
                setCompleted(e.target.value);
                applyValidity(validity, e.target.value);
              }}
            />
          </div>

          <div>
            <label className="label">Duration (hours)</label>
            <input
              className="input"
              type="number"
              min={0}
              step={0.5}
              value={durationHours}
              onChange={(e) => setDurationHours(e.target.value)}
              placeholder="optional"
            />
          </div>

          <div>
            <label className="label">Validity</label>
            <div className="inline-flex w-full bg-slate-100 rounded-[9px] p-0.5">
              {VALIDITY_CHOICES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => applyValidity(v.key)}
                  className={`flex-1 text-[11.5px] font-semibold px-2 py-1.5 rounded-[7px] transition ${
                    validity === v.key
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            {validity === "CUSTOM" && (
              <input
                className="input mt-2"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3.5">
          {/* Belge: sürükle-bırak ya da seç. */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!paperOnly) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !paperOnly && !file && fileRef.current?.click()}
            className={`rounded-xl border-[1.5px] border-dashed px-4 py-7 text-center transition ${
              paperOnly
                ? "border-slate-200 bg-slate-50 cursor-not-allowed"
                : dragging
                ? "border-brand-500 bg-brand-50/60 cursor-pointer"
                : "border-slate-300 hover:border-slate-400 cursor-pointer"
            }`}
          >
            {paperOnly ? (
              <p className="text-[12.5px] text-slate-400">
                No digital copy — the original stays in the personnel file.
              </p>
            ) : file ? (
              /* Yükleme satırı: dosya seçilir seçilmez başlıyor, ilerleme
                 burada — dosyanın yanında, düğmede değil. */
              <div
                className={`flex items-center gap-3 text-left rounded-lg -m-1 p-2 ${
                  uploaded ? "bg-emerald-50" : ""
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <span
                  className={`shrink-0 grid place-items-center w-[34px] h-[42px] rounded border text-[8.5px] font-bold tracking-wide ${
                    uploaded
                      ? "bg-emerald-100 border-emerald-200 text-emerald-700"
                      : "bg-brand-50 border-brand-100 text-brand-700"
                  }`}
                  aria-hidden
                >
                  {/\.pdf$/i.test(file.name) ? "PDF" : "IMG"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-slate-900 truncate">
                    {file.name}
                  </span>
                  <span className="block text-[11.5px] text-slate-500 mt-0.5">
                    {uploaded ? (
                      <>
                        <b className="text-emerald-700 font-semibold">✓ Uploaded</b> ·{" "}
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </>
                    ) : (
                      <>
                        Uploading… {pct ?? 0}% ·{" "}
                        {(((pct ?? 0) / 100) * (file.size / 1024 / 1024)).toFixed(2)} /{" "}
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </>
                    )}
                  </span>
                  <span
                    className="block h-1 rounded-full bg-slate-200 mt-1.5 overflow-hidden"
                    role="progressbar"
                    aria-valuenow={pct ?? 0}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${file.name} yükleniyor`}
                  >
                    <span
                      className={`block h-full rounded-full transition-[width] duration-150 ${
                        uploaded ? "bg-emerald-600" : "bg-brand-600"
                      }`}
                      style={{ width: `${pct ?? 0}%` }}
                    />
                  </span>
                </span>
                <button
                  type="button"
                  onClick={clearFile}
                  aria-label={uploaded ? "Belgeyi kaldır" : "Yüklemeyi iptal et"}
                  title={uploaded ? "Remove" : "Cancel upload"}
                  className="shrink-0 h-8 w-8 grid place-items-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" className="h-[15px] w-[15px]" aria-hidden>
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <>
                <p className="text-[13px] font-semibold text-slate-900">
                  Drop the certificate here
                </p>
                <p className="text-[11.5px] text-slate-500 mt-0.5">
                  or click to choose a PDF or image
                </p>
                {editing && (
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    Leave empty to keep the current file.
                  </p>
                )}
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) beginUpload(f);
            }}
          />

          <label className="flex items-center gap-2 text-[12px] text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={paperOnly}
              onChange={(e) => {
                setPaperOnly(e.target.checked);
                // Kâğıt işaretlenirse yüklenen/yüklenmekte olan dosya kalkar.
                if (e.target.checked) clearFile();
              }}
              className="rounded border-slate-300"
            />
            Original held on paper — no digital copy
          </label>

          <div>
            <label className="label">Their Certificate No</label>
            <input
              className="input"
              value={serialNo}
              onChange={(e) => setSerialNo(e.target.value)}
              placeholder="optional"
            />
          </div>

          <div>
            <label className="label">Notes</label>
            <input
              className="input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="optional"
            />
          </div>
        </div>
      )}

      {/* Alt şerit pencerenin dibinde; birincil düğme hep sağda. */}
      <div className="-mx-[18px] -mb-[18px] mt-5 px-[18px] py-3 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2.5">
        {err && <span className="text-[11.5px] text-red-700 mr-auto">{err}</span>}
        {!err && <span className="text-[11.5px] text-slate-400 mr-auto">Step {step} of 2</span>}

        {step === 1 ? (
          <>
            <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!step1Ready}
              className="btn-primary text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setStep(1)} className="btn-secondary text-xs py-2">
              ← Back
            </button>
            <button
              type="submit"
              disabled={busy || !canSubmit}
              className="btn-primary text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? "Saving…" : uploading ? "Uploading…" : "Save Record"}
            </button>
          </>
        )}
      </div>
    </form>
  );
}