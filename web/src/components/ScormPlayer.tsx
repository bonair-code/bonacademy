import { useEffect, useRef, useState } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/auth";

type Cmi = Record<string, string>;

const DONE_VALUES = ["completed", "passed"];

/**
 * SCORM paketini aynı origin'den (hosting rewrite / dev proxy) gömer ve
 * window üzerine minimal bir LMS API'si kurar. Paket dersi tamamlandı olarak
 * işaretleyince onDone çalışır.
 *
 * Aynı origin şart: SCORM içeriği API'yi window.parent zincirinde arar ve
 * çapraz origin bir iframe buna erişemez.
 *
 * **Kaldığı yerden devam:** paketin yazdığı `cmi` değerleri (bulunulan sayfa,
 * suspend_data, durum, puan) `assignments/{id}/scorm/{contentId}` altında
 * saklanır ve iframe kurulmadan ÖNCE geri yüklenir. Paket LMSInitialize
 * sırasında bu değerleri okur; sonradan yüklemek işe yaramaz, o yüzden
 * durum gelene kadar iframe basılmıyor.
 */
export function ScormPlayer({
  src,
  fileName,
  onDone,
  assignmentId,
  contentId,
}: {
  src: string;
  fileName: string;
  onDone: () => void;
  /** İkisi de verilirse ilerleme saklanır. Kurs önizlemesinde verilmez. */
  assignmentId?: string;
  contentId?: string;
}) {
  const { profile } = useAuth();
  const stateRef =
    assignmentId && contentId ? doc(db, "assignments", assignmentId, "scorm", contentId) : null;
  /** Kayıtlı durum yüklenene kadar iframe basılmaz. */
  const [restored, setRestored] = useState<Cmi | null>(stateRef ? null : {});
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

  /** Kayıtlı ilerlemeyi bir kez oku; gelmeden iframe basılmaz. */
  useEffect(() => {
    if (!stateRef) return;
    let alive = true;
    getDoc(stateRef)
      .then((d) => {
        if (!alive) return;
        const saved = (d.data() as any)?.cmi;
        setRestored(saved && typeof saved === "object" ? (saved as Cmi) : {});
      })
      .catch(() => alive && setRestored({}));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, contentId]);

  useEffect(() => {
    if (!restored) return; // durum yüklenmeden API kurulmaz
    const cmi: Cmi = {
      "cmi.core.lesson_status": "not attempted",
      "cmi.core.lesson_location": "",
      "cmi.core.score.raw": "",
      "cmi.suspend_data": "",
      "cmi.completion_status": "not attempted",
      "cmi.success_status": "unknown",
      ...restored,
    };

    /**
     * Yazma her LMSSetValue'da değil, kısa bir gecikmeyle yapılır: paketler
     * sayfa geçişinde arka arkaya onlarca değer yazıyor.
     */
    let saveTimer: number | null = null;
    const persist = () => {
      if (!stateRef || !profile) return;
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        // userId kuralın şartı: kişi yalnızca kendi ilerlemesini yazabilir.
        void setDoc(
          stateRef,
          { userId: profile.uid, cmi, updatedAt: serverTimestamp() },
          { merge: true }
        ).catch(() => {});
      }, 800);
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
      persist();
      return "true";
    }

    const scorm12 = {
      LMSInitialize: () => "true",
      LMSFinish: () => {
        // Paket bazen durumu yazmadan kapanır; tamamlandı saymıyoruz —
        // ama nerede kaldığı kaydedilir ki dönünce oradan devam etsin.
        persist();
        return "true";
      },
      LMSGetValue: (k: string) => cmi[k] ?? "",
      LMSSetValue: (k: string, v: string) => setValue(k, v),
      LMSCommit: () => {
        persist();
        return "true";
      },
      LMSGetLastError: () => "0",
      LMSGetErrorString: () => "No error",
      LMSGetDiagnostic: () => "",
    };

    const scorm2004 = {
      Initialize: () => "true",
      Terminate: () => {
        persist();
        return "true";
      },
      GetValue: (k: string) => cmi[k] ?? "",
      SetValue: (k: string, v: string) => setValue(k, v),
      Commit: () => {
        persist();
        return "true";
      },
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
      // Sekme kapanırken bekleyen yazma varsa hemen gönder.
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        if (stateRef && profile) {
          void setDoc(
            stateRef,
            { userId: profile.uid, cmi, updatedAt: serverTimestamp() },
            { merge: true }
          ).catch(() => {});
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDone, restored]);

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

      {/* Kayıtlı ilerleme gelmeden paket başlatılmaz; yoksa LMSInitialize
          boş değerleri okur ve eğitim baştan başlar. */}
      {!restored ? (
        <div className="w-full h-[70vh] rounded border border-slate-200 bg-slate-50 grid place-items-center text-sm text-slate-400">
          Restoring your progress…
        </div>
      ) : (
      <iframe
        key={nonce}
        src={src}
        className="w-full h-[70vh] rounded border border-slate-200 bg-white"
        title={fileName}
      />
      )}
    </div>
  );
}
