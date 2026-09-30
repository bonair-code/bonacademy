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
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  /**
   * Geçmişten gelen kayıtların dijital kopyası yok — aslı personel dosyasında
   * duruyor. Belgeyi zorunlu tutmak bu kayıtların hiç girilememesine yol
   * açıyordu; işaretlenirse belge istenmez, kayıt kâğıt olarak etiketlenir.
   */
  const [paperOnly, setPaperOnly] = useState(!!existing?.paperOnly);
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

  return (
    <form onSubmit={submit}>
      {course ? (
        <p className="text-[11px] text-slate-500 mb-3 rounded-md bg-slate-50 border border-slate-200 px-2.5 py-2">
          This record counts as <b className="text-slate-700">{course.title}</b> — once saved,{" "}
          {user.name} is no longer shown as missing it.
        </p>
      ) : (
        <div className="mb-3">
          <label className="label">Counts As (internal course)</label>
          <select
            className="input"
            value={courseId}
            onChange={(e) => {
              const id = e.target.value;
              setCourseId(id);
              const c = courses.find((x) => x.id === id);
              if (c) {
                if (!title.trim()) setTitle(c.title);
                // Geçerliliği kursun kendi periyodundan öner.
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
          <p
            className={`text-[10px] mt-1 ${
              courseId ? "text-emerald-700" : "text-amber-700 font-medium"
            }`}
          >
            {courseId
              ? `Counts as this course — ${user.name} will no longer be shown as missing it.`
              : "Not linked to a course — it will be stored but will not close any training gap."}
          </p>
        </div>
      )}

      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400 mb-2">
        Training
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="label">Training Name</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. B737 MAX Type Training"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Training Provider</label>
          <input
            className="input"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="e.g. Turkish Technic, Boeing"
          />
        </div>

        <div className="sm:col-span-2 border-t border-slate-100 pt-3 -mb-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
            Dates
          </p>
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

        {/* Geçerlilik TEK kontrol. Eskiden "Valid Until" ile "Or fill it from
            a period" aynı değeri iki ayrı yerden dolduruyordu ve hangisinin
            kazandığı belli değildi. */}
        <div className="sm:col-span-2">
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
          {validity === "CUSTOM" ? (
            <input
              className="input mt-2"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          ) : (
            <p className="text-[10px] text-slate-400 mt-1">
              {validity === "NONE"
                ? "No expiry tracked for this record."
                : validUntil
                ? `Expires ${validUntil.split("-").reverse().join(".")} — counted from the completion date.`
                : "Enter the completion date and the expiry is worked out from it."}
            </p>
          )}
        </div>

        <div className="sm:col-span-2 border-t border-slate-100 pt-3 -mb-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
            Document
          </p>
        </div>

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
          <label className="label">
            Certificate Document{editing || paperOnly ? "" : " *"}
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            disabled={paperOnly}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold hover:file:bg-slate-200 disabled:opacity-40"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            {paperOnly
              ? "No digital copy — the original stays in the personnel file."
              : file
              ? file.name
              : editing
              ? "Keeping the current file — pick one to replace it."
              : "PDF or image — required."}
          </p>
          <label className="flex items-center gap-2 mt-2 text-[11px] text-slate-600 cursor-pointer">
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
        </div>

        <div className="sm:col-span-2">
          <label className="label">Notes</label>
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="optional"
          />
        </div>
      </div>

      {/* Alt şerit pencerenin dibine yapışır: form ne kadar uzarsa uzasın
          Kaydet hep aynı yerde. Negatif kenar boşlukları Modal'ın iç
          dolgusunu aşıp şeridi tam genişliğe yayar. */}
      <div className="-mx-[18px] -mb-[18px] mt-5 px-[18px] py-3 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2.5">
        {err ? (
          <span className="text-[11.5px] text-brand-700 mr-auto">{err}</span>
        ) : (
          <span className="text-[11.5px] text-slate-400 mr-auto">
            {canSubmit
              ? "Ready to save."
              : editing
              ? "Fill in the training name, provider and date."
              : "Training name, provider, date and a document are required."}
          </span>
        )}
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !canSubmit}
          className="btn-primary text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "Saving…" : "Save Record"}
        </button>
      </div>
    </form>
  );
}
