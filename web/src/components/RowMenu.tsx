import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

export type MenuItem = {
  label: string;
  /** `to` verilirse gezinme kalemi olur; ikisinden biri gerekli. */
  onClick?: () => void;
  to?: string;
  /** Yıkıcı işlemler kırmızı gösterilir ve ayırıcıyla ayrılır. */
  danger?: boolean;
  icon?: ReactNode;
};

const MENU_W = 176;

/**
 * Satır sonundaki üç nokta menüsü. Panel body'ye portal'lanır — tablo kartları
 * `overflow-hidden` taşıdığı için normal `absolute` konumlama kırpılıyordu.
 */
export function RowMenu({ items, label = "Row actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /** Paneli butona göre yerleştirir; alta sığmıyorsa üstüne açar. */
  function place() {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const estHeight = items.length * 36 + 16;
    const below = r.bottom + 4;
    const top = below + estHeight > window.innerHeight ? r.top - estHeight - 4 : below;
    setPos({
      top: Math.max(8, top),
      left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)),
    });
  }

  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Kaydırma/boyut değişiminde kapatmak yerine panelin yerini tazele.
    const reposition = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className={`h-7 w-7 inline-flex items-center justify-center rounded-md transition ${
          open
            ? "bg-slate-100 text-slate-700"
            : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <circle cx="10" cy="4" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="10" cy="16" r="1.6" />
        </svg>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_W }}
            className="z-[60] bg-white border border-slate-200 rounded-lg shadow-xl py-1"
          >
            {items.map((it, i) => {
              const cls = `w-full text-left px-3 py-2 text-[13px] flex items-center gap-2.5 transition ${
                it.danger ? "text-brand-700 hover:bg-brand-50" : "text-slate-700 hover:bg-slate-50"
              }`;
              const body = (
                <>
                  {it.icon && <span className="w-4 shrink-0 text-center">{it.icon}</span>}
                  {it.label}
                </>
              );
              return (
                <div key={it.label}>
                  {it.danger && i > 0 && <div className="my-1 border-t border-slate-100" />}
                  {it.to ? (
                    <Link role="menuitem" to={it.to} onClick={() => setOpen(false)} className={cls}>
                      {body}
                    </Link>
                  ) : (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        it.onClick?.();
                      }}
                      className={cls}
                    >
                      {body}
                    </button>
                  )}
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
