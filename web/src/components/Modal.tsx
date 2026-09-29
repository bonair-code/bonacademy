import { useEffect, type ReactNode } from "react";

/** Ortalanmış, Esc ve arka plan tıklamasıyla kapanan diyalog. */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  width = "max-w-2xl",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // my-auto uzun formda içeriği ortalayıp üstünü erişilemez kılıyordu;
        // üstten hizala ve gerekiyorsa arka plan kaydırsın.
        className={`w-full ${width} bg-white rounded-xl shadow-2xl overflow-hidden`}
      >
        <div
          className="relative px-5 py-3.5 flex items-start justify-between gap-4"
          style={{ background: "linear-gradient(180deg,#8b1013 0%,#6d0d11 100%)" }}
        >
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-white">{title}</div>
            {subtitle && <div className="text-[11px] text-white/60 truncate">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-white/70 hover:text-white text-lg leading-none shrink-0 -mt-0.5"
          >
            ×
          </button>
          <span
            className="absolute bottom-0 left-0 right-0 h-0.5"
            style={{ background: "linear-gradient(90deg,#e31e24,#e8630a 60%,transparent)" }}
          />
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
