import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { enrollUserIntoJobTitlePlans } from "@/lib/scheduler/assignments";
import { createPasswordToken, hashPassword, validatePasswordStrength } from "@/lib/password";
import { sendInviteEmail, sendResetEmail } from "@/lib/notifications/mailer";

async function upsertUser(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const id = String(formData.get("id") || "");
  const email = String(formData.get("email")).trim().toLowerCase();
  const name = String(formData.get("name")).trim();
  const role = String(formData.get("role")) as Role;
  const departmentId = String(formData.get("departmentId") || "") || null;
  const jobTitleIds = formData.getAll("jobTitleIds").map(String).filter(Boolean);
  const password = String(formData.get("password") || "");
  const sendInvite = formData.get("sendInvite") === "on";

  let passwordHash: string | undefined;
  if (password) {
    const err = validatePasswordStrength(password);
    if (err) throw new Error(err);
    passwordHash = await hashPassword(password);
  }

  const user = id
    ? await prisma.user.update({
        where: { id },
        data: { email, name, role, departmentId, ...(passwordHash ? { passwordHash } : {}) },
      })
    : await prisma.user.create({
        data: { email, name, role, departmentId, ...(passwordHash ? { passwordHash } : {}) },
      });

  await prisma.userJobTitle.deleteMany({ where: { userId: user.id } });
  if (jobTitleIds.length) {
    await prisma.userJobTitle.createMany({
      data: jobTitleIds.map((jid) => ({ userId: user.id, jobTitleId: jid })),
    });
  }

  await enrollUserIntoJobTitlePlans(user.id);

  if (sendInvite) {
    const token = await createPasswordToken(user.id, "INVITE", 72);
    await sendInviteEmail(user.email, user.name, token);
  }

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

async function sendResetLink(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const userId = String(formData.get("userId"));
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user) {
    const token = await createPasswordToken(user.id, "RESET", 2);
    await sendResetEmail(user.email, user.name, token);
  }
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
  const [users, departments, jobTitles] = await Promise.all([
    prisma.user.findMany({
      include: {
        department: true,
        jobTitles: { include: { jobTitle: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.jobTitle.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <Shell user={user}>
      <h1 className="text-xl font-semibold mb-4">Kullanıcılar</h1>

      <section className="bg-white border rounded-xl p-4 mb-6">
        <h2 className="font-semibold mb-2">Yeni Departman</h2>
        <form action={createDepartment} className="flex gap-2">
          <input name="name" placeholder="Departman adı" className="border rounded px-3 py-1.5 flex-1" />
          <button className="bg-slate-900 text-white rounded-lg px-4">Ekle</button>
        </form>
      </section>

      <section className="bg-white border rounded-xl p-4 mb-6">
        <h2 className="font-semibold mb-2">Yeni / Güncelle Kullanıcı</h2>
        <p className="text-xs text-slate-500 mb-3">
          Şifre alanını boş bırakırsanız mevcut şifre değişmez. &quot;Davet e-postası gönder&quot; işaretliyse
          kullanıcıya şifre belirleme bağlantısı e-postalanır (72 saat geçerli).
        </p>
        <form action={upsertUser} className="grid grid-cols-2 gap-3 items-end text-sm">
          <input name="email" placeholder="E-posta" required className="border rounded px-2 py-1.5" />
          <input name="name" placeholder="Ad Soyad" required className="border rounded px-2 py-1.5" />
          <select name="role" className="border rounded px-2 py-1.5">
            <option value="USER">Kullanıcı</option>
            <option value="MANAGER">Yönetici</option>
            <option value="ADMIN">Admin</option>
          </select>
          <select name="departmentId" className="border rounded px-2 py-1.5">
            <option value="">Departman (seçiniz)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <input
            name="password"
            type="password"
            placeholder="Başlangıç şifresi (opsiyonel)"
            className="border rounded px-2 py-1.5"
            autoComplete="new-password"
          />
          <label className="flex items-center gap-2">
            <input name="sendInvite" type="checkbox" />
            Davet e-postası gönder
          </label>
          <label className="col-span-2 block">
            Görev tanımları (Ctrl / Cmd ile çoklu seçim)
            <select
              name="jobTitleIds"
              multiple
              className="border rounded px-2 py-1.5 w-full h-32 mt-1"
            >
              {jobTitles.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </label>
          <button className="bg-slate-900 text-white rounded-lg px-4 py-1.5 col-span-2 w-max">
            Kaydet
          </button>
        </form>
      </section>

      <div className="bg-white border rounded-xl divide-y">
        {users.map((u) => (
          <div key={u.id} className="p-3 flex justify-between items-center text-sm">
            <div>
              <b>{u.name}</b> <span className="text-slate-500">· {u.email}</span>
              {!u.passwordHash && (
                <span className="ml-2 text-xs text-amber-600">(şifre belirlenmemiş)</span>
              )}
              {u.lockedAt && (
                <span className="ml-2 text-xs text-red-600">🔒 Kilitli</span>
              )}
              <div className="text-xs text-slate-500">
                Görevler: {u.jobTitles.map((jt) => jt.jobTitle.name).join(", ") || "—"}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-slate-500 text-xs">
                {u.role} · {u.department?.name ?? "—"}
              </span>
              {u.lockedAt && (
                <form action={unlockUser}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button className="text-xs border rounded px-2 py-1 hover:bg-slate-50 text-red-700">
                    Kilidi Kaldır
                  </button>
                </form>
              )}
              <form action={sendResetLink}>
                <input type="hidden" name="userId" value={u.id} />
                <button className="text-xs border rounded px-2 py-1 hover:bg-slate-50">
                  Sıfırlama gönder
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
