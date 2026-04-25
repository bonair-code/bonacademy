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
import { getTranslations } from "next-intl/server";
import { flashToast } from "@/lib/flash";

async function upsertUser(formData: FormData) {
  "use server";
  const t = await getTranslations("admin.users.error");
  const admin = await requireRole("ADMIN", "MANAGER");
  const id = String(formData.get("id") || "");
  const email = String(formData.get("email")).trim().toLowerCase();
  const name = String(formData.get("name")).trim();
  // Güvenlik: yönetici yalnızca USER rolünde kullanıcı oluşturur/düzenler.
  const requestedRole = String(formData.get("role")) as Role;
  const role: Role =
    admin.role === "ADMIN" ? requestedRole : "USER";
  if (admin.role !== "ADMIN" && id) {
    const target = await prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });
    if (!target || target.role !== "USER") {
      throw new Error(t("managerOnlyUsers"));
    }
  }
  const departmentId = String(formData.get("departmentId") || "") || null;
  const managerIdRaw = String(formData.get("managerId") || "") || null;
  const managerId = managerIdRaw && managerIdRaw !== id ? managerIdRaw : null;
  const jobTitleIds = formData.getAll("jobTitleIds").map(String).filter(Boolean);
  const password = String(formData.get("password") || "");
  const birthDateRaw = String(formData.get("birthDate") || "").trim();
  const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(birthDateRaw)
    ? new Date(birthDateRaw + "T00:00:00Z")
    : null;
  const birthPlaceRaw = String(formData.get("birthPlace") || "").trim();
  const birthPlace = birthPlaceRaw ? birthPlaceRaw.slice(0, 120) : null;
  const autoEnroll = String(formData.get("autoEnroll") || "") === "on";

  let passwordHash: string | undefined;
  if (password) {
    const err = validatePasswordStrength(password);
    if (err) throw new Error(err);
    passwordHash = await hashPassword(password);
  }
  const sendInvite = !id && !password;

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

  if (sendInvite) {
    try {
      const token = await createPasswordToken(user.id, "INVITE");
      await sendInviteEmail(user.email, user.name, token, user.locale);
    } catch (err) {
      console.error("[invite] mail failed for", user.email, err);
    }
  }

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
  await flashToast("saved");
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
  await flashToast("saved");
  revalidatePath("/admin/users");
}

async function sendInvite(formData: FormData) {
  "use server";
  const t = await getTranslations("admin.users.error");
  const admin = await requireRole("ADMIN", "MANAGER");
  const userId = String(formData.get("userId"));
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, isActive: true, locale: true },
  });
  if (admin.role !== "ADMIN" && u.role !== "USER") {
    throw new Error(t("managerInviteOnlyUsers"));
  }
  if (!u.isActive) throw new Error(t("inactiveInvite"));
  const token = await createPasswordToken(u.id, "INVITE");
  await sendInviteEmail(u.email, u.name, token, u.locale);
  await audit({
    actorId: admin.id,
    action: "user.invite.send",
    entity: "User",
    entityId: u.id,
    metadata: { email: u.email },
  });
  await flashToast("sent");
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
  await flashToast("updated");
  revalidatePath("/admin/users");
}

async function createDepartment(formData: FormData) {
  "use server";
  await requireRole("ADMIN", "MANAGER");
  const name = String(formData.get("name")).trim();
  if (name) {
    await prisma.department.create({ data: { name } });
    await flashToast("added");
  }
  revalidatePath("/admin/users");
}

