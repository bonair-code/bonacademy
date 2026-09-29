import { printReport } from "../lib/print";

/**
 * Sayfayı PDF olarak almak için yazdırma. Tarayıcının yazdırma penceresinde
 * "Hedef: PDF olarak kaydet" seçilir. Çıktı ekranın kopyası değil: uygulama
 * kabuğu kalkar, antet/künye eklenir (bkz. ReportSheet ve index.css).
 */
export function PrintButton({
  label = "PDF / Print",
  landscape = false,
}: {
  label?: string;
  /** Geniş tablolar (ör. Training Follow-Up) yatay sayfaya sığar. */
  landscape?: boolean;
}) {
  return (
    <button
      onClick={() => printReport({ landscape })}
      className="btn-secondary text-xs py-2 no-print"
    >
      ↓ {label}
    </button>
  );
}
