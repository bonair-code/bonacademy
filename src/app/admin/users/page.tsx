import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { enrollUserIntoJobTitlePlans } from "@/lib/scheduler/assignments";
import { hashPassword, validatePasswordStrength } from "@/lib/password";
import { audit } from "@/lib/audit";
import { createPasswordToken } from "@/lib/passwordTokens";
import { sendInviteEmail } from "@/lib/notifications/mailer";

async function upsertUser(formData: FormData) {
  "use server";
  const admin = await requireRole("ADMIN", "MANAGER");
  const id = String(formData.get("id") || "");
  const email = String(formData.get("email")).trim().toLowerCase();
  const name = String(formData.get("name")).trim();
  // Güvenlik: yönetici yalnızca USER rolünde kullanıcı oluşturur/düzenler.
  // Form'dan gelen role değeri ADMIN ise dikkate alma — rol yükseltme yetkisi
  // sadece admin'de.
  const requestedRole = String(formData.get("role")) as Role;
  const role: Role =
    admin.role === "ADMIN" ? requestedRole : "USER";
  // Yönetici var olan bir kullanıcıyı düzenliyorsa, hedef USER değilse reddet.
  if (admin.role !== "ADMIN" && id) {
    const target = await prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });
    if (!target || target.role !== "USER") {
      throw new Error("Yönetici yalnızca USER rolündeki kullanıcıları düzenleyebilir.");
    }
  }
  const departmentId = String(formData.get("departmentId") || "") || null;
  const managerIdRaw = String(formData.get("managerId") || "") || null;
  // Kendini yönetici olarak atamaya izin verme.
  const managerId = managerIdRaw && managerIdRaw !== id ? managerIdRaw : null;
  const jobTitleIds = formData.getAll("jobTitleIds").map(String).filter(Boolean);
  const password = String(formData.get("password") || "");
  // Doğum bilgileri — sertifikada görünür, ikisi de opsiyonel.
  const birthDateRaw = String(formData.get("birthDate") || "").trim();
  const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(birthDateRaw)
    ? new Date(birthDateRaw + "T00:00:00Z")
    : null;
  const birthPlaceRaw = String(formData.get("birthPlace") || "").trim();
  const birthPlace = birthPlaceRaw ? birthPlaceRaw.slice(0, 120) : null;
  // Görev tanımına göre otomatik plan ataması yapılsın mı? Checkbox işaretliyse
  // "on" gelir; aksi halde alan form'a hiç eklenmez. Admin işaretini kaldırırsa
  // bu kayıtta enroll çalışmaz → admin sonradan /admin/plans üzerinden manuel
  // atama yapabilir.
  const autoEnroll = String(formData.get("autoEnroll") || "") === "on";

  let passwordHash: string | undefined;
  if (password) {
    const err = validatePasswordStrength(password);
    if (err) throw new Error(err);
    passwordHash = await hashPassword(password);
  }
  // Yeni kullanıcı + şifre yoksa: davet maili göndereceğiz (akış aşağıda).
  const sendInvite = !id && !password;

  // Mevcut durumu audit meta için yakala (rol/manager değişimlerini izleyebilmek üzere).
  const before = id
    ? await prisma.user.findUnique({
        where: { id },
        select: { role: true, managerId: true, departmentId: true, email: true },
      })
    : null;

  const user = id
    ? await prisma.user.update({
        where: { id },
        data: {
          email,
          name,
          role,
          departmentId,
          managerId,
          birthDate,
          birthPlace,
          ...(passwordHash
            ? { passwordHash, failedLoginAttempts: 0, lockedAt: null }
            : {}),
        },
      })
    : await prisma.user.create({
        data: { email, name, role, departmentId, managerId, birthDate, birthPlace, ...(passwordHash ? { passwordHash } : {}) },
      });

  await prisma.userJobTitle.deleteMany({ where: { userId: user.id } });
  if (jobTitleIds.length) {
    await prisma.userJobTitle.createMany({
      data: jobTitleIds.map((jid) => ({ userId: user.id, jobTitleId: jid })),
    });
  }

  if (autoEnroll) {
    await enrollUserIntoJobTitlePlans(user.id);
  }

  // Şifre belirlenmediyse davet maili at — kullanıcı kendi şifresini kursun.
  // Mail başarısız olsa bile kullanıcı oluşturuldu; admin sonradan tekrar
  // davet butonu üzerinden tetikleyebilir.
  if (sendInvite) {
    try {
      const token = await createPasswordToken(user.id, "INVITE");
      await sendInviteEmail(user.email, user.name, token, user.locale);
    } catch (err) {
      console.error("[invite] mail failed for", user.email, err);
    }
  }

  // Rol ve yönetici değişiklikleri hassas: ayrı audit action'larıyla izlenir.
  if (id && before) {
    if (before.role !== role) {
      await audit({
        actorId: admin.id,
        action: "user.role.change",
        entity: "User",
        entityId: user.id,
        metadata: { from: before.role, to: role, email },
      });
    }
    if ((before.managerId ?? null) !== (managerId ?? null)) {
      await audit({
        actorId: admin.id,
        action: "user.manager.change",
        entity: "User",
        entityId: user.id,
        metadata: { from: before.managerId, to: managerId, email },
      });
    }
    await audit({
      actorId: admin.id,
      action: "user.update",
      entity: "User",
      entityId: user.id,
      metadata: {
        emailBefore: before.email,
        emailAfter: email,
        departmentIdBefore: before.departmentId,
        departmentIdAfter: departmentId,
        jobTitleIds,
        passwordChanged: !!passwordHash,
      },
    });
  } else {
    await audit({
      actorId: admin.id,
      action: "user.create",
      entity: "User",
      entityId: user.id,
      metadata: { email, role, departmentId, managerId, jobTitleIds, autoEnroll },
    });
  }
  revalidatePath("/admin/users");
}

