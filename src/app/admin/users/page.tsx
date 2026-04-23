import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { enrollUserIntoJobTitlePlans } from "@/lib/scheduler/assignments";
import { hashPassword, validatePasswordStrength } from "@/lib/password";

async function upsertUser(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const id = String(formData.get("id") || "");
  const email = String(formData.get("email")).trim().toLowerCase();
  const name = String(formData.get("name")).trim();
  const role = String(formData.get("role")) as Role;
  const departmentId = String(formData.get("departmentId") || "") || null;
  const managerIdRaw = String(formData.get("managerId") || "") || null;
  // Kendini yönetici olarak atamaya izin verme.
  const managerId = managerIdRaw && managerIdRaw !== id ? managerIdRaw : null;
  const jobTitleIds = formData.getAll("jobTitleIds").map(String).filter(Boolean);
  const password = String(formData.get("password") || "");

  let passwordHash: string | undefined;
  if (password) {
    const err = validatePasswordStrength(password);
    if (err) throw new Error(err);
    passwordHash = await hashPassword(password);
  }

  const user = id
    ? await prisma.user.update({
        where: { id },
        data: {
          email,
          name,
          role,
          departmentId,
          managerId,
          ...(passwordHash
            ? { passwordHash, failedLoginAttempts: 0, lockedAt: null }
            : {}),
        },
      })
    : await prisma.user.create({
        data: { email, name, role, departmentId, managerId, ...(passwordHash ? { passwordHash } : {}) },
      });

  await prisma.userJobTitle.deleteMany({ where: { userId: user.id } });
  if (jobTitleIds.length) {
    await prisma.userJobTitle.createMany({
      data: jobTitleIds.map((jid) => ({ userId: user.id, jobTitleId: jid })),
    });
  }

  await enrollUserIntoJobTitlePlans(user.id);
  revalidatePath("/admin/users");
}

async function setPassword(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const userId = String(formData.get("userId"));
  const password = String(formData.get("password") || "");
  const err = validatePasswordStrength(password);
  if (err) throw new Error(err);
  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, failedLoginAttempts: 0, lockedAt: null },
  });
  revalidatePath("/admin/users");
}

async function unlockUser(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const userId = String(formData.get("userId"));
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedAt: null },
  });
  revalidatePath("/admin/users");
}

async function createDepartment(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const name = String(formData.get("name")).trim();
  if (name) await prisma.department.create({ data: { name } });
  revalidatePath("/admin/users");
}

