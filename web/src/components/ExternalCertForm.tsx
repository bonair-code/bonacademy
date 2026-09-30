import { useRef, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { db, functions, storage } from "../lib/firebase";
import { useAuth } from "../lib/auth";

export type RecurUnit = "NONE" | "DAY" | "MONTH" | "YEAR";

export function addValidity(base: Date, every: number | null, unit: RecurUnit): Date | null {
  if (!every || unit === "NONE") return null;
  const d = new Date(base);
  if (unit === "DAY") d.setDate(d.getDate() + every);
  else if (unit === "MONTH") d.setMonth(d.getMonth() + every);
  else if (unit === "YEAR") d.setFullYear(d.getFullYear() + every);
  else return null;
  return d;
}

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

  // Belge yalnızca YENİ kayıtta zorunlu; düzenlerken mevcut dosya korunur.
  const canSubmit =
    !!title.trim() && !!provider.trim() && !!completed && (editing || paperOnly || !!file);

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
      let fileFields: Record<string, unknown> = {};
      if (file) {
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `externalCertificates/${user.id}/${Date.now()}-${safeName}`;
        const snap = await uploadBytes(storageRef(storage, path), file);
        fileFields = {
          fileName: file.name,
          filePath: path,
          fileUrl: await getDownloadURL(snap.ref),
        };
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
    if (f) setFile(f);
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
            onClick={() => !paperOnly && fileRef.current?.click()}
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
              <>
                <p className="text-[13px] font-semibold text-slate-900">{file.name}</p>
                <p className="text-[11.5px] text-slate-500 mt-0.5">
                  {(file.size / 1024 / 1024).toFixed(1)} MB · click to replace
                </p>
              </>
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
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />

          <label className="flex items-center gap-2 text-[12px] text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={paperOnly}
              onChange={(e) => {
                setPaperOnly(e.target.checked);
                if (e.target.checked) {
                  setFile(null);
                  if (fileRef.current) fileRef.current.value = "";
                }
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
        {err && <span className="text-[11.5px] text-brand-700 mr-auto">{err}</span>}
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
              {busy ? "Saving…" : "Save Record"}
            </button>
          </>
        )}
      </div>
    </form>
  );
}