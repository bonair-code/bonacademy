import { useRef, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { db, functions, storage } from "../lib/firebase";
import { useAuth } from "../lib/auth";

export type RecurUnit = "NONE" | "DAY" | "MONTH" | "YEAR";

const UNIT_LABEL: Record<RecurUnit, string> = {
  NONE: "No expiry",
  DAY: "Day(s)",
  MONTH: "Month(s)",
  YEAR: "Year(s)",
};

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
  // Varsayılan geçerlilik kursun kendi periyodundan gelir; gerekirse değiştirilir.
  const [every, setEvery] = useState(String(course?.recurrenceEvery ?? ""));
  const [unit, setUnit] = useState<RecurUnit>((course?.recurrenceUnit as RecurUnit) ?? "NONE");
  /**
   * Geçerlilik tarihi doğrudan girilebilir. Dış sertifikada bitiş tarihi
   * belgenin üstünde yazar; kursun tekrar periyodundan türetmek her zaman
   * doğru sonuç vermiyordu. Periyot seçilirse bu alan otomatik dolar,
   * kullanıcı elle değiştirirse bir daha ezilmez.
   */
  const [validUntil, setValidUntil] = useState(iso(existing?.expiresAt?.toDate?.()));
  const [touchedValid, setTouchedValid] = useState(!!existing);
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

  /** Periyottan bitiş tarihini türet; kullanıcı elle girdiyse dokunma. */
  function autoValid(nextCompleted: string, nextEvery: string, nextUnit: RecurUnit) {
    if (touchedValid) return;
    const d =
      nextCompleted && nextUnit !== "NONE" && Number(nextEvery) > 0
        ? addValidity(new Date(nextCompleted), Number(nextEvery), nextUnit)
        : null;
    setValidUntil(iso(d));
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
                setUnit((c.recurrenceUnit as RecurUnit) ?? "NONE");
                setEvery(String(c.recurrenceEvery ?? ""));
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

        <div>
          <label className="label">Completion Date</label>
          <input
            className="input"
            type="date"
            value={completed}
            onChange={(e) => {
              setCompleted(e.target.value);
              autoValid(e.target.value, every, unit);
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
          <label className="label">Valid Until</label>
          <input
            className="input"
            type="date"
            value={validUntil}
            onChange={(e) => {
              setValidUntil(e.target.value);
              setTouchedValid(true);
            }}
          />
          <p className="text-[10px] text-slate-400 mt-1">
            {validUntil ? "Taken from the certificate." : "Blank = no expiry tracked."}
          </p>
        </div>
        <div>
          <label className="label">Or fill it from a period</label>
          <div className="flex gap-2">
            <input
              className="input w-20"
              type="number"
              min={1}
              value={unit === "NONE" ? "" : every}
              disabled={unit === "NONE"}
              onChange={(e) => {
                setEvery(e.target.value);
                setTouchedValid(false);
                autoValid(completed, e.target.value, unit);
              }}
              aria-label="Valid for"
            />
            <select
              className="input flex-1"
              value={unit}
              onChange={(e) => {
                const u = e.target.value as RecurUnit;
                const ev = u !== "NONE" && !every ? "1" : every;
                setUnit(u);
                setEvery(ev);
                setTouchedValid(false);
                autoValid(completed, ev, u);
              }}
            >
              {(Object.keys(UNIT_LABEL) as RecurUnit[]).map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u]}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            Fills the date on the left — you can still change it.
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

      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button type="submit" disabled={busy || !canSubmit} className="btn-primary text-xs py-2">
          {busy ? "Saving…" : "Save Record"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-brand-700">{err}</span>}
      </div>
    </form>
  );
}
