import { useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import {
  downloadUserTemplate,
  parseUserWorkbook,
  type ParseResult,
  type ParsedUser,
  type Ref,
} from "../lib/userExcel";

type Outcome = { user: ParsedUser; ok: boolean; error?: string };

/**
 * Excel'den toplu kullanıcı oluşturma. Auth hesabı Function üzerinden açıldığı
 * için satırlar tek tek işlenir; sonuçta hangi satırın neden düştüğü ve
 * üretilen geçici şifreler gösterilir.
 */
export function UserImport({
  departments,
  jobTitles,
  onClose,
  onDone,
}: {
  departments: Ref[];
  jobTitles: Ref[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Outcome[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setParsed(null);
    setFileName("");
    setResults(null);
    setProgress(0);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    setResults(null);
    setFileName(f.name);
    try {
      setParsed(await parseUserWorkbook(f, departments, jobTitles));
    } catch (e2) {
      setErr(`Could not read the file: ${(e2 as Error).message}`);
      setParsed(null);
    }
  }

  async function importAll() {
    if (!parsed || parsed.users.length === 0) return;
    setBusy(true);
    setErr(null);
    const fn = httpsCallable(functions, "createUser");
    const out: Outcome[] = [];
    for (const u of parsed.users) {
      try {
        await fn({
          email: u.email,
          name: u.name,
          role: u.role,
          departmentId: u.departmentId,
          jobTitleIds: u.jobTitleIds,
          company: u.company,
          birthPlace: u.birthPlace,
          birthDate: u.birthDate,
          password: u.password,
        });
        out.push({ user: u, ok: true });
      } catch (e) {
        out.push({ user: u, ok: false, error: (e as Error).message });
      }
      setProgress(out.length);
      setResults([...out]);
    }
    setBusy(false);
    const okCount = out.filter((o) => o.ok).length;
    onDone(`${okCount} of ${out.length} user(s) created.`);
  }

  // ---- Sonuç ekranı ----
  if (results) {
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    const generated = ok.filter((r) => r.user.generatedPassword);
    // Dosyadan okunan toplam satır — "25 / 65" gibi ilerleme gösterebilmek için.
    const total = parsed?.users.length ?? results.length;
    const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
    return (
      <div>
        <div className="mb-3">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="font-semibold text-slate-800">
              {busy ? "Importing…" : "Import finished"}
            </span>
            <span className="tabular-nums text-slate-600">
              <b className="text-slate-900">{progress}</b> / {total} processed
            </span>
          </div>

          <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-200"
              style={{ width: `${pct}%`, background: busy ? "#e8630a" : "#10b981" }}
            />
          </div>

          <div className="mt-1.5 text-[12px]">
            <span className="text-emerald-700 font-semibold">
              {ok.length} of {total} created
            </span>
            {failed.length > 0 && (
              <>
                {" · "}
                <span className="text-brand-700 font-semibold">{failed.length} failed</span>
              </>
            )}
            {busy && total - progress > 0 && (
              <span className="text-slate-500"> · {total - progress} remaining</span>
            )}
          </div>
        </div>

        {failed.length > 0 && (
          <div className="mb-3">
            <div className="label">Failed rows</div>
            <ul className="max-h-32 overflow-auto rounded-md bg-brand-50/60 border border-brand-100 p-2 space-y-0.5">
              {failed.map((r) => (
                <li key={r.user.email} className="text-[11px] text-brand-700">
                  {r.user.email}: {r.error}
                </li>
              ))}
            </ul>
          </div>
        )}

        {generated.length > 0 && (
          <div className="mb-3">
            <div className="label">Generated passwords — copy before closing</div>
            <p className="text-[10px] text-slate-500 mb-1">
              These rows had no password in the file. They are shown once, here.
            </p>
            <div className="max-h-40 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-[12px]">
                <tbody className="divide-y divide-slate-100">
                  {generated.map((r) => (
                    <tr key={r.user.email}>
                      <td className="px-2 py-1 text-slate-700">{r.user.email}</td>
                      <td className="px-2 py-1 font-mono text-slate-900">{r.user.password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() =>
                navigator.clipboard.writeText(
                  generated.map((r) => `${r.user.email}\t${r.user.password}`).join("\n")
                )
              }
              className="mt-2 text-[11px] font-semibold text-brand-700 hover:underline"
            >
              Copy all to clipboard
            </button>
          </div>
        )}

        {/* İçe aktarma sürerken kapatmak yarım bırakır — bitene kadar kilitli. */}
        <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
          <button onClick={onClose} disabled={busy} className="btn-primary text-xs py-2 disabled:opacity-40">
            Close
          </button>
          <button onClick={reset} disabled={busy} className="btn-secondary text-xs py-2 disabled:opacity-40">
            Import another file
          </button>
          {busy && (
            <span className="text-[11px] text-slate-500">
              Please wait — closing now would leave the rest of the file unprocessed.
            </span>
          )}
        </div>
      </div>
    );
  }

  // ---- Yükleme / önizleme ----
  return (
    <div>
      <p className="text-[12px] text-slate-600 mb-3">
        Download the template, fill one person per row, then upload it back here. Departments and
        authorisation scopes must match the names already in the system — the template lists them.
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => downloadUserTemplate(departments, jobTitles)}
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

      {parsed && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="text-[12px] text-slate-600 mb-2">
            <b>{fileName}</b> · sheet “{parsed.sheetName}” ·{" "}
            <span className="text-emerald-700 font-semibold">{parsed.users.length} ready</span>
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

          {parsed.users.length > 0 && (
            <div className="mb-3 max-h-48 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="th !py-1.5">Name</th>
                    <th className="th !py-1.5">Email</th>
                    <th className="th !py-1.5">Role</th>
                    <th className="th !py-1.5">Authorisation Scope(s)</th>
                    <th className="th !py-1.5">Password</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parsed.users.map((u) => (
                    <tr key={u.email}>
                      <td className="px-3 py-1 font-medium text-slate-800">{u.name}</td>
                      <td className="px-3 py-1 text-slate-500">{u.email}</td>
                      <td className="px-3 py-1 text-slate-600">{u.role}</td>
                      <td className="px-3 py-1">
                        {u.jobTitleNames.length === 0 ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {u.jobTitleNames.map((n) => (
                              <span
                                key={n}
                                className="bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[10px] font-medium"
                              >
                                {n}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1 text-slate-400">
                        {u.generatedPassword ? "auto" : "from file"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {parsed.users.length === 0 ? (
            <p className="text-[12px] text-slate-500">
              Nothing to import. Fix the rows above and upload the file again.
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={importAll} disabled={busy} className="btn-primary text-xs py-1.5">
                {busy
                  ? `Creating ${progress}/${parsed.users.length}…`
                  : `Create ${parsed.users.length} User(s)`}
              </button>
              <button onClick={reset} disabled={busy} className="btn-secondary text-xs py-1.5">
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {err && <p className="mt-2 text-xs text-brand-700">{err}</p>}
    </div>
  );
}
