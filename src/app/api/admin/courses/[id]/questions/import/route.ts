import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

const MAX_EXCEL_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_QUESTION_TEXT = 2000;
const MAX_OPTION_TEXT = 500;

function isTrue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return ["1", "x", "true", "doğru", "dogru", "evet", "yes", "y"].includes(s);
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v !== null && "richText" in (v as any)) {
    return (v as any).richText.map((r: any) => r.text).join("");
  }
  if (typeof v === "object" && v !== null && "text" in (v as any)) {
    return String((v as any).text);
  }
  return String(v).trim();
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole("ADMIN", "MANAGER");
  const { id: courseId } = await params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Dosya gerekli" }, { status: 400 });
  }
  if (file.size > MAX_EXCEL_BYTES) {
    return NextResponse.json(
      { error: `Dosya çok büyük (maks ${Math.round(MAX_EXCEL_BYTES / 1024 / 1024)} MB)` },
      { status: 413 }
    );
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.getWorksheet("Sorular") ?? wb.worksheets[0];
  if (!ws) return NextResponse.json({ error: "Sayfa bulunamadı" }, { status: 400 });

  const bank = await prisma.questionBank.upsert({
    where: { courseId },
    update: {},
    create: { courseId },
  });
  // Sınav kaydı yoksa varsayılanlarla oluştur — toplu yükleme sonrası kurs
  // hemen sınava hazır olsun.
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { passingScore: true },
  });
  await prisma.exam.upsert({
    where: { courseId },
    update: {},
    create: {
      courseId,
      questionCount: 10,
      passingScore: course?.passingScore ?? 70,
    },
  });

  const results = { created: 0, skipped: 0, errors: [] as string[] };

  const rowCount = ws.rowCount;
  for (let i = 2; i <= rowCount; i++) {
    const row = ws.getRow(i);
    const rawText = cellText(row.getCell(1).value);
    if (!rawText) {
      results.skipped++;
      continue;
    }
    const text = rawText.slice(0, MAX_QUESTION_TEXT);
    const rawPoints = Number(row.getCell(2).value);
    const points = Number.isFinite(rawPoints) && rawPoints > 0
      ? Math.min(Math.floor(rawPoints), 100)
      : 1;
    const options = [
      { text: cellText(row.getCell(3).value), isCorrect: isTrue(row.getCell(4).value) },
      { text: cellText(row.getCell(5).value), isCorrect: isTrue(row.getCell(6).value) },
      { text: cellText(row.getCell(7).value), isCorrect: isTrue(row.getCell(8).value) },
      { text: cellText(row.getCell(9).value), isCorrect: isTrue(row.getCell(10).value) },
    ]
      .map((o) => ({ text: o.text.slice(0, MAX_OPTION_TEXT), isCorrect: o.isCorrect }))
      .filter((o) => o.text);

    if (options.length < 2) {
      results.errors.push(`Satır ${i}: en az 2 şık gerekli`);
      continue;
    }
    if (!options.some((o) => o.isCorrect)) {
      results.errors.push(`Satır ${i}: en az 1 doğru şık gerekli`);
      continue;
    }

    await prisma.question.create({
      data: {
        bankId: bank.id,
        text,
        points,
        options: { create: options },
      },
    });
    results.created++;
  }

  return NextResponse.json(results);
}
