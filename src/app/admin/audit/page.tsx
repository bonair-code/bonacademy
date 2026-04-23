import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { fmtTrDateTime } from "@/lib/dates";
import {
  auditActionLabel,
  auditEntityLabel,
  ALL_AUDIT_ACTIONS,
  ALL_AUDIT_ENTITIES,
} from "@/lib/auditLabels";
import { parseFilterDate } from "@/lib/audit-filters";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// Denetim sayfası — tüm admin eylemlerini kronolojik gösterir. Filtreler GET
// query param üzerinden akar; böylece URL'i paylaştığında aynı görünümü
// açabilirsin.
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    entity?: string;
    entityId?: string;
    action?: string;
    actorId?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const user = await requireRole("ADMIN");
  const sp = await searchParams;

  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const where: Prisma.AuditLogWhereInput = {};
  if (sp.entity && ALL_AUDIT_ENTITIES.includes(sp.entity)) where.entity = sp.entity;
  if (sp.entityId) where.entityId = sp.entityId;
  if (sp.action && ALL_AUDIT_ACTIONS.includes(sp.action)) where.action = sp.action;
  if (sp.actorId) where.actorId = sp.actorId;
  const fromDate = parseFilterDate(sp.from, "start");
  const toDate = parseFilterDate(sp.to, "end");
  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) where.createdAt.gte = fromDate;
    if (toDate) where.createdAt.lte = toDate;
  }

  const [rows, total, actors] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: { actor: { select: { id: true, name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
    // Filtre için aktif admin/manager'lar — tüm kullanıcı listesini çekmek
    // gereksiz, sadece geçmişte log yazmış olanlar.
    prisma.user.findMany({
      where: { role: { in: ["ADMIN", "MANAGER"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const exportQs = new URLSearchParams();
  if (sp.entity) exportQs.set("entity", sp.entity);
  if (sp.entityId) exportQs.set("entityId", sp.entityId);
  if (sp.action) exportQs.set("action", sp.action);
  if (sp.actorId) exportQs.set("actorId", sp.actorId);
  if (sp.from) exportQs.set("from", sp.from);
  if (sp.to) exportQs.set("to", sp.to);

  return (
    <Shell
      user={user}
      title="Denetim Kayıtları"
      subtitle="Admin eylemlerinin kronolojik izi"
    >
      {/* Filtre formu */}
      <form
        method="get"
        className="card p-4 mb-4 grid md:grid-cols-6 gap-3 text-sm"
      >
        <label className="block">
          <span className="block text-slate-600 mb-1 text-xs">Varlık</span>
          <select name="entity" defaultValue={sp.entity ?? ""} className="input w-full">
            <option value="">Hepsi</option>
            {ALL_AUDIT_ENTITIES.map((e) => (
              <option key={e} value={e}>
                {auditEntityLabel(e)}
              </option>
            ))}
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="block text-slate-600 mb-1 text-xs">Eylem</span>
          <select name="action" defaultValue={sp.action ?? ""} className="input w-full">
            <option value="">Hepsi</option>
            {ALL_AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {auditActionLabel(a)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-slate-600 mb-1 text-xs">Aktör</span>
          <select name="actorId" defaultValue={sp.actorId ?? ""} className="input w-full">
            <option value="">Hepsi</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-slate-600 mb-1 text-xs">Başlangıç</span>
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="input w-full" />
        </label>
        <label className="block">
          <span className="block text-slate-600 mb-1 text-xs">Bitiş</span>
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="input w-full" />
        </label>
        <div className="md:col-span-6 flex items-center gap-2">
          <button type="submit" className="btn-primary text-sm">
            Filtrele
          </button>
          <a href="/admin/audit" className="btn-secondary text-sm">
            Temizle
          </a>
          <div className="flex-1" />
          <a
            href={`/api/admin/audit/export${exportQs.toString() ? `?${exportQs.toString()}` : ""}`}
            className="btn-secondary text-sm"
          >
            Excel olarak indir
          </a>
        </div>
      </form>

      <div className="text-xs text-slate-500 mb-2">
        Toplam: <b>{total}</b> kayıt · Sayfa {page}/{totalPages}
        {sp.entityId && (
          <span className="ml-2">
            · Tek kayda filtrelendi (<code className="text-[10px]">{sp.entityId}</code>)
          </span>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left p-3 font-medium">Zaman</th>
              <th className="text-left p-3 font-medium">Aktör</th>
              <th className="text-left p-3 font-medium">Eylem</th>
              <th className="text-left p-3 font-medium">Varlık</th>
              <th className="text-left p-3 font-medium">Kimlik</th>
              <th className="text-left p-3 font-medium">Detay</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">
                  Kayıt bulunamadı.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50 align-top">
                <td className="p-3 whitespace-nowrap text-slate-700">
                  {fmtTrDateTime(r.createdAt)}
                </td>
                <td className="p-3">
                  {r.actor ? (
                    <span>
                      {r.actor.name}
                      <span className="block text-[11px] text-slate-500">
                        {r.actor.email}
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-400 italic">silinmiş kullanıcı</span>
                  )}
                </td>
                <td className="p-3">{auditActionLabel(r.action)}</td>
                <td className="p-3">{auditEntityLabel(r.entity)}</td>
                <td className="p-3 font-mono text-[11px] text-slate-600 break-all">
                  {r.entityId}
                </td>
                <td className="p-3 max-w-xs">
                  {r.metadata ? (
                    <details>
                      <summary className="text-xs text-sky-700 cursor-pointer">
                        göster
                      </summary>
                      <pre className="text-[10px] bg-slate-50 p-2 rounded mt-1 whitespace-pre-wrap break-all">
                        {JSON.stringify(r.metadata, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sayfalama */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 mt-4 text-sm">
          {page > 1 && (
            <a
              href={buildPageHref(sp, page - 1)}
              className="btn-secondary text-xs"
            >
              ← Önceki
            </a>
          )}
          <span className="text-xs text-slate-500">
            Sayfa {page} / {totalPages}
          </span>
          {page < totalPages && (
            <a
              href={buildPageHref(sp, page + 1)}
              className="btn-secondary text-xs"
            >
              Sonraki →
            </a>
          )}
        </div>
      )}
    </Shell>
  );
}

function buildPageHref(
  sp: { entity?: string; entityId?: string; action?: string; actorId?: string; from?: string; to?: string },
  page: number
): string {
  const qs = new URLSearchParams();
  if (sp.entity) qs.set("entity", sp.entity);
  if (sp.entityId) qs.set("entityId", sp.entityId);
  if (sp.action) qs.set("action", sp.action);
  if (sp.actorId) qs.set("actorId", sp.actorId);
  if (sp.from) qs.set("from", sp.from);
  if (sp.to) qs.set("to", sp.to);
  qs.set("page", String(page));
  return `/admin/audit?${qs.toString()}`;
}
