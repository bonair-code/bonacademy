import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import ExcelJS from "exceljs";
import { fmtTrDateTime } from "@/lib/dates";
import {
  auditActionLabel,
  auditEntityLabel,
  ALL_AUDIT_ACTIONS,
  ALL_AUDIT_ENTITIES,
} from "@/lib/auditLabels";
import { rateLimit } from "@/lib/rateLimit";
import { parseFilterDate } from "@/lib/audit-filters";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

// Denetim kayıtlarını Excel olarak dışa aktarır. /admin/audit sayfasındaki
// filtreler aynen query'den alınır, böylece admin ekranda filtrelediğini
// indirebilir. ISO/iç denetim için "kanıt dosyası" olarak istenir.
export async function GET(req: NextRequest) {
  const user = await requireRole("ADMIN");

  // CSRF sertleştirme: tarayıcıdan gelen cross-site GET'i engelle. Aynı
  // origin'den tetiklendiğinden emin olmak için Origin/Referer kontrolü
  // yapıyoruz; curl/Postman gibi header göndermeyen istekler serverside
  // yine çalışır ama kullanıcı oturumu da gerekmeyeceği için risk yok.
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== req.nextUrl.host) {
        return NextResponse.json({ error: "Yetkisiz kaynak" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Geçersiz kaynak" }, { status: 403 });
    }
  }

  // Admin başına 5 dk'da 10 export. Bellek-yoğun bir endpoint — hatalı
  // script veya kötü niyetli bir oturumun tekrar tekrar 10k satır çekmesini
  // engeller.
  const rl = rateLimit(`audit-export:${user.id}`, 10, 5 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Çok fazla istek, lütfen daha sonra tekrar deneyin." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

  const sp = new URL(req.url).searchParams;

  const where: Prisma.AuditLogWhereInput = {};
  const entity = sp.get("entity");
  const entityId = sp.get("entityId");
  const action = sp.get("action");
  const actorId = sp.get("actorId");
  const from = sp.get("from");
  const to = sp.get("to");
  if (entity && ALL_AUDIT_ENTITIES.includes(entity)) where.entity = entity;
  if (entityId) where.entityId = entityId;
  if (action && ALL_AUDIT_ACTIONS.includes(action)) where.action = action;
  if (actorId) where.actorId = actorId;
  const fromDate = parseFilterDate(from, "start");
  const toDate = parseFilterDate(to, "end");
  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) where.createdAt.gte = fromDate;
    if (toDate) where.createdAt.lte = toDate;
  }

  // Üst sınır: 10k satır. Daha fazlası denetim ekranında gerekirse tarih
  // aralığı daraltmak daha mantıklı — tek bir Excel'e 50k satır koymak
  // hem bellek hem kullanıcı için kötü.
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 10_000,
    include: { actor: { select: { name: true, email: true } } },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "BonAcademy";
  wb.created = new Date();
  const ws = wb.addWorksheet("Denetim", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = [
    { header: "Zaman", key: "at", width: 20 },
    { header: "Aktör", key: "actor", width: 24 },
    { header: "Aktör E-posta", key: "email", width: 28 },
    { header: "Eylem", key: "action", width: 28 },
    { header: "Eylem Kodu", key: "actionCode", width: 24 },
    { header: "Varlık", key: "entity", width: 14 },
    { header: "Kimlik", key: "entityId", width: 28 },
    { header: "Detay (JSON)", key: "meta", width: 60 },
  ];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F172A" },
  };

  for (const r of rows) {
    ws.addRow({
      at: fmtTrDateTime(r.createdAt),
      actor: r.actor?.name ?? "(silinmiş)",
      email: r.actor?.email ?? "",
      action: auditActionLabel(r.action),
      actionCode: r.action,
      entity: auditEntityLabel(r.entity),
      entityId: r.entityId,
      meta: r.metadata ? JSON.stringify(r.metadata) : "",
    });
  }
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ws.columns.length },
  };

  const buf = await wb.xlsx.writeBuffer();
  const ymd = new Date().toISOString().slice(0, 10);
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="denetim-${ymd}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
