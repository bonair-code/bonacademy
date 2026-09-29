import { useEffect, useRef, useState } from "react";

type Cmi = Record<string, string>;

const DONE_VALUES = ["completed", "passed"];

/**
 * SCORM paketini aynı origin'den (hosting rewrite / dev proxy) gömer ve
 * window üzerine minimal bir LMS API'si kurar. Paket dersi tamamlandı olarak
 * işaretleyince onDone çalışır.
 *
 * Aynı origin şart: SCORM içeriği API'yi window.parent zincirinde arar ve
 * çapraz origin bir iframe buna erişemez.
 */
export function ScormPlayer({
  src,
  fileName,
  onDone,
}: {
  src: string;
  fileName: string;
  onDone: () => void;
}) {
  const [status, setStatus] = useState("not attempted");
  const doneRef = useRef(false);
  /** Iframe'i yeniden kurmak için — src aynı kaldığında React iframe'i tazelemiyor. */
  const [nonce, setNonce] = useState(0);
  const [reach, setReach] = useState<"checking" | "ok" | "error">("checking");
  const [httpCode, setHttpCode] = useState<number | null>(null);

  /**
   * Adresin gerçekten açıldığını ayrıca doğrula. Iframe bir 404 gövdesini de
   * sessizce gösterir; kullanıcı yalnızca boş/anlamsız bir kutu görür.
   * Önbelleği atlamak için `cache: "reload"`.
   */
  useEffect(() => {
    let alive = true;
    setReach("checking");
    setHttpCode(null);
    fetch(src, { method: "GET", cache: "reload" })
      .then((r) => {
        if (!alive) return;
        setHttpCode(r.status);
        setReach(r.ok ? "ok" : "error");
      })
      .catch(() => alive && setReach("error"));
    return () => {
      alive = false;
    };
  }, [src, nonce]);

  useEffect(() => {
    const cmi: Cmi = {
      "cmi.core.lesson_status": "not attempted",
      "cmi.core.lesson_location": "",
      "cmi.core.score.raw": "",
      "cmi.suspend_data": "",
      "cmi.completion_status": "not attempted",
      "cmi.success_status": "unknown",
    };

    function markIfDone(value: string) {
      const v = value.toLowerCase();
      setStatus(v);
      if (DONE_VALUES.includes(v) && !doneRef.current) {
        doneRef.current = true;
        onDone();
      }
    }

    function setValue(key: string, value: string) {
      cmi[key] = value;
      if (key === "cmi.core.lesson_status" || key === "cmi.completion_status") markIfDone(value);
      if (key === "cmi.success_status" && value.toLowerCase() === "passed") markIfDone(value);
      return "true";
    }

    const scorm12 = {
      LMSInitialize: () => "true",
      LMSFinish: () => {
        // Paket bazen durumu yazmadan kapanır; tamamlandı saymıyoruz.
        return "true";
      },
      LMSGetValue: (k: string) => cmi[k] ?? "",
      LMSSetValue: (k: string, v: string) => setValue(k, v),
      LMSCommit: () => "true",
      LMSGetLastError: () => "0",
      LMSGetErrorString: () => "No error",
      LMSGetDiagnostic: () => "",
    };

    const scorm2004 = {
      Initialize: () => "true",
      Terminate: () => "true",
      GetValue: (k: string) => cmi[k] ?? "",
      SetValue: (k: string, v: string) => setValue(k, v),
      Commit: () => "true",
      GetLastError: () => "0",
      GetErrorString: () => "No error",
      GetDiagnostic: () => "",
    };

    const w = window as unknown as Record<string, unknown>;
    const prev12 = w.API;
    const prev2004 = w.API_1484_11;
    w.API = scorm12;
    w.API_1484_11 = scorm2004;

    return () => {
      w.API = prev12;
      w.API_1484_11 = prev2004;
    };
  }, [onDone]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-[11px] text-slate-500 truncate">{fileName}</span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] font-semibold text-slate-600">SCORM status: {status}</span>
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="btn-secondary text-[11px] py-1 px-2"
            title="Reload the package"
          >
            ⟳ Reload
          </button>
        </div>
      </div>

      {/* Paket açılmazsa iframe boş bir kutu olarak kalıyordu ve neden
          açılmadığı anlaşılmıyordu; adres ayrıca kontrol edilip durum
          burada yazılıyor. */}
      {reach === "error" && (
        <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
          <p className="text-[12.5px] font-semibold text-amber-900">
            The package could not be loaded{httpCode ? ` (HTTP ${httpCode})` : ""}.
          </p>
          <p className="text-[11px] text-amber-800 mt-0.5 break-all">{src}</p>
          <p className="text-[11px] text-amber-800 mt-1">
            Try ⟳ Reload. If it keeps failing, the package needs to be uploaded again from the
            course page.
          </p>
        </div>
      )}

      <iframe
        key={nonce}
        src={src}
        className="w-full h-[70vh] rounded border border-slate-200 bg-white"
        title={fileName}
      />
    </div>
  );
}
