import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import type { Role } from "@prisma/client";
import { audit } from "@/lib/audit";
import { createPasswordToken } from "@/lib/passwordTokens";
import { sendInviteEmail } from "@/lib/notifications/mailer";
import { flashToast } from "@/lib/flash";

export const runtime = "nodejs";

// CSV başlığı (büyük/küçük harf duyarsız):
//   email, name, role, department, jobTitles, managerEmail
// - role: USER | MANAGER (boş → USER)
// - department: ad. Yoksa otomatik oluşturulur.
// - jobTitles: noktalı virgülle ayrılmış (örn. "Pilot; Eğitmen"). Yoksa oluşturulur.
// - managerEmail: opsiyonel. CSV içinde MANAGER olarak tanımlı bir email olabilir
//   (2-pass: önce tüm satırlar yaratılır, sonra manager bağları kurulur).

const MAX_BYTES = 1 * 1024 * 1024; // 1 MB
const VALID_ROLES: Role[] = ["USER", "MANAGER"];

type Row = {
  lineNo: number;
  email: string;
  name: string;
  role: Role;
  department: string;
  jobTitles: string[];
  managerEmail: string | null;
};

// Basit CSV parser — tırnaklı virgülleri destekler. Satır sonları \n veya \r\n.
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        cell = "";
        out.push(row);
        row = [];
      } else {
        cell += ch;
      }
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out.filter((r) => r.some((c) => c.trim().length));
}

