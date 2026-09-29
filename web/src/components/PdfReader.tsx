import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

type Slot = {
  n: number;
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  page: pdfjs.PDFPageProxy;
  viewport: pdfjs.PageViewport;
  rendered: boolean;
};

/** Çizim genişliği kutudan bağımsız sabit — tam ekranda da net kalsın. */
const RENDER_WIDTH = 1240;
/** Görünür alandan bu kadar uzaklaşan sayfanın canvas'ı boşaltılır. */
const KEEP_NEAR = 6;

/**
 * PDF'i kendimiz çizeriz — tarayıcının gömülü görüntüleyicisi hangi sayfanın
 * okunduğunu dışarı bildirmiyor.
 *
 * Üç şey ayrı tutulur:
 *   1. Yerleşim — bütün sayfaların yeri en baştan, gerçek en-boy oranıyla.
 *      Kaydırma çubuğu doğru olur, takip anında çalışır.
 *   2. Çizim    — yalnızca görünür alana yaklaşan sayfa, sırayla TEK TEK.
 *      Uzaklaşan sayfanın canvas'ı boşaltılır; 216 sayfalık bir doküman
 *      aksi hâlde belleği tüketiyor.
 *   3. Takip    — konum tabanlı: sayfanın alt kenarı görünür alanın üstünde
 *      kaldıysa o sayfa geçilmiş sayılır.
 */
