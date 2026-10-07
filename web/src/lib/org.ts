/**
 * Kurum künyesi ve marka metinleri. Tek yerde durur; kurum adı, onay numarası
 * ya da form/revizyon değişince yalnızca burası güncellenir. Belge metinleri
 * İngilizce.
 *
 * CAPELLA SHT-145 onaylı bir kuruluş DEĞİL: belgelerde onay numarası satırı
 * yok, kurum adının altında web adresi yazar.
 */
export const ORG = {
  /** Uygulamanın adı — sidebar, giriş ekranı, sekme başlığı. */
  productName: "Capella Academy",
  name: "CAPELLA AVIATION SOLUTIONS",
  /** Belge antetinde kurum adının altındaki satır. */
  website: "www.capella.aero",
  contactEmail: "info@capella.aero",
  issuedBy: "CAPELLA AVIATION SOLUTIONS",
  /** Eğitimler çevrimiçi veriliyor. */
  defaultLocation: "ONLINE",
  footer: {
    formNo: "CPL-TRN-FRM-002",
    revisionNo: "01",
    revisionDate: "15.08.2026",
  },
  /** Örnek e-postalar ve yer tutucular bu alan adıyla yazılır. */
  emailDomain: "capella.aero",
  /** Giriş ekranının altındaki tek satırlık künye. */
  publicFooter: "Capella Aviation Solutions · www.capella.aero",
  legalFooter: "Capella Aviation Solutions · Capella Academy",
} as const;
