import { useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import {
  downloadCertTemplate,
  parseCertWorkbook,
  type CertParseResult,
} from "../lib/certExcel";

type ImportResult = {
  total: number;
  imported: number;
  failed: { serialNo: string; error?: string }[];
  unmatchedUser: string[];
  unmatchedCourse: string[];
  nextNo: number | null;
};

/**
 * Geçmiş sertifikaların Excel'den içe aktarımı. Kayıtlar `certificates`
 * koleksiyonuna Function üzerinden yazılır (client'a kapalı) ve numaralandırma
 * sayacı dosyadaki en büyük numaranın devamına çekilir.
 */
export function CertImport({
  courseTitles,
  onClose,
  onDone,
}: {
  courseTitles: string[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [parsed, setParsed] = useState<CertParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    setResult(null);
    setFileName(f.name);
    try {
      setParsed(await parseCertWorkbook(f));
    } catch (e2) {
      setErr(`Could not read the file: ${(e2 as Error).message}`);
      setParsed(null);
    }
  }

  async function run() {
    if (!parsed || parsed.rows.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      // Function tek çağrıda en fazla 500 satır alıyor; büyük dosya parçalanır.
      const acc: ImportResult = {
        total: 0,
        imported: 0,
        failed: [],
        unmatchedUser: [],
        unmatchedCourse: [],
        nextNo: null,
      };
      for (let i = 0; i < parsed.rows.length; i += 400) {
        const chunk = parsed.rows.slice(i, i + 400);
        const res = await httpsCallable(functions, "importCertificates")({ rows: chunk });
        const r = res.data as ImportResult;
        acc.total += r.total;
        acc.imported += r.imported;
        acc.failed.push(...r.failed);
        acc.unmatchedUser.push(...r.unmatchedUser);
        acc.unmatchedCourse.push(...r.unmatchedCourse);
        acc.nextNo = r.nextNo ?? acc.nextNo;
      }
      setResult(acc);
      onDone(`${acc.imported} of ${acc.total} certificate(s) imported.`);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div>
        <div className="text-[13px] mb-3">
          <span className="text-emerald-700 font-semibold">
            {result.imported} of {result.total} imported
          </span>
          {result.failed.length > 0 && (
            <>
              {" · "}
              <span className="text-brand-700 font-semibold">{result.failed.length} failed</span>
            </>
          )}
        </div>

        {result.nextNo && (
          <p className="text-[12px] text-slate-700 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 py-2 mb-3">
            Numbering now continues from <b className="tabular-nums">{result.nextNo}</b>. Check the
            prefix under <b>Numbering</b> if it is not what you expect.
          </p>
        )}

        <Bucket
          title="Not matched to a person"
          note="Stored in the register, but they close nobody's training gap. Fix the name or add an Email column, then re-upload."
          items={result.unmatchedUser}
        />
        <Bucket
          title="Not matched to a training"
          note="The Training Name did not match any course. The record is stored but will not show in Training Follow-Up."
          items={result.unmatchedCourse}
        />
        {result.failed.length > 0 && (
          <Bucket
            title="Failed"
            note="These rows were not written."
            items={result.failed.map((f) => `${f.serialNo || "(no number)"} — ${f.error ?? "error"}`)}
            danger
          />
        )}

        <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
          <button onClick={onClose} className="btn-primary text-xs py-2">
            Close
          </button>
          <button
            onClick={() => {
              setResult(null);
              setParsed(null);
              setFileName("");
              if (fileRef.current) fileRef.current.value = "";
            }}
            className="btn-secondary text-xs py-2"
          >
            Import another file
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[12px] text-slate-600 mb-3">
        Bring the certificates you already issued on paper into the register. Download the
        template, paste your rows, upload it back. New certificates then continue from the highest
        number in the file.
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => downloadCertTemplate(courseTitles)}
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

      {err && <p className="text-xs text-brand-700 mt-3">{err}</p>}

      {parsed && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="text-[12px] text-slate-600 mb-2">
            <b>{fileName}</b> · sheet “{parsed.sheetName}” ·{" "}
            <span className="text-emerald-700 font-semibold">{parsed.rows.length} ready</span>
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
            <ul className="max-h-28 overflow-auto rounded-md bg-brand-50/60 border border-brand-100 p-2 space-y-0.5 mb-3">
              {parsed.errors.map((e, i) => (
                <li key={i} className="text-[11px] text-brand-700">
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}

          {parsed.rows.length > 0 && (
            <div className="max-h-56 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-slate-500">
                    <th className="th !py-1.5">No</th>
                    <th className="th !py-1.5">Name</th>
                    <th className="th !py-1.5">Training</th>
                    <th className="th !py-1.5">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parsed.rows.slice(0, 200).map((r) => (
                    <tr key={r.serialNo}>
                      <td className="px-3 py-1 font-semibold tabular-nums">{r.serialNo}</td>
                      <td className="px-3 py-1">{r.name}</td>
                      <td className="px-3 py-1 text-slate-600">{r.courseTitle || "—"}</td>
                      <td className="px-3 py-1 tabular-nums text-slate-500">
                        {r.issuedAt?.split("-").reverse().join(".")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button
          onClick={run}
          disabled={busy || !parsed || parsed.rows.length === 0}
          className="btn-primary text-xs py-2 disabled:opacity-40"
        >
          {busy ? "Importing…" : `Import ${parsed?.rows.length ?? 0}`}
        </button>
        <button onClick={onClose} disabled={busy} className="btn-secondary text-xs py-2">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Bucket({
  title,
  note,
  items,
  danger,
}: {
  title: string;
  note: string;
  items: string[];
  danger?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="label">
        {title} ({items.length})
      </div>
      <p className="text-[10px] text-slate-500 mb-1">{note}</p>
      <ul
        className={`max-h-28 overflow-auto rounded-md border p-2 space-y-0.5 ${
          danger ? "bg-brand-50/60 border-brand-100" : "bg-amber-50/60 border-amber-200"
        }`}
      >
        {items.map((s, i) => (
          <li key={i} className={`text-[11px] ${danger ? "text-brand-700" : "text-amber-800"}`}>
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}
