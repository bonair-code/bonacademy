/**
 * Tam ekran — tarayıcı API'si varsa onu, yoksa CSS kaplaması.
 *
 * `Element.requestFullscreen` iOS Safari'de YOK (yalnızca <video> destekleniyor)
 * ve iframe'de ayrıca `allowfullscreen` gerekiyor. Düğme bu yüzden telefonda
 * sessizce hiçbir şey yapmıyordu.
 *
 * Bu yüzden doğruluk kaynağı bizim kendi durumumuz: düğmeye basınca eleman her
 * hâlükârda `fixed inset-0` ile ekranı kaplıyor, tarayıcı API'si varsa ayrıca
 * gerçek tam ekrana da geçiliyor (masaüstünde tarayıcı çubuklarından da
 * kurtulmak için). API reddederse kaplama yine çalışır.
 */
import { useCallback, useEffect, useState } from "react";

export function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [full, setFull] = useState(false);

  const toggle = useCallback(() => {
    const el = ref.current;
    setFull((was) => {
      const next = !was;
      try {
        if (next) void el?.requestFullscreen?.().catch(() => {});
        else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
      } catch {
        // API yoksa kaplama tek başına yeterli.
      }
      return next;
    });
  }, [ref]);

  // Esc ile çıkış: hem gerçek tam ekranda hem kaplamada aynı tuş beklenir.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    // Tarayıcı kendi tam ekranından çıkarsa kaplamayı da kapat.
    const onFs = () => {
      if (!document.fullscreenElement) setFull((f) => (f ? false : f));
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [full]);

  return { full, toggle, setFull };
}