export default async function AdminUsers() {
  const user = await requireRole("ADMIN");
  const [users, departments, jobTitles, managers] = await Promise.all([
    prisma.user.findMany({
      include: {
        department: true,
        manager: true,
        jobTitles: { include: { jobTitle: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.jobTitle.findMany({ orderBy: { name: "asc" } }),
    prisma.user.findMany({
      where: { role: "MANAGER" },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <Shell user={user} title="Kullanıcılar" subtitle="Kullanıcı yönetimi ve şifre işlemleri">
      <section className="card p-5 mb-6">
        <h2 className="font-semibold mb-3">Yeni Departman</h2>
        <form action={createDepartment} className="flex gap-2">
          <input name="name" placeholder="Departman adı" required maxLength={100} className="input flex-1" />
          <button className="btn-primary">Ekle</button>
        </form>
      </section>

      <section className="card p-5 mb-6">
        <h2 className="font-semibold mb-3">Yeni / Güncelle Kullanıcı</h2>
        <p className="text-xs text-slate-500 mb-3">
          Yeni kullanıcıda şifre zorunludur. Mevcut kullanıcıyı güncellerken şifre alanını boş
          bırakırsanız mevcut şifre korunur. Şifre en az 8 karakter olmalı ve harf + rakam içermelidir.
        </p>
        <form action={upsertUser} className="grid grid-cols-2 gap-3 items-end text-sm">
          <input name="email" type="email" placeholder="E-posta" required maxLength={255} className="input" />
          <input name="name" placeholder="Ad Soyad" required maxLength={150} className="input" />
          <select name="role" className="input">
            <option value="USER">Kullanıcı</option>
            <option value="MANAGER">Yönetici</option>
            <option value="ADMIN">Admin</option>
          </select>
          <select name="departmentId" className="input">
            <option value="">Departman (seçiniz)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select name="managerId" className="input" defaultValue="">
            <option value="">Yönetici (yok)</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.email})
              </option>
            ))}
          </select>
          <input
            name="password"
            type="password"
            placeholder="Başlangıç şifresi"
            className="input"
            autoComplete="new-password"
          />
          <label className="col-span-2 block text-xs text-slate-600">
            Görev tanımları (Ctrl / Cmd ile çoklu seçim)
            <select
              name="jobTitleIds"
              multiple
              className="input h-32 mt-1"
            >
              {jobTitles.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-primary col-span-2 w-max">Kaydet</button>
        </form>
      </section>

      <div className="card divide-y divide-slate-100">
        {users.map((u) => (
          <div key={u.id} className="p-4 flex flex-col gap-3">
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-slate-900">
                  {u.name}{" "}
                  <span className="text-slate-500 font-normal">· {u.email}</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {u.role} · {u.department?.name ?? "Departman yok"} · Yönetici: {u.manager?.name ?? "—"}
                  {u.jobTitles.length > 0 && (
                    <> · {u.jobTitles.map((jt) => jt.jobTitle.name).join(", ")}</>
                  )}
                </div>
                <div className="mt-1 flex gap-2 flex-wrap">
                  {!u.passwordHash && <span className="badge-amber">Şifre yok</span>}
                  {u.lockedAt && <span className="badge-red">Kilitli</span>}
                  {u.failedLoginAttempts > 0 && !u.lockedAt && (
                    <span className="badge-amber">
                      {u.failedLoginAttempts} hatalı deneme
                    </span>
                  )}
                </div>
              </div>
              {u.lockedAt && (
                <form action={unlockUser}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button className="btn-secondary text-xs py-1.5">Kilidi Kaldır</button>
                </form>
              )}
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer text-teal-700 hover:text-teal-800 text-xs font-medium select-none">
                Düzenle / Şifre değiştir
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-lg">
                <form action={upsertUser} className="col-span-2 grid grid-cols-2 gap-3">
                  <input type="hidden" name="id" value={u.id} />
                  <input
                    name="email"
                    type="email"
                    defaultValue={u.email}
                    required
                    maxLength={255}
                    className="input"
                  />
                  <input
                    name="name"
                    defaultValue={u.name}
                    required
                    maxLength={150}
                    className="input"
                  />
                  <select name="role" defaultValue={u.role} className="input">
                    <option value="USER">Kullanıcı</option>
                    <option value="MANAGER">Yönetici</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                  <select
                    name="departmentId"
                    defaultValue={u.departmentId ?? ""}
                    className="input"
                  >
                    <option value="">Departman (yok)</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <select
                    name="managerId"
                    defaultValue={u.managerId ?? ""}
                    className="input col-span-2"
                  >
                    <option value="">Yönetici (yok)</option>
                    {managers
                      .filter((m) => m.id !== u.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.email})
                        </option>
                      ))}
                  </select>
                  <label className="col-span-2 text-xs text-slate-600">
                    Görev tanımları (çoklu seçim için Ctrl/Cmd)
                    <select
                      name="jobTitleIds"
                      multiple
                      defaultValue={u.jobTitles.map((jt) => jt.jobTitleId)}
                      className="input h-28 mt-1"
                    >
                      {jobTitles.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn-primary col-span-2 w-max text-xs py-1.5">
                    Bilgileri Kaydet
                  </button>
                </form>

                <form action={setPassword} className="col-span-2 border-t border-slate-200 pt-3">
                  <div className="text-xs font-semibold text-slate-700 mb-2">
                    Şifreyi Değiştir
                  </div>
                  <input type="hidden" name="userId" value={u.id} />
                  <div className="flex gap-2">
                    <input
                      name="password"
                      type="password"
                      placeholder="Yeni şifre (min 8 karakter, harf + rakam)"
                      required
                      className="input flex-1"
                      autoComplete="new-password"
                    />
                    <button className="btn-brand text-xs py-1.5">Şifreyi Ayarla</button>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Yeni şifre belirlenince kilit ve hatalı deneme sayacı sıfırlanır.
                  </p>
                </form>
              </div>
            </details>
          </div>
        ))}
      </div>
    </Shell>
  );
}
