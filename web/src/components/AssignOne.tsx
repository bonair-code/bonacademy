/**
 * Tek kişiye, belli eğitim(ler)i atama penceresi.
 *
 * Assignments sayfasındaki `AssignForm` toplu ve iki yönlü: hem kişi hem
 * eğitim seçtiriyor. Matriste ikisi de zaten belli — hücre kimi ve neyi
 * söylüyor. Kalan tek karar son teslim süresi.
 */
import { useState } from "react";
import { assignCourses, skipNote } from "../lib/assign";

const PRESETS = [7, 14, 30, 60, 90];

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
  const [dueDays, setDueDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const due = new Date(Date.now() + dueDays * 86400000);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await assignCourses(userId, courseIds, dueDays);
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

      <label className="label">Due in</label>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDueDays(d)}
            className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition ${
              dueDays === d
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
            }`}
          >
            {d} days
          </button>
        ))}
      </div>
      <p className="text-[11.5px] text-slate-500 mt-2">
        Due date: <b className="text-slate-800">{due.toLocaleDateString("tr-TR")}</b>
      </p>

      <div className="-mx-[18px] -mb-[18px] mt-5 px-[18px] py-3 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2.5">
        {err ? (
          <span className="text-[11.5px] text-brand-700 mr-auto">{err}</span>
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
