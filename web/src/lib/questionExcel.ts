import * as XLSX from "xlsx";

/** Şablondaki seçenek sütunları. A–E arası; hepsi dolu olmak zorunda değil. */
export const OPTION_LETTERS = ["A", "B", "C", "D", "E"] as const;
export type OptionLetter = (typeof OPTION_LETTERS)[number];

// Puan sütunu yok: her soru eşit ağırlıkta ve değeri Exam Settings'teki soru
// sayısından türetiliyor.
const HEADERS = ["Question", ...OPTION_LETTERS.map((l) => `Option ${l}`), "Correct"];

/** İçe aktarılan soru satırı — Firestore'a yazılmadan önceki ara biçim. */
export type ParsedQuestion = {
  text: string;
  points: number;
  options: { text: string; isCorrect: boolean }[];
};

export type RowError = { row: number; message: string };

export type ParseResult = {
  questions: ParsedQuestion[];
  errors: RowError[];
  /** Okunan sayfanın adı — yanlış sayfayı doldurduysa kullanıcı anlasın. */
  sheetName: string;
};

const SHEET_QUESTIONS = "Questions";
const SHEET_EXAMPLE = "Example";
const SHEET_HELP = "How to use";

/**
 * Boş şablonu indirir. Doldurulacak sayfa boş bırakılır; örnekler ve açıklama
 * ayrı sayfalarda durur ki yanlışlıkla örnek satırlar içe aktarılmasın.
 */
export function downloadTemplate(courseTitle: string) {
  const wb = XLSX.utils.book_new();

  const questions = XLSX.utils.aoa_to_sheet([HEADERS]);
  questions["!cols"] = [{ wch: 60 }, ...OPTION_LETTERS.map(() => ({ wch: 28 })), { wch: 10 }];
  questions["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, questions, SHEET_QUESTIONS);

  const example = XLSX.utils.aoa_to_sheet([
    HEADERS,
    [
      "Which document certifies that a part is airworthy?",
      "EASA Form 1",
      "EASA Form 4",
      "Form 19",
      "Form 145",
      "",
      "A",
    ],
    [
      "What is the minimum crew rest period after a duty day?",
      "8 hours",
      "10 hours",
      "12 hours",
      "",
      "",
      "C",
    ],
  ]);
  example["!cols"] = questions["!cols"];
  XLSX.utils.book_append_sheet(wb, example, SHEET_EXAMPLE);

  const help = XLSX.utils.aoa_to_sheet([
    ["How to use this template"],
    [""],
    [`1. Fill in the "${SHEET_QUESTIONS}" sheet — one question per row.`],
    ["2. Question is required."],
    ["3. Fill at least two options. Option C, D and E are optional."],
    ["4. Correct holds the letter of the right option: A, B, C, D or E."],
    ["5. The letter in Correct must point to an option you actually filled."],
    [`6. Do not rename the "${SHEET_QUESTIONS}" sheet or its header row.`],
    [`7. The "${SHEET_EXAMPLE}" sheet is ignored on import — it is only a reference.`],
    [""],
    ["There is no Points column. The exam is scored out of 100 and every question"],
    ["carries equal weight, so each question's value comes from the question count"],
    ["you set under Exam Settings — 10 questions means 10 points each."],
    [""],
    ["Upload the saved file from the same place you downloaded this template."],
  ]);
  help["!cols"] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, help, SHEET_HELP);

  const safe = courseTitle.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "course";
  XLSX.writeFile(wb, `question-bank-${safe}.xlsx`);
}

/** Yüklenen dosyayı okur ve satır satır doğrular. */
export async function parseWorkbook(file: File, pointsPer: number): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const sheetName = wb.SheetNames.includes(SHEET_QUESTIONS)
    ? SHEET_QUESTIONS
    : wb.SheetNames.find((n) => n !== SHEET_EXAMPLE && n !== SHEET_HELP) ?? wb.SheetNames[0];

  const sheet = wb.Sheets[sheetName];
  if (!sheet) return { questions: [], errors: [{ row: 0, message: "The file has no sheets." }], sheetName: "" };

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const questions: ParsedQuestion[] = [];
  const errors: RowError[] = [];

  rows.forEach((raw, i) => {
    // Başlık satırı 1 olduğu için veri satırları 2'den başlar.
    const rowNo = i + 2;
    const text = String(raw["Question"] ?? "").trim();
    const correctRaw = String(raw["Correct"] ?? "").trim().toUpperCase();

    // Tamamen boş satırları sessizce atla — Excel sonunda sık görülür.
    const anyOption = OPTION_LETTERS.some((l) => String(raw[`Option ${l}`] ?? "").trim());
    if (!text && !correctRaw && !anyOption) return;

    if (!text) {
      errors.push({ row: rowNo, message: "Question is empty." });
      return;
    }

    const filled = OPTION_LETTERS.map((l) => ({
      letter: l,
      text: String(raw[`Option ${l}`] ?? "").trim(),
    })).filter((o) => o.text);

    if (filled.length < 2) {
      errors.push({ row: rowNo, message: "Needs at least two options." });
      return;
    }
    if (!correctRaw) {
      errors.push({ row: rowNo, message: "Correct is empty — enter A, B, C, D or E." });
      return;
    }
    if (!OPTION_LETTERS.includes(correctRaw as OptionLetter)) {
      errors.push({ row: rowNo, message: `Correct is "${correctRaw}" — use A, B, C, D or E.` });
      return;
    }
    if (!filled.some((o) => o.letter === correctRaw)) {
      errors.push({ row: rowNo, message: `Correct points to ${correctRaw}, but Option ${correctRaw} is empty.` });
      return;
    }

    questions.push({
      text,
      points: pointsPer,
      options: filled.map((o) => ({ text: o.text, isCorrect: o.letter === correctRaw })),
    });
  });

  return { questions, errors, sheetName };
}