export default async function AdminUsers() {
  const t = await getTranslations("admin.users");
  const user = await requireRole("ADMIN", "MANAGER");
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
    <Shell user={user} title={t("title")} subtitle={t("subtitle")}>
      <section className="card p-5 mb-6">
        <h2 className="font-semibold mb-3">{t("newDepartment")}</h2>
        <form action={createDepartment} className="flex gap-2">
          <input name="name" placeholder={t("departmentNamePlaceholder")} required maxLength={100} className="input flex-1" />
          <button className="btn-primary">{t("add")}</button>
        </form>
      </section>

      <section className="card p-5 mb-6">
        <h2 className="font-semibold mb-3">{t("newOrUpdateUser")}</h2>
        <p className="text-xs text-slate-500 mb-3">
          {t.rich("passwordHelp", {
            b: (c) => <strong>{c}</strong>,
          })}
        </p>
        <form action={upsertUser} className="grid grid-cols-2 gap-3 items-end text-sm">
          <input name="email" type="email" placeholder={t("emailPlaceholder")} required maxLength={255} className="input" />
          <input name="name" placeholder={t("fullNamePlaceholder")} required maxLength={150} className="input" />
          {user.role === "ADMIN" ? (
            <select name="role" className="input">
              <option value="USER">{t("roleUser")}</option>
              <option value="MANAGER">{t("roleManager")}</option>
              <option value="ADMIN">{t("roleAdmin")}</option>
            </select>
          ) : (
            <input type="hidden" name="role" value="USER" />
          )}
          <select name="departmentId" className="input">
            <option value="">{t("departmentSelect")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select name="managerId" className="input" defaultValue="">
            <option value="">{t("managerNone")}</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.email})
              </option>
            ))}
          </select>
          <input
            name="password"
            type="password"
            placeholder={t("initialPasswordPlaceholder")}
            className="input"
            autoComplete="new-password"
          />
          <label className="text-xs text-slate-600">
            {t("birthDateOptional")}
            <input type="date" name="birthDate" className="input w-full mt-1" />
          </label>
          <label className="text-xs text-slate-600">
            {t("birthPlaceOptional")}
            <input
              name="birthPlace"
              maxLength={120}
              placeholder={t("birthPlacePlaceholder")}
              className="input w-full mt-1"
            />
          </label>
          <label className="col-span-2 block text-xs text-slate-600">
            {t("jobTitlesMulti")}
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
                {t("autoEnrollLabel")}
              </span>
              <br />
              <span className="text-slate-500">
                {t.rich("autoEnrollHelp", {
                  strong: (c) => <span className="font-medium">{c}</span>,
                })}
              </span>
            </span>
          </label>
          <button className="btn-primary col-span-2 w-max">{t("save")}</button>
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
                  {u.role} · {u.department?.name ?? t("noDepartment")} · {t("managerLabel")}: {u.manager?.name ?? "—"}
                  {u.jobTitles.length > 0 && (
                    <> · {u.jobTitles.map((jt) => jt.jobTitle.name).join(", ")}</>
                  )}
                </div>
                <div className="mt-1 flex gap-2 flex-wrap">
                  {!u.passwordHash && <span className="badge-amber">{t("noPassword")}</span>}
                  {u.lockedAt && <span className="badge-red">{t("locked")}</span>}
                  {u.failedLoginAttempts > 0 && !u.lockedAt && (
                    <span className="badge-amber">
                      {t("failedAttempts", { count: u.failedLoginAttempts })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`/admin/audit?entity=User&entityId=${u.id}`}
                  className="text-xs text-sky-700 hover:underline whitespace-nowrap"
                >
                  {t("auditHistory")}
                </a>
                {u.lockedAt && (
                  <form action={unlockUser}>
                    <input type="hidden" name="userId" value={u.id} />
                    <button className="btn-secondary text-xs py-1.5">{t("unlock")}</button>
                  </form>
                )}
                {u.isActive && (
                  <form action={sendInvite}>
                    <input type="hidden" name="userId" value={u.id} />
                    <button
                      className="btn-secondary text-xs py-1.5"
                      title={
                        u.passwordHash
                          ? t("resendInviteTitle")
                          : t("sendInviteTitle")
                      }
                    >
                      {u.passwordHash ? t("resendInvite") : t("sendInvite")}
                    </button>
                  </form>
                )}
              </div>
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer text-teal-700 hover:text-teal-800 text-xs font-medium select-none">
                {t("editOrChangePassword")}
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
                      <option value="USER">{t("roleUser")}</option>
                      <option value="MANAGER">{t("roleManager")}</option>
                      <option value="ADMIN">{t("roleAdmin")}</option>
                    </select>
                  ) : (
                    <input type="hidden" name="role" value={u.role} />
                  )}
                  <select
                    name="departmentId"
                    defaultValue={u.departmentId ?? ""}
                    className="input"
                  >
                    <option value="">{t("departmentNone")}</option>
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
                    <option value="">{t("managerNone")}</option>
                    {managers
                      .filter((m) => m.id !== u.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.email})
                        </option>
                      ))}
                  </select>
                  <label className="text-xs text-slate-600">
                    {t("birthDate")}
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
                    {t("birthPlace")}
                    <input
                      name="birthPlace"
                      maxLength={120}
                      defaultValue={u.birthPlace ?? ""}
                      placeholder={t("birthPlacePlaceholder")}
                      className="input w-full mt-1"
                    />
                  </label>
                  <label className="col-span-2 text-xs text-slate-600">
                    {t("jobTitlesMultiShort")}
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
                    {t("autoEnrollEdit")}
                    <span className="text-slate-400">
                      {t("autoEnrollEditHint")}
                    </span>
                  </label>
                  <button className="btn-primary col-span-2 w-max text-xs py-1.5">
                    {t("saveDetails")}
                  </button>
                </form>

                <form action={setPassword} className="col-span-2 border-t border-slate-200 pt-3">
                  <div className="text-xs font-semibold text-slate-700 mb-2">
                    {t("changePassword")}
                  </div>
                  <input type="hidden" name="userId" value={u.id} />
                  <div className="flex gap-2">
                    <input
                      name="password"
                      type="password"
                      placeholder={t("newPasswordPlaceholder")}
                      required
                      className="input flex-1"
                      autoComplete="new-password"
                    />
                    <button className="btn-brand text-xs py-1.5">{t("setPassword")}</button>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {t("setPasswordHint")}
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
