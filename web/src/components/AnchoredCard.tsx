/**
 * Bir hücreye/düğmeye çapalanmış yüzen kart.
 *
 * `position: fixed` + portal: matris gövdesi `overflow-hidden` ve sticky
 * kolonlar taşıyor, kart normal akışta kalsa kırpılıyordu. Ekranın sağına
 * taşarsa sola kelepçelenir, altına sığmazsa çapanın üstüne açılır.
 *
 * Hem hücre detay kartı hem hücre eylem menüsü bunu kullanıyor — iki ayrı
 * konumlandırma kodu tutmak, biri düzeltilip diğeri bozuk kalmak demekti.
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function AnchoredCard({
  rect,
  width,
  estimatedHeight = 190,
  onEnter,
  onLeave,
  onDismiss,
  children,
}: {
  /** Çapanın ekran koordinatları (`getBoundingClientRect`). */
  rect: DOMRect;
  width: number;
  /** Aşağı mı yukarı mı açılacağına karar vermek için kaba yükseklik. */
  estimatedHeight?: number;
  onEnter?: () => void;
  onLeave?: () => void;
  /** Verilirse Esc ve dışarıya tıklama kartı kapatır. */
  onDismiss?: () => void;
  children: React.ReactNode;
}) {
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - width / 2),
    window.innerWidth - width - 8
  );
  const below = rect.bottom + 8;
  const openUp = below + estimatedHeight > window.innerHeight;

  useEffect(() => {
    if (!onDismiss) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return createPortal(
    <>
      {onDismiss && (
        <div className="fixed inset-0 z-[79]" onMouseDown={onDismiss} aria-hidden />
      )}
      <div
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{
          position: "fixed",
          left,
          width,
          ...(openUp
            ? { bottom: window.innerHeight - rect.top + 8 }
            : { top: below }),
        }}
        className="z-[80]"
      >
        {children}
      </div>
    </>,
    document.body
  );
}