export function PdfReader({
  url,
  fileName,
  onProgress,
}: {
  url: string;
  fileName: string;
  onProgress: (seen: number, total: number) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState(0);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [full, setFull] = useState(false);

  useEffect(() => {
    onProgress(seen.size, total);
  }, [seen, total, onProgress]);

  // Tam ekran, tarayıcının kendi API'siyle — Esc ile de çıkılabilsin diye
  // durum `fullscreenchange` üzerinden okunur, kendi bayrağımızdan değil.
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shellRef.current?.requestFullscreen?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let doc: pdfjs.PDFDocumentProxy | null = null;
    let io: IntersectionObserver | null = null;
    let onScroll: (() => void) | null = null;
    const slots: Slot[] = [];

    (async () => {
      const host = hostRef.current;
      if (!host) return;
      host.innerHTML = "";
      try {
        doc = await pdfjs.getDocument({ url, withCredentials: false }).promise;
        if (cancelled) return;
        const pages = doc.numPages;
        setTotal(pages);

        // ── 1. Yerleşim ──
        for (let n = 1; n <= pages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });

          const wrap = document.createElement("div");
          wrap.className = "relative mb-3 last:mb-0 bg-white rounded border border-slate-200";
          wrap.dataset.page = String(n);
          // Yükseklik en-boy oranından gelir; böylece canvas boşaltılsa bile
          // sayfa yerini korur ve kaydırma çubuğu zıplamaz.
          wrap.style.aspectRatio = `${viewport.width} / ${viewport.height}`;

          const canvas = document.createElement("canvas");
          canvas.className = "absolute inset-0 h-full w-full";
          const badge = document.createElement("span");
          badge.className =
            "absolute top-2 right-2 z-10 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-900/70 text-white";
          badge.textContent = `${n} / ${pages}`;
          wrap.append(canvas, badge);
          host.append(wrap);

          slots.push({ n, el: wrap, canvas, page, viewport, rendered: false });
        }
        if (cancelled) return;
        setLoading(false);

        // ── 2. Çizim: kuyruk, tek tek ──
        const queue: Slot[] = [];
        let drawing = false;
        const pump = async () => {
          if (drawing || cancelled) return;
          drawing = true;
          while (queue.length && !cancelled) {
            const s = queue.pop()!;
            if (s.rendered) continue;
            s.canvas.width = s.viewport.width;
            s.canvas.height = s.viewport.height;
            const ctx = s.canvas.getContext("2d");
            if (!ctx) continue;
            s.rendered = true;
            try {
              await s.page.render({ canvasContext: ctx, viewport: s.viewport }).promise;
            } catch {
              s.rendered = false;
            }
          }
          drawing = false;
        };
        /** Uzaktaki sayfaların belleğini bırak. */
        const freeFar = (center: number) => {
          for (const s of slots) {
            if (!s.rendered || Math.abs(s.n - center) <= KEEP_NEAR) continue;
            s.canvas.width = 0;
            s.canvas.height = 0;
            s.rendered = false;
          }
        };

        io = new IntersectionObserver(
          (entries) => {
            let center = 0;
            for (const e of entries) {
              if (!e.isIntersecting) continue;
              const n = Number((e.target as HTMLElement).dataset.page);
              center = center || n;
              const s = slots.find((x) => x.n === n);
              if (s && !s.rendered) {
                queue.push(s);
                void pump();
              }
            }
            if (center) freeFar(center);
          },
          { root: host, rootMargin: "600px 0px" }
        );
        slots.forEach((s) => io!.observe(s.el));

        // ── 3. Takip ──
        const mark = () => {
          const el = hostRef.current;
          if (!el) return;
          const box = el.getBoundingClientRect();
          if (box.height === 0) return; // gizliyken sayma
          const atEnd = el.scrollHeight - (el.scrollTop + el.clientHeight) < 8;
          setSeen((prev) => {
            const next = new Set(prev);
            for (const s of slots) {
              const r = s.el.getBoundingClientRect();
              if (atEnd || r.bottom <= box.bottom + 24) next.add(s.n);
            }
            return next.size === prev.size ? prev : next;
          });
        };
        let queued = false;
        onScroll = () => {
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => {
            queued = false;
            mark();
          });
        };
        host.addEventListener("scroll", onScroll, { passive: true });
        mark();
      } catch (e) {
        if (!cancelled) {
          setErr((e as Error).message);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      io?.disconnect();
      if (onScroll && hostRef.current) hostRef.current.removeEventListener("scroll", onScroll);
      doc?.destroy();
    };
  }, [url]);

  if (err)
    return (
      <div className="rounded border border-brand-200 bg-brand-50/60 p-4">
        <p className="text-[13px] text-brand-700 font-semibold mb-1">
          This PDF could not be displayed.
        </p>
        <p className="text-[11px] text-brand-700/80 mb-2">{err}</p>
        <a href={url} target="_blank" rel="noreferrer" className="text-[12px] underline">
          Open {fileName} in a new tab
        </a>
      </div>
    );

  const pct = total > 0 ? Math.round((seen.size / total) * 100) : 0;

  return (
    <div
      ref={shellRef}
      className={
        full
          ? "fixed inset-0 z-50 bg-white p-4 flex flex-col"
          : // Gömülü hâlde dar tutulur; okumak isteyen tam ekrana geçer.
            "max-w-[680px]"
      }
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-[11px] text-slate-500 truncate">{fileName}</span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] font-semibold text-slate-600 tabular-nums">
            {loading ? "Preparing…" : `${seen.size} / ${total} pages read`}
          </span>
          <button
            type="button"
            onClick={toggleFull}
            className="btn-secondary text-[11px] py-1 px-2"
            title={full ? "Exit full screen (Esc)" : "Read full screen"}
          >
            {full ? "✕ Exit full screen" : "⛶ Full screen"}
          </button>
        </div>
      </div>

      {!loading && total > 0 && (
        <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden mb-2 shrink-0">
          <div
            className="h-full rounded-full transition-[width] duration-200"
            style={{ width: `${pct}%`, background: pct === 100 ? "#10b981" : "#e8630a" }}
          />
        </div>
      )}

      <div
        ref={hostRef}
        className={`overflow-y-auto rounded border border-slate-200 bg-slate-100 p-2 ${
          full ? "flex-1 min-h-0" : "max-h-[46vh]"
        }`}
      />
    </div>
  );
}
