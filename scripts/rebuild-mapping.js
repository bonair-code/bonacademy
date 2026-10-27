/**
 * YENİDEN KURULUM — AD EŞLEME TABLOSU
 *
 * Aynı eğitim dört ayrı yerde dört ayrı adla geçiyor. Bu dosya hepsini tek
 * bir KONU'ya bağlar. Yeniden kurulum betiği yalnızca buradaki konuları
 * açar; katalogdaki (DURATION LIST) 66 dersin tamamı açılmaz.
 *
 * Alanlar:
 *   subject  → sistemde açılacak takip edilen eğitimin adı (matris sütunu)
 *   trng     → TRNG_STS sayfasındaki sütun başlığı (kayıtlar buradan gelir)
 *   req      → REQ_TRNG sayfasında bu eğitimi anlatan adlar (yazım
 *              farklarıyla birlikte — "EASA/SHT PART-145" ile
 *              "EASA PART / SHT-145" aynı şey)
 *   cert     → CERTIFICATE sayfasındaki eğitim adları (244 sertifika
 *              bunlara göre yeni kursa bağlanır)
 *   old      → sistemdeki mevcut kurs başlığı (elle girilen 34 belgeli
 *              kayıt bunlara göre yeni kursa taşınır)
 *   years    → geçerlilik; null ise süresiz
 *
 * KONTROL EDİLECEK YERLERE "// ?" düşüldü.
 */

