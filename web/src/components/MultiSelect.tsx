import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Option = { id: string; name: string };

/**
 * Açılır çoklu seçim. Native <select multiple> ctrl tuşu gerektiriyor ve
 * listeyi kutuya sıkıştırıyordu; burada her satır bir onay kutusu.
 *
 * Panel body'ye portal'lanır: modal içinde `absolute` konumlandığında modalın
 * kutusunu taşıp kırpılıyordu ve sayfa kaydırılamadığı için alt seçeneklere
 * ulaşılamıyordu.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "— Select —",
  searchAfter = 6,
}: {
  options: Option[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Seçenek sayısı bunu aşarsa arama kutusu gösterilir. */
  searchAfter?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /** Paneli tetikleyiciye göre yerleştirir; alta sığmıyorsa üstüne açar. */
  function place() {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const desired = 320; // arama + liste + alt bar için tahmini yükseklik
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const openUp = below < 200 && above > below;
    setPos({
      top: openUp ? Math.max(8, r.top - Math.min(desired, above) - 4) : r.bottom + 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
      width: r.width,
    });
  }

  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation(); // Modal'ı da kapatmasın
        setOpen(false);
      }
    }
    const reposition = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && options.length > searchAfter) searchRef.current?.focus();
    if (!open) setQ("");
  }, [open, options.length, searchAfter]);

  const selected = useMemo(() => options.filter((o) => value.includes(o.id)), [options, value]);
  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    if (!needle) return options;
    return options.filter((o) => o.name.toLocaleLowerCase("tr").includes(needle));
  }, [options, q]);

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`input flex items-center gap-2 text-left min-h-[38px] ${
          open ? "ring-2 ring-brand-200 border-brand-400" : ""
        }`}
      >
        <span className="flex-1 min-w-0 flex flex-wrap items-center gap-1">
          {selected.length === 0 && <span className="text-slate-400">{placeholder}</span>}
          {selected.slice(0, 2).map((o) => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1 bg-brand-50 text-brand-700 rounded px-1.5 py-0.5 text-[11px] font-semibold max-w-[140px]"
            >
              <span className="truncate">{o.name}</span>
              <span
                role="button"
                tabIndex={-1}
                aria-label={`${o.name} seçimini kaldır`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(o.id);
                }}
                className="text-brand-400 hover:text-brand-700 leading-none"
              >
                ×
              </span>
            </span>
          ))}
          {selected.length > 2 && (
            <span className="text-[11px] font-semibold text-slate-500">
              +{selected.length - 2}
            </span>
          )}
        </span>
        <svg
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
            className="z-[60] bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden"
          >
            {options.length > searchAfter && (
              <div className="p-2 border-b border-slate-100">
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search…"
                  className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
            )}

            <ul
              role="listbox"
              aria-multiselectable="true"
              className="max-h-56 overflow-y-auto overscroll-contain py-1"
            >
              {shown.length === 0 && (
                <li className="px-3 py-4 text-center text-xs text-slate-400">No match.</li>
              )}
              {shown.map((o) => {
                const on = value.includes(o.id);
                return (
                  <li key={o.id} role="option" aria-selected={on}>
                    <label className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(o.id)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
                      />
                      <span className={on ? "font-semibold text-slate-900" : "text-slate-700"}>
                        {o.name}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{selected.length} selected</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onChange([])}
                  disabled={selected.length === 0}
                  className="text-[11px] font-semibold text-slate-500 hover:text-brand-700 disabled:opacity-40"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-[11px] font-semibold text-brand-700 hover:underline"
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
