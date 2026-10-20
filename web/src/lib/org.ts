/**
 * Kurum künyesi ve marka metinleri. Tek yerde durur; kurum adı, onay numarası
 * ya da form/revizyon değişince yalnızca burası güncellenir. Belge metinleri
 * İngilizce.
 *
 * BonAir SHT-145 onaylı bir kuruluş: belge antetinde kurum adının altında
 * onay satırı yazar.
 */
export const ORG = {
  /** Uygulamanın adı — sidebar, giriş ekranı, sekme başlığı. */
  productName: "BonAcademy",
  /**
   * Resmî/onay adı. SHT-145 onayındaki yazımla aynı olmalı; SERTİFİKADA
   * bu geçiyor. Verilmiş sertifikalar adı kendi belgelerinde saklıyor,
   * burayı değiştirmek onları etkilemez.
   */
  name: "BONAIR AVIATION MAINTENANCE ORGANISATION",
  /**
   * Rapor antetindeki kısa ad. Rapor bir onay belgesi değil, iç kayıt
   * dökümü; uzun kurum unvanı orada gereksiz yer kaplıyordu.
   */
  reportName: "BONAIR AVIATION",
  /** Belge antetinde kurum adının altındaki satır. */
  approvalLine: "Turkish DGCA SHT 145 Approval No: TR.145.118",
  /** Sertifikaya yazılan onay numarası (sunucu tarafı da bunu kullanır). */
  approvalNo: "TR.145.118",
  contactEmail: "qualitytechnic@bonair.com.tr",
  /** Sertifikadaki "By …" satırı. */
  issuedBy: "BONAIR AVIATION",
  /** Eğitimler çevrimiçi veriliyor. */
  defaultLocation: "ONLINE",
  footer: {
    formNo: "BON-F145-070",
    revisionNo: "01",
    revisionDate: "15.08.2026",
  },
  /** Örnek e-postalar ve yer tutucular bu alan adıyla yazılır. */
  emailDomain: "bonair.com.tr",
  /** Giriş ekranının altındaki tek satırlık künye. */
  publicFooter: "BonAir Aviation · Turkish DGCA SHT-145 · TR.145.118",
  legalFooter: "BonAir Aviation · BonAir Academy",
} as const;