export async function POST(req: NextRequest) {
  const admin = await requireRole("ADMIN");

  const form = await req.formData();
  const file = form.get("file");
  const sendInvitesRaw = String(form.get("sendInvites") || "");
  const sendInvites = sendInvitesRaw === "on" || sendInvitesRaw === "true";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "CSV dosyası gerekli" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Dosya çok büyük (maks ${Math.round(MAX_BYTES / 1024)} KB)` },
      { status: 413 }
    );
  }

  const text = await file.text();
  const grid = parseCsv(text);
  if (grid.length < 2) {
    return NextResponse.json(
      { error: "CSV en az başlık + 1 satır içermeli" },
      { status: 400 }
    );
  }

  const header = grid[0]!.map((c) => c.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iEmail = idx("email");
  const iName = idx("name");
  const iRole = idx("role");
  const iDept = idx("department");
  const iJobs = idx("jobtitles");
  const iMgr = idx("manageremail");

  if (iEmail < 0 || iName < 0) {
    return NextResponse.json(
      { error: "Başlık satırında en az 'email' ve 'name' bulunmalı" },
      { status: 400 }
    );
  }

  const rows: Row[] = [];
  const errors: string[] = [];
  const seenEmails = new Set<string>();
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i]!;
    const lineNo = i + 1;
    const email = (r[iEmail] || "").trim().toLowerCase();
    const name = (r[iName] || "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Satır ${lineNo}: geçersiz e-posta "${email}"`);
      continue;
    }
    if (!name) {
      errors.push(`Satır ${lineNo}: ad boş olamaz`);
      continue;
    }
    if (seenEmails.has(email)) {
      errors.push(`Satır ${lineNo}: aynı e-posta CSV içinde tekrar etti`);
      continue;
    }
    seenEmails.add(email);
    const roleRaw = iRole >= 0 ? (r[iRole] || "").trim().toUpperCase() : "";
    const role = (VALID_ROLES as string[]).includes(roleRaw)
      ? (roleRaw as Role)
      : ("USER" as Role);
    rows.push({
      lineNo,
      email,
      name,
      role,
      department: iDept >= 0 ? (r[iDept] || "").trim() : "",
      jobTitles:
        iJobs >= 0
          ? (r[iJobs] || "")
              .split(";")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      managerEmail:
        iMgr >= 0 ? (r[iMgr] || "").trim().toLowerCase() || null : null,
    });
  }

  // ---- PASS 1: department & jobTitle cache + user upsert ----
  const deptCache = new Map<string, string>();
  const jobCache = new Map<string, string>();

  async function resolveDept(name: string): Promise<string | null> {
    if (!name) return null;
    const key = name.toLowerCase();
    if (deptCache.has(key)) return deptCache.get(key)!;
    const dep = await prisma.department.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    deptCache.set(key, dep.id);
    return dep.id;
  }

  async function resolveJob(name: string): Promise<string> {
    const key = name.toLowerCase();
    if (jobCache.has(key)) return jobCache.get(key)!;
    const j = await prisma.jobTitle.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    jobCache.set(key, j.id);
    return j.id;
  }

  let created = 0;
  let updated = 0;
  const userIdsByEmail = new Map<string, string>();
  const newlyCreatedIds: string[] = [];

  for (const row of rows) {
    try {
      const departmentId = await resolveDept(row.department);
      const jobIds = await Promise.all(row.jobTitles.map(resolveJob));

      const existing = await prisma.user.findUnique({
        where: { email: row.email },
        select: { id: true, role: true },
      });

      if (existing) {
        // Upsert davranışı: ad/rol/departman/job-title güncellenir, şifre dokunulmaz.
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            name: row.name,
            role: row.role,
            departmentId,
          },
        });
        // jobTitles bağlarını yeniden kur (eskileri sil + yenileri ekle).
        await prisma.userJobTitle.deleteMany({ where: { userId: existing.id } });
        if (jobIds.length) {
          await prisma.userJobTitle.createMany({
            data: jobIds.map((jid) => ({ userId: existing.id, jobTitleId: jid })),
          });
        }
        userIdsByEmail.set(row.email, existing.id);
        updated++;
      } else {
        const u = await prisma.user.create({
          data: {
            email: row.email,
            name: row.name,
            role: row.role,
            departmentId,
            isActive: true,
            jobTitles: jobIds.length
              ? { create: jobIds.map((jid) => ({ jobTitleId: jid })) }
              : undefined,
          },
        });
        userIdsByEmail.set(row.email, u.id);
        newlyCreatedIds.push(u.id);
        created++;
      }
    } catch (e) {
      errors.push(`Satır ${row.lineNo} (${row.email}): ${(e as Error).message}`);
    }
  }

  // ---- PASS 2: managerEmail bağları ----
  for (const row of rows) {
    if (!row.managerEmail) continue;
    const userId = userIdsByEmail.get(row.email);
    if (!userId) continue;
    let managerId = userIdsByEmail.get(row.managerEmail);
    if (!managerId) {
      const m = await prisma.user.findUnique({
        where: { email: row.managerEmail },
        select: { id: true, role: true },
      });
      if (!m) {
        errors.push(
          `Satır ${row.lineNo} (${row.email}): yönetici bulunamadı (${row.managerEmail})`
        );
        continue;
      }
      if (m.role !== "MANAGER" && m.role !== "ADMIN") {
        errors.push(
          `Satır ${row.lineNo} (${row.email}): "${row.managerEmail}" MANAGER değil`
        );
        continue;
      }
      managerId = m.id;
    }
    if (managerId === userId) {
      errors.push(`Satır ${row.lineNo} (${row.email}): kendisi kendi yöneticisi olamaz`);
      continue;
    }
    await prisma.user.update({
      where: { id: userId },
      data: { managerId },
    });
  }

  // ---- Davet maili (yalnızca yeni oluşturulanlara, opsiyonel) ----
  let invitesSent = 0;
  if (sendInvites && newlyCreatedIds.length) {
    const fresh = await prisma.user.findMany({
      where: { id: { in: newlyCreatedIds } },
      select: { id: true, email: true, name: true, locale: true },
    });
    for (const u of fresh) {
      try {
        const token = await createPasswordToken(u.id, "INVITE");
        await sendInviteEmail(u.email, u.name, token, u.locale);
        invitesSent++;
      } catch (e) {
        errors.push(`Davet (${u.email}): ${(e as Error).message}`);
      }
    }
  }

  await audit({
    actorId: admin.id,
    action: "user.create",
    entity: "User",
    entityId: "bulk",
    metadata: {
      created,
      updated,
      invitesSent,
      errorCount: errors.length,
      source: "bulk-import",
    },
  });

  await flashToast(created || updated ? "added" : "error");

  return NextResponse.json({
    ok: true,
    created,
    updated,
    invitesSent,
    errors,
  });
}
