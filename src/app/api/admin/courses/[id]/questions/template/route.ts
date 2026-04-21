import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

/**
 * Downloads an XLSX template for bulk question import.
 * Columns: Soru | Puan | Şık1 | Doğru1 | Şık2 | Doğru2 | Şık3 | Doğru3 | Şık4 | Doğru4
 * "Doğru" kolonuna 1/0 veya X / boş yazılır.
 */
export async function GET() {
  await requireRole("ADMIN");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sorular");
  ws.columns = [
    { header: "Soru", key: "q", width: 50 },
    { header: "Puan", key: "p", width: 8 },
    { header: "Şık1", key: "o1", width: 25 },
    { header: "Doğru1", key: "c1", width: 8 },
    { header: "Şık2", key: "o2", width: 25 },
    { header: "Doğru2", key: "c2", width: 8 },
    { header: "Şık3", key: "o3", width: 25 },
    { header: "Doğru3", key: "c3", width: 8 },
    { header: "Şık4", key: "o4", width: 25 },
    { header: "Doğru4", key: "c4", width: 8 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };
  ws.addRow({
    q: "SCORM nedir?",
    p: 1,
    o1: "Bir e-öğrenme standardı",
    c1: 1,
    o2: "Bir programlama dili",
    c2: 0,
    o3: "Bir veritabanı",
    c3: 0,
    o4: "Bir işletim sistemi",
    c4: 0,
  });
  ws.addRow({
    q: "Aşağıdakilerden hangisi/hangileri uçuş öncesi kontroldür? (çoklu doğru olabilir)",
    p: 1,
    o1: "Yakıt kontrolü",
    c1: 1,
    o2: "Kabin hazırlığı",
    c2: 1,
    o3: "Yolcu yemeği",
    c3: 0,
    o4: "Mürettebat brifingi",
    c4: 1,
  });

  const notes = wb.addWorksheet("Açıklama");
  notes.columns = [{ header: "Açıklama", key: "t", width: 100 }];
  notes.getRow(1).font = { bold: true };
  [
    "Her satır bir soruya karşılık gelir.",
    "Puan boş bırakılırsa 1 kabul edilir.",
    "Şık1–Şık4 arası en az 2 şık doldurulmalıdır. Boş şıklar dikkate alınmaz.",
    "Doğru sütunlarına doğru şık için 1 / X / DOĞRU yazın; yanlış için boş bırakın veya 0 yazın.",
    "Birden fazla doğru şık olabilir (çoktan seçmeli).",
    "İlk satır başlık satırıdır; silmeyin.",
  ].forEach((t) => notes.addRow({ t }));

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as Buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="soru-bankasi-sablon.xlsx"`,
    },
  });
}