async function setPassword(formData: FormData) {
  "use server";
  await requireRole("ADMIN", "MANAGER");
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

async function sendInvite(formData: FormData) {
  "use server";
  const admin = await requireRole("ADMIN", "MANAGER");
  const userId = String(formData.get("userId"));
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, isActive: true, locale: true },
  });
  if (admin.role !== "ADMIN" && u.role !== "USER") {
    throw new Error("Yönetici yalnızca USER rolüne davet gönderebilir.");
  }
  if (!u.isActive) throw new Error("Pasif kullanıcıya davet gönderilemez.");
  const token = await createPasswordToken(u.id, "INVITE");
  await sendInviteEmail(u.email, u.name, token, u.locale);
  await audit({
    actorId: admin.id,
    action: "user.invite.send",
    entity: "User",
    entityId: u.id,
    metadata: { email: u.email },
  });
  revalidatePath("/admin/users");
}

async function unlockUser(formData: FormData) {
  "use server";
  await requireRole("ADMIN", "MANAGER");
  const userId = String(formData.get("userId"));
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedAt: null },
  });
  revalidatePath("/admin/users");
}

async function createDepartment(formData: FormData) {
  "use server";
  await requireRole("ADMIN", "MANAGER");
  const name = String(formData.get("name")).trim();
  if (name) await prisma.department.create({ data: { name } });
  revalidatePath("/admin/users");
}

