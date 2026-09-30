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
        {/* Beyaz başlık: kırmızı gradyan bant eski kimliğin kalıntısıydı ve
            formun kendisinden daha çok dikkat çekiyordu. */}
        <div className="px-[18px] py-[15px] border-b border-slate-100 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[14.5px] font-semibold text-slate-900 tracking-[-0.015em] leading-tight">
              {title}
            </div>
            {subtitle && (
              <div className="text-[11.5px] text-slate-400 truncate mt-0.5">{subtitle}</div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-[26px] w-[26px] shrink-0 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 grid place-items-center text-[15px] leading-none transition"
          >
            ×
          </button>
        </div>
        <div className="p-[18px]">{children}</div>
      </div>
    </div>
  );
}
