/**
 * Sertifika üstündeki kurum ve form künyesi. Tek yerde durur; form/revizyon
 * değişince yalnızca burası güncellenir. Belge metinleri İngilizce.
 */
export const ORG = {
  name: "BONAIR AVIATION MAINTENANCE ORGANISATION",
  approvalLine: "Turkish DGCA SHT 145 Approval No: TR.145.118",
  issuedBy: "BONAIR AVIATION",
  /** Eğitimler çevrimiçi veriliyor. */
  defaultLocation: "ONLINE",
  footer: {
    formNo: "BON-F145-070",
    revisionNo: "01",
    revisionDate: "15.08.2026",
  },
  legalFooter: "BonAir Aviation · BonAir Academy",
} as const;