module.exports.SUBJECTS = [
  {
    subject: "SHT-145 / EASA Part-145",
    trng: "SHT-145",
    req: [
      "EASA/SHT PART-145",
      "EASA PART / SHT-145",
      "EASA PART/SHT-145",
      "EASA/SHY PART-145",
      "SHT-145/ EASA PART-145",
    ],
    cert: ["SHT-145 (INITIAL) TRAINING"],
    old: ["SHT-145 | Initial Training", "SHT-145 Training"],
    years: 2,
  },
  {
    subject: "Company Procedures (MOE)",
    trng: "MOE",
    req: ["Company Procedures (MOE)"],
    cert: ["MOE (Initial) Training"],
    old: ["Maintenance Organization Exposition (MOE) | Initial Training", "MOE Training"],
    years: 2,
  },
  {
    subject: "Human Factors",
    trng: "HF",
    req: ["Human Factors", "Human Factors (Module 9)"],
    cert: ["HUMAN FACTORS (INITIAL) TRAINING"],
    old: ["Human Factors | Initial Training"],
    years: 2,
  },
  {
    // Bon Air kuralı: Safety = SMS + HF. Eşdeğerlik sistemde zaten tanımlı,
    // yeniden kurulumda korunacak.
    subject: "Safety Training (incl. Human Factors)",
    trng: "SAFETY Training",
    req: [],
    cert: [
      "SAFETY TRAINING (INCLUDING HUMAN FACTORS) INITIAL",
      "Safety (including Human Factor)Training",
      "Safety (including Human Factor) Training",
    ],
    old: ["Safety Training (Include Human Factors) | Initial Training"],
    years: 2,
  },
  {
    subject: "Safety Management System (SMS)",
    trng: "SMS",
    req: [],
    cert: ["SMS/ SAFA-SANA-SACA Training"],
    old: ["Safety Management System (SMS) | Initial Training"],
    years: 2,
  },
  {
    subject: "EWIS",
    trng: "EWIS",
    req: ["EWIS", "EWIS."],
    cert: ["EWIS (Initial) Training"],
    old: ["Electrical Wiring Interconnection System | Initial Training"],
    years: 2,
  },
  {
    // ? Kâğıtta "Level 1", "Level 2", "Phase 1", "Phase 2" geçiyor ama
    //   TRNG_STS'te TEK sütun var ("FUEL TANK SAFETY"). Tek konu kabul
    //   edildi. Ayrı takip edilmesi gerekiyorsa söyle.
    subject: "Fuel Tank Safety",
    trng: "FUEL TANK SAFETY",
    req: ["Fuel Tank Safety Level 1", "Fuel Tank Safety Level 2", "Fuel Tank Safety Phase 1"],
    cert: ["Fuel Tank Safety (Initial) Training", "Fuel Tank Safety Phase 2 (Initial) Training"],
    old: ["Fuel Tank Safety Training (Phase 2) | Initial Training"],
    years: 2,
  },
  {
    subject: "Module 10",
    trng: "MODULE-10",
    req: [
      "SHY-M and SHT-66 / 147 (or Module 10 training)",
      "SHY-M and SHY-66 / 147 (or Module 10 training)",
    ],
    cert: [],
    old: [],
    years: 2,
  },
  {
    subject: "SHT-CAM / Part-M",
    trng: "SHT-CAM",
    req: ["EASA PART / SHT-M"],
    cert: ["SHT-CAM/PART-M (Initial) Training"],
    old: ["SHT-CAM | Initial Training", "SHT-CAM Training"],
    years: 2,
  },
  {
    subject: "SHT-66 / EASA Part-66",
    trng: "SHT-66",
    req: [],
    cert: ["SHT-66/EASA PART-66 (Initial) Training"],
    old: ["SHT-66 | Initial Training", "SHT-66 Training"],
    years: 2,
  },
  {
    // ? REQ_TRNG'de "Technical Changes" yazıyor, TRNG_STS'te "TECHNOLOGY
    //   UPDATE". Aynı şey kabul edildi.
    subject: "Technology Update",
    trng: "TECHNOLOGY UPDATE",
    req: ["Technical Changes"],
    cert: [],
    old: ["Technology Update | Initial Training"],
    years: 2,
  },
  {
    subject: "Incoming Inspection",
    trng: "INCOMING INSPECTION",
    req: ["Incoming Inspection"],
    cert: ["Incoming Inspection (Initial) Training"],
    old: ["Incoming Inspection | Initial Training"],
    years: 2,
  },
  {
    subject: "English Exam",
    trng: "ENGLISH EXAM",
    req: [],
    cert: [],
    old: ["English Exam"],
    years: 5,
  },
  {
    subject: "ATA Spec 300",
    trng: "ATA 300",
    req: ["ATA Spec 300"],
    cert: [],
    old: [],
    years: 2,
  },
  {
    subject: "Dangerous Goods Awareness",
    trng: "DGR AWARENESS",
    req: ["Dangerous good regulations"],
    cert: [],
    old: [],
    years: 2,
  },
  {
    subject: "ESD",
    trng: "ESD",
    req: ["ESD"],
    cert: [],
    old: [],
    years: 2,
  },
  {
    subject: "Hidden Damage Inspection",
    trng: "HIDDEN DAMAGE INSPECTION",
    req: ["Hidden Damage Inspection"],
    cert: [],
    old: [],
    years: 2,
  },
  {
    subject: "Tool Calibration",
    trng: "TOOL CALIBRATION",
    req: [],
    cert: [],
    old: [],
    years: 2,
  },
  {
    subject: "Train the Trainer",
    trng: "TRAIN TRAINER",
    req: ["Train The Trainer"],
    cert: [],
    old: ["Train The Trainer"],
    years: null, // ? kâğıtta süre yok — süresiz kabul edildi
  },
  {
    subject: "Basınçlı Tüp Eğitimi",
    trng: "BASINÇLI TÜP EĞİTİMİ",
    req: [],
    cert: [],
    old: [],
    years: 2,
  },
  {
    // TRNG_STS'te sütunu yok; gereklilik ve elle girilmiş kayıtlardan geliyor.
    subject: "Quality Systems",
    trng: null,
    req: ["Quality Systems"],
    cert: ["Compliance Monitoring & Quality Training"],
    old: ["Quality System Trainings"],
    years: 2,
  },
  {
    subject: "Audit Techniques",
    trng: null,
    req: ["Audit Techniques"],
    cert: [],
    old: ["Auditing Techniques or Auditor Training"],
    years: 2,
  },
  {
    subject: "NDT Training",
    trng: null,
    req: [],
    cert: [],
    old: ["NDT training on the related testing type", "NDT familiarization or NDT method training"],
    years: null,
  },
  {
    subject: "Aircraft Familiarization",
    trng: null,
    req: [],
    cert: [],
    old: ["Aircraft Familiarization Training"],
    years: null,
  },
];

