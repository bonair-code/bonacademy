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
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

// Denetim kayıtlarını Excel olarak dışa aktarır. /admin/audit sayfasındaki
// filtreler aynen query'den alınır, böylece admin ekranda filtrelediğini
// indirebilir. ISO/iç denetim için "kanıt dosyası" olarak istenir.
export async function GET(req: NextRequest) {
  await requireRole("ADMIN");
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
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
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
