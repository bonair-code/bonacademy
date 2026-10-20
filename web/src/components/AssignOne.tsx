/**
 * Tek kişiye, belli eğitim(ler)i atama penceresi.
 *
 * Assignments sayfasındaki `AssignForm` toplu ve iki yönlü: hem kişi hem
 * eğitim seçtiriyor. Matriste ikisi de zaten belli — hücre kimi ve neyi
 * söylüyor. Kalan tek karar son tarih — isteğe bağlı, boşsa son tarih yok.
 */
import { useState } from "react";
import { assignCourses, skipNote } from "../lib/assign";


export function AssignOne({
  userId,
  courseIds,
  lines,
  onDone,
  onCancel,
}: {
  userId: string;
  courseIds: string[];
  /** Pencerede listelenecek eğitim adları. */
  lines: string[];
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);


  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await assignCourses(userId, courseIds, { dueDate });
      if (r.created === 0) {
        // Hiçbir şey açılmadıysa pencereyi kapatıp "atandı" demek yanlış olur.
        setErr(
          r.skipped.length > 0
            ? `Nothing was assigned.${skipNote(r.skipped)}`
            : "Nothing was assigned."
        );
        setBusy(false);
        return;
      }
      onDone(
        `${r.created} training${r.created === 1 ? "" : "s"} assigned.` + skipNote(r.skipped)
      );
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      {lines.length > 1 && (
        <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-auto mb-4">
          {lines.map((t) => (
            <p key={t} className="px-3 py-2 text-[12.5px] text-slate-800">
              {t}
            </p>
          ))}
        </div>
      )}

      <label className="label">Due date (optional)</label>
      <div className="flex items-center gap-2">
        <input
          type="date"
          className="input !w-auto"
          value={dueDate}
          min={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDueDate(e.target.value)}
        />
        {dueDate && (
          <button type="button" onClick={() => setDueDate("")} className="text-[12px] text-slate-500 hover:text-slate-800">
            Clear
          </button>
        )}
      </div>
      <p className="text-[11.5px] text-slate-500 mt-2">
        {dueDate ? "The person sees this date and gets it in the email." : "No due date — leave empty if the training has no deadline."}
      </p>

      <div className="-mx-[18px] -mb-[18px] mt-5 px-[18px] py-3 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2.5">
        {err ? (
          <span className="text-[11.5px] text-red-700 mr-auto">{err}</span>
        ) : (
          <span className="text-[11.5px] text-slate-400 mr-auto">
            {courseIds.length} training{courseIds.length === 1 ? "" : "s"}
          </span>
        )}
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="btn-primary text-xs py-2 disabled:opacity-40"
        >
          {busy ? "Assigning…" : "Assign"}
        </button>
      </div>
    </div>
  );
}