/**
 * TRNG_STS'te EĞİTİM OLMAYAN sütunlar — içeri alınmıyor (kullanıcı kararı).
 * Bunlar yetki ve değerlendirme kayıtları; eğitim matrisine karıştırılmıyor.
 */
module.exports.SKIP_TRNG = [
  "COMPETENCE ASSESSMENT",
  "Mechanic Authorisation",
  "OJT ASSESSOR (B1.1/B2) BD-700 (RRD BR710)",
  "OJT SUPERVISOR (B1.1/B2) BD-700 (RRD BR710)",
  "OJT ASSESSOR (B1.1/B2) HAWKER 850 XP (HONEYWELL TFE731-5BR 1H))",
  "OJT SUPERVISOR (B1.1/B2) HAWKER 850 XP (HONEYWELL TFE731-5BR 1H))",
  "INSTRUCTOR AUTHORIZATION",
  "Authorisation Request and Assessment",
  "LICENCE EXPIRE DATE",
  "AUTHORIZATION EXPIRY DATE",
  "İLK YARDIM EĞİTİMİ", // hiç tarih girilmemiş
];

/**
 * REQ_TRNG kapsam adı → sistemdeki yetki kapsamı.
 * Sistemdeki 6 kapsam korunuyor; yalnızca gerekli eğitim listeleri
 * yenileniyor. Karşılığı olmayan MOE rolleri AÇILMIYOR — kimse onlara
 * bağlı değil, boş kapsam karışıklık yaratır.
 */
module.exports.SCOPES = {
  "Category B1, B2, A Certifying Staff": "Certifying Staff",
  Mechanics: "Mechanic Technician",
  "Technical Quality Manager (1.3.2.2)": "Technical Quality & Safety Engineer",
  "Incoming Inspector": null, // ? sistemde karşılığı yok
  "Engineering and Planning Manager": null, // ? sistemde karşılığı yok
  "Supply Manager (1.3.2.5)": null, // ? sistemde karşılığı yok
  "Instructor Traınıng 3.14.2": null, // ? sistemde karşılığı yok
};

/**
 * Sistemde olup REQ_TRNG'de karşılığı olmayan kapsamlar. Gerekli eğitim
 * listeleri OLDUĞU GİBİ bırakılır — kâğıtta tanımları yok, silmek 51 ve 2
 * kişinin gerekliliğini sıfırlardı.
 */
module.exports.KEEP_SCOPES = ["Technician", "NDT Staff", "Auditor"];

/**
 * CERTIFICATE sayfasındaki uçak tipi eğitimleri. Bunlar eğitim matrisine
 * değil, "Borescope & Run-Up" bölümüne ait — orada zaten motor/uçak tipi
 * kalemleri var. ? Nereye gitsinler, karar bekliyor.
 */
module.exports.AIRCRAFT_CERTS = [
  "Gulfstream GV-SP Series - RRD BR710 Engine RunUp Training",
  "Bombardier BD700 (RRD BR710) - Engine RunUp Training",
  "HAWKER Bae125 Series (Honeywell TFE731)  - Engine RunUp Training",
  "Gulfstream GIV-SP Series (RRD Tay) - Engine RunUp Training",
  "Embraer EMB 135-145 (RR Corp AE3007A) - Engine RunUp Training",
  "GLOBAL_ENGINE RUN-UP_TRAINING",
  "HS125 PRE&POST FLIGHT TRAINING",
  "Hawker 750 (HS125) PRE&POST FLIGHT TRAINING",
  "Gulfstream GIV PRE&POST FLIGHT TRAINING",
  "Challenger 300 (CL30) PRE&POST FLIGHT TRAINING",
  "CHALLENGER 300 (bd100) PRE&POST FLIGHT TRAINING",
  "CHALLENGER 300 BD100 PRE&POST FLIGHT TRAINING",
  "CL-604/605 PRE&POST FLIGHT TRAINING",
  "GLOBAL 5000 PRE-FLIGHT POST FLIGHT",
  "GLOBAL-5000 PRE&POST FLIGHT TRAINING",
  "TAP TEST (INITIAL) TRAINING", // Borescope bölümünde "Tap Test" olarak zaten var
];

/** REQ_TRNG'de geçip hiçbir konuya bağlanamayan ad. ? */
module.exports.UNMAPPED_REQ = ["Training on authorization subject course"];