export default async function AdminUsers() {
  const user = await requireRole("ADMIN", "MANAGER");
  // Yönetici yalnızca USER rolündeki kişileri görür ve düzenleyebilir.
  // Admin herkesi görür.
  const listFilter = user.role === "ADMIN" ? {} : { role: "USER" as const };
  const [users, departments, jobTitles, managers] = await Promise.all([
    prisma.user.findMany({
      where: listFilter,
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
          <strong>Şifre alanını boş bırakın</strong> — kullanıcıya 72 saat geçerli bir davet
          maili gider, kendisi şifre kurar (önerilen). Şifre yazarsanız doğrudan o şifreyle
          oluşturulur (en az 8 karakter, harf + rakam). Mevcut kullanıcıda boş bırakırsanız
          şifre korunur.
        </p>
        <form action={upsertUser} className="grid grid-cols-2 gap-3 items-end text-sm">
          <input name="email" type="email" placeholder="E-posta" required maxLength={255} className="input" />
          <input name="name" placeholder="Ad Soyad" required maxLength={150} className="input" />
          {user.role === "ADMIN" ? (
            <select name="role" className="input">
              <option value="USER">Kullanıcı</option>
              <option value="MANAGER">Yönetici</option>
              <option value="ADMIN">Admin</option>
            </select>
          ) : (
            // Yönetici yalnızca USER oluşturabilir — select'i gizle, hidden
            // field ile sabitle.
            <input type="hidden" name="role" value="USER" />
          )}
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
            placeholder="Başlangıç şifresi (boş = davet maili gönder)"
            className="input"
            autoComplete="new-password"
          />
          <label className="text-xs text-slate-600">
            Doğum tarihi (opsiyonel)
            <input type="date" name="birthDate" className="input w-full mt-1" />
          </label>
          <label className="text-xs text-slate-600">
            Doğum yeri (opsiyonel)
            <input
              name="birthPlace"
              maxLength={120}
              placeholder="Örn. İstanbul"
              className="input w-full mt-1"
            />
          </label>
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
          <label className="col-span-2 flex items-start gap-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3">
            <input
              type="checkbox"
              name="autoEnroll"
              defaultChecked
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">
                Görev tanımına göre otomatik eğitim ataması yap
              </span>
              <br />
              <span className="text-slate-500">
                İşaretliyse, kullanıcının seçtiğiniz görev tanımları için aktif
                olan tüm eğitim planları anında atanır. İşareti kaldırırsanız
                atama yapılmaz — eğitimleri sonradan{" "}
                <span className="font-medium">Eğitim Planları</span>{" "}
                sayfasından manuel olarak ekleyebilirsiniz.
              </span>
            </span>
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
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`/admin/audit?entity=User&entityId=${u.id}`}
                  className="text-xs text-sky-700 hover:underline whitespace-nowrap"
                >
                  Denetim geçmişi →
                </a>
                {u.lockedAt && (
                  <form action={unlockUser}>
                    <input type="hidden" name="userId" value={u.id} />
                    <button className="btn-secondary text-xs py-1.5">Kilidi Kaldır</button>
                  </form>
                )}
                {u.isActive && (
                  <form action={sendInvite}>
                    <input type="hidden" name="userId" value={u.id} />
                    <button
                      className="btn-secondary text-xs py-1.5"
                      title={
                        u.passwordHash
                          ? "Yeniden davet maili gönder (eski şifre korunur, yeni link 72 saat geçerli)"
                          : "Davet maili gönder"
                      }
                    >
                      {u.passwordHash ? "Daveti Yenile" : "Davet Gönder"}
                    </button>
                  </form>
                )}
              </div>
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
                  {user.role === "ADMIN" ? (
                    <select name="role" defaultValue={u.role} className="input">
                      <option value="USER">Kullanıcı</option>
                      <option value="MANAGER">Yönetici</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  ) : (
                    <input type="hidden" name="role" value={u.role} />
                  )}
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
                  <label className="text-xs text-slate-600">
                    Doğum tarihi
                    <input
                      type="date"
                      name="birthDate"
                      defaultValue={
                        u.birthDate
                          ? new Date(u.birthDate).toISOString().slice(0, 10)
                          : ""
                      }
                      className="input w-full mt-1"
                    />
                  </label>
                  <label className="text-xs text-slate-600">
                    Doğum yeri
                    <input
                      name="birthPlace"
                      maxLength={120}
                      defaultValue={u.birthPlace ?? ""}
                      placeholder="Örn. İstanbul"
                      className="input w-full mt-1"
                    />
                  </label>
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
                  <label className="col-span-2 flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" name="autoEnroll" />
                    Görev tanımı değişikliğine göre eksik eğitimleri otomatik ata
                    <span className="text-slate-400">
                      (işaretlenmezse atama yapılmaz — zaten var olanlar korunur)
                    </span>
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
