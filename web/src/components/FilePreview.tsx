import { useEffect, useRef, useState } from "react";

/**
 * Belge önizleme penceresi.
 *
 * Eskiden "Open" bağlantıları dosyayı yeni sekmede açıyordu: kullanıcı
 * uygulamadan çıkıyor, geri dönmek için sekme kapatıyordu. Belge artık
 * uygulamanın içinde açılıyor; yazdırma ve indirme kendi düğmelerinde.
 *
 * Dosya `fetch` ile alınıp **blob** URL'ine çevriliyor. Sebebi teknik ama
 * sonucu doğrudan: Storage adresi başka bir origin olduğu için tarayıcı
 * oradaki iframe'i yazdırmaya izin vermiyor ve `download` özniteliğini
 * yok sayıyor. Blob aynı origin sayıldığından ikisi de çalışıyor.
 * (Storage CORS'u uygulama adresine açık — bkz. cors.json.)
 */
export function FilePreview({
  url,
  fileName,
  title,
  onClose,
}: {
  url: string;
  fileName?: string | null;
  title?: string;
  onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "fallback">("loading");
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setState("loading");
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then((b) => {
        if (!alive) return;
        made = URL.createObjectURL(b);
        setBlobUrl(made);
        setState("ready");
      })
      .catch(() => {
        // Alınamadıysa belge yine gösterilir, ama yazdırma tarayıcıya kalır.
        if (alive) setState("fallback");
      });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const src = state === "ready" && blobUrl ? blobUrl : state === "fallback" ? url : null;
  const name = (fileName || "document.pdf").replace(/[^\w.\-()\s]+/g, "_");

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/50 p-3 sm:p-6 flex flex-col"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-5xl mx-auto bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="px-[18px] py-[13px] border-b border-slate-100 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-slate-900 truncate tracking-[-0.01em]">
              {title || fileName || "Document"}
            </div>
            {title && fileName && (
              <div className="text-[11.5px] text-slate-400 truncate">{fileName}</div>
            )}
          </div>

          {state === "ready" ? (
            <>
              <button
                onClick={() => frame.current?.contentWindow?.print()}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                Print
              </button>
              <a
                href={blobUrl ?? "#"}
                download={name}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                Download
              </a>
            </>
          ) : state === "fallback" ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary text-xs py-1.5 px-3"
            >
              Open in new tab
            </a>
          ) : null}

          <button
            onClick={onClose}
            aria-label="Close"
            className="h-[26px] w-[26px] shrink-0 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 grid place-items-center text-[15px] leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 bg-slate-100">
          {src ? (
            <iframe ref={frame} src={src} title={name} className="w-full h-full border-0" />
          ) : (
            <div className="h-full grid place-items-center text-sm text-slate-400">Loading…</div>
          )}
        </div>

        {state === "fallback" && (
          <p className="px-[18px] py-2 text-[11px] text-amber-800 bg-amber-50 border-t border-amber-200">
            The file could not be loaded into the app — printing and downloading go through your
            browser instead.
          </p>
        )}
      </div>
    </div>
  );
}
