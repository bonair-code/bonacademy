import * as XLSX from "xlsx";

/**
 * Geçmiş sertifikaların Excel şablonu ve okuyucusu.
 * Sütun adları BonAir'in kâğıt sicilindekiyle birebir aynı — mevcut dosyadan
 * kopyala-yapıştır yapılabilsin diye.
 */

const HEADERS = [
  "Certificate no",
  "Name & Surname",
  "Email",
  "Birth Place",
  "Birth Date",
  "Training Name",
  "Instructor",
  "Duration",
  "Training Start",
  "Training Finish",
  "Certificate date",
  "Location",
] as const;

const SHEET = "Certificates";
const SHEET_HELP = "How to use";

export type ParsedCert = {
  row: number;
  serialNo: string;
  name: string;
  email: string | null;
  birthPlace: string | null;
  birthDate: string | null; // YYYY-MM-DD
  courseTitle: string;
  instructorName: string | null;
  durationHours: number | null;
  startedAt: string | null; // ISO
  completedAt: string | null;
  issuedAt: string | null;
  /** Eğitimin verildiği yer. Boşsa sertifikada yer iddiası yazılmaz. */
  location: string | null;
};

export type CertParseResult = {
  sheetName: string;
  rows: ParsedCert[];
  errors: { row: number; message: string }[];
};

/** Excel seri tarihi ya da metin → YYYY-MM-DD. */
function toISODate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return fmt(v);
  if (typeof v === "number") {
    // Excel seri numarası (1900 tabanlı).
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : fmt(d);
  }
  const s = String(v).trim();
  if (!s) return null;
  // gg.aa.yyyy · gg/aa/yyyy · yyyy-aa-gg
  const dot = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dot) return `${dot[3]}-${dot[2].padStart(2, "0")}-${dot[1].padStart(2, "0")}`;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : fmt(d);
}
const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "8 Hours" → 8 · "6" → 6 · boş → null */
function toHours(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const m = String(v).match(/[\d.,]+/);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return isNaN(n) ? null : n;
}

export function downloadCertTemplate(courseTitles: string[]) {
  const wb = XLSX.utils.book_new();

  const example = [
    HEADERS as unknown as string[],
    [
      "26-001",
      "OĞUZ KAAN ALPAYDIN",
      "oalpaydin@bonair.com.tr",
      "İSTANBUL",
      "23.10.2007",
      courseTitles[0] ?? "Fuel Tank Safety Training (Phase 2) | Initial Training",
      "Cevdet Berkan ÖZBAY",
      "8 Hours",
      "19.09.2025",
      "19.09.2025",
      "19.09.2025",
      "İSTANBUL",
    ],
  ];
  const ws = XLSX.utils.aoa_to_sheet(example);
  ws["!cols"] = [
    { wch: 14 },
    { wch: 26 },
    { wch: 28 },
    { wch: 14 },
    { wch: 12 },
    { wch: 44 },
    { wch: 22 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, SHEET);

  const help = [
    ["How to import past certificates"],
    [""],
    ['1. Fill the "Certificates" sheet — one certificate per row. Delete the example row.'],
    ["2. Certificate no and Certificate date are required."],
    ["3. Email is optional but matches the person reliably; without it the full name is used."],
    ["4. Training Name must match a course in the system exactly, or the record will not"],
    ["   close that person's training gap. Valid names are on the next sheet."],
    ["5. Dates: gg.aa.yyyy or yyyy-aa-gg. Duration: a number, or text like “8 Hours”."],
    ["6. Re-uploading the same file does not duplicate — the certificate number is the key."],
    ["7. After importing, new certificates continue from the highest number in the file."],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(help), SHEET_HELP);

  const list = [["Training names in the system"], ...courseTitles.map((t) => [t])];
  const lws = XLSX.utils.aoa_to_sheet(list);
  lws["!cols"] = [{ wch: 60 }];
  XLSX.utils.book_append_sheet(wb, lws, "Valid Trainings");

  XLSX.writeFile(wb, "bonacademy-certificates-template.xlsx");
}

export async function parseCertWorkbook(file: File): Promise<CertParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const sheetName = wb.SheetNames.includes(SHEET) ? SHEET : wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
    defval: "",
  });

  const rows: ParsedCert[] = [];
  const errors: { row: number; message: string }[] = [];

  raw.forEach((r, i) => {
    const line = i + 2; // başlık satırı + 1
    const serialNo = String(r["Certificate no"] ?? "").trim();
    const name = String(r["Name & Surname"] ?? "").trim();
    if (!serialNo && !name) return; // boş satır
    if (!serialNo) {
      errors.push({ row: line, message: "Certificate no is empty." });
      return;
    }
    const issuedAt = toISODate(r["Certificate date"]);
    const completedAt = toISODate(r["Training Finish"]);
    if (!issuedAt && !completedAt) {
      errors.push({ row: line, message: `${serialNo}: no Certificate date or Training Finish.` });
      return;
    }
    rows.push({
      row: line,
      serialNo,
      name,
      email: String(r["Email"] ?? "").trim() || null,
      birthPlace: String(r["Birth Place"] ?? "").trim() || null,
      birthDate: toISODate(r["Birth Date"]),
      courseTitle: String(r["Training Name"] ?? "").trim(),
      instructorName: String(r["Instructor"] ?? "").trim() || null,
      durationHours: toHours(r["Duration"]),
      startedAt: toISODate(r["Training Start"]),
      completedAt,
      issuedAt: issuedAt ?? completedAt,
      location: String(r["Location"] ?? "").trim() || null,
    });
  });

  // Aynı dosyada mükerrer numara varsa şimdiden söyle.
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.serialNo))
      errors.push({ row: r.row, message: `${r.serialNo}: duplicate number in this file.` });
    seen.add(r.serialNo);
  }

  return { sheetName, rows, errors };
}
