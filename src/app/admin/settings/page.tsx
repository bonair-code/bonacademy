import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import {
  DEFAULT_CERTIFICATE_TEMPLATE,
  TEMPLATE_FIELD_LIMITS,
  isValidHexColor,
  loadCurrentCertificateTemplate,
} from "@/lib/certificate/template";
import { getTranslations } from "next-intl/server";

const OPTION_CATEGORIES: { key: "role" | "recurrence" | "scorm"; defaults: string[] }[] = [
  {
    key: "role",
    defaults: ["Admin", "Yönetici", "Kullanıcı"],
  },
  {
    key: "recurrence",
    defaults: ["Tekrar yok", "6 Ay", "1 Yıl", "2 Yıl"],
  },
  {
    key: "scorm",
    defaults: ["SCORM 1.2", "SCORM 2004"],
  },
];

async function ensureDefaults() {
  for (const c of OPTION_CATEGORIES) {
    const count = await prisma.appOption.count({ where: { category: c.key } });
    if (count === 0) {
      await prisma.appOption.createMany({
        data: c.defaults.map((label, i) => ({
          category: c.key,
          label,
          sortOrder: i,
        })),
        skipDuplicates: true,
      });
    }
  }
}

async function createDepartment(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  await prisma.department.upsert({ where: { name }, update: {}, create: { name } });
  revalidatePath("/admin/settings");
}

async function renameDepartment(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const id = String(formData.get("id"));
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  await prisma.department.update({ where: { id }, data: { name } });
  revalidatePath("/admin/settings");
}

async function deleteDepartment(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const id = String(formData.get("id"));
  await prisma.department.delete({ where: { id } });
  revalidatePath("/admin/settings");
}

async function createJobTitle(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  await prisma.jobTitle.upsert({ where: { name }, update: {}, create: { name } });
  revalidatePath("/admin/settings");
}

async function renameJobTitle(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const id = String(formData.get("id"));
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  await prisma.jobTitle.update({ where: { id }, data: { name } });
  revalidatePath("/admin/settings");
}

async function deleteJobTitle(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const id = String(formData.get("id"));
  await prisma.jobTitle.delete({ where: { id } });
  revalidatePath("/admin/settings");
}

async function createAppOption(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const category = String(formData.get("category") || "").trim();
  const label = String(formData.get("label") || "").trim();
  if (!category || !label) return;
  const max = await prisma.appOption.aggregate({
    where: { category },
    _max: { sortOrder: true },
  });
  await prisma.appOption.upsert({
    where: { category_label: { category, label } },
    update: {},
    create: { category, label, sortOrder: (max._max.sortOrder ?? -1) + 1 },
  });
  revalidatePath("/admin/settings");
}

async function renameAppOption(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const id = String(formData.get("id"));
  const label = String(formData.get("label") || "").trim();
  if (!label) return;
  await prisma.appOption.update({ where: { id }, data: { label } });
  revalidatePath("/admin/settings");
}

async function deleteAppOption(formData: FormData) {
  "use server";
  await requireRole("ADMIN");
  const id = String(formData.get("id"));
  await prisma.appOption.delete({ where: { id } });
  revalidatePath("/admin/settings");
}

async function saveCertificateTemplate(formData: FormData) {
  "use server";
  const admin = await requireRole("ADMIN");

  const get = (k: string, fallback: string, max: number) => {
    const v = String(formData.get(k) ?? "").trim();
    if (!v) return fallback;
    return v.slice(0, max);
  };

  const accent = String(formData.get("certAccentColor") ?? "").trim();
  const certAccentColor = isValidHexColor(accent)
    ? accent
    : DEFAULT_CERTIFICATE_TEMPLATE.accentColor;

  const data = {
    certAccentColor,
    certTitleAchievement: get(
      "certTitleAchievement",
      DEFAULT_CERTIFICATE_TEMPLATE.titleAchievement,
      TEMPLATE_FIELD_LIMITS.title
    ),
    certTitleParticipation: get(
      "certTitleParticipation",
      DEFAULT_CERTIFICATE_TEMPLATE.titleParticipation,
      TEMPLATE_FIELD_LIMITS.title
    ),
    certSubtitleAchievement: get(
      "certSubtitleAchievement",
      DEFAULT_CERTIFICATE_TEMPLATE.subtitleAchievement,
      TEMPLATE_FIELD_LIMITS.subtitle
    ),
    certSubtitleParticipation: get(
      "certSubtitleParticipation",
      DEFAULT_CERTIFICATE_TEMPLATE.subtitleParticipation,
      TEMPLATE_FIELD_LIMITS.subtitle
    ),
    certBodyAchievement: get(
      "certBodyAchievement",
      DEFAULT_CERTIFICATE_TEMPLATE.bodyAchievement,
      TEMPLATE_FIELD_LIMITS.body
    ),
    certBodyParticipation: get(
      "certBodyParticipation",
      DEFAULT_CERTIFICATE_TEMPLATE.bodyParticipation,
      TEMPLATE_FIELD_LIMITS.body
    ),
    certFooterLine: get(
      "certFooterLine",
      DEFAULT_CERTIFICATE_TEMPLATE.footerLine,
      TEMPLATE_FIELD_LIMITS.footer
    ),
    // Görünürlük bayrakları — checkbox form'da yoksa "on" gelmez, o yüzden
    // undefined/non-"on" → false kabul ediyoruz.
    certShowBirthDate: formData.get("certShowBirthDate") === "on",
    certShowBirthPlace: formData.get("certShowBirthPlace") === "on",
    certShowOwnerManager: formData.get("certShowOwnerManager") === "on",
    certShowQr: formData.get("certShowQr") === "on",
    updatedById: admin.id,
  };

  // Before snapshot (audit için).
  const before = await prisma.organizationSettings.findUnique({
    where: { id: "singleton" },
  });

  await prisma.organizationSettings.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });

  await audit({
    actorId: admin.id,
    action: "certificate.template.update",
    entity: "OrganizationSettings",
    entityId: "singleton",
    metadata: { before: before ?? null, after: data },
  });
  revalidatePath("/admin/settings");
}

export default async function SettingsPage() {
  const t = await getTranslations("admin.settings");
  const user = await requireRole("ADMIN");
  await ensureDefaults();

  const [departments, jobTitles, options, certTemplate] = await Promise.all([
    prisma.department.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.jobTitle.findMany({
      include: { _count: { select: { users: true, plans: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.appOption.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }] }),
    loadCurrentCertificateTemplate(),
  ]);

  const grouped = new Map<string, typeof options>();
  for (const opt of options) {
    const arr = grouped.get(opt.category) ?? [];
    arr.push(opt);
    grouped.set(opt.category, arr);
  }

  return (
    <Shell user={user} title={t("title")} subtitle={t("subtitle")}>
      <p className="text-sm text-slate-500 mb-6">
        {t("intro")}
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Departments */}
        <section className="card p-4">
          <h2 className="font-semibold mb-3">{t("departments")}</h2>
          <form action={createDepartment} className="flex gap-2 mb-4">
            <input name="name" placeholder={t("newDepartmentPlaceholder")} required maxLength={100} className="input flex-1" />
            <button className="btn-primary">{t("add")}</button>
          </form>
          <div className="divide-y border rounded-lg">
            {departments.length === 0 && (
              <p className="p-4 text-slate-500 text-sm">{t("noDepartments")}</p>
            )}
            {departments.map((d) => (
              <div key={d.id} className="p-3 flex items-center gap-2 text-sm">
                <form action={renameDepartment} className="flex gap-2 flex-1">
                  <input type="hidden" name="id" value={d.id} />
                  <input name="name" defaultValue={d.name} required maxLength={100} className="input" />
                  <button className="btn-secondary text-xs">{t("save")}</button>
                </form>
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  {t("usersCount", { count: d._count.users })}
                </span>
                <form action={deleteDepartment}>
                  <input type="hidden" name="id" value={d.id} />
                  <button className="text-xs text-red-600 hover:underline">{t("delete")}</button>
                </form>
              </div>
            ))}
          </div>
        </section>

        {/* Job Titles */}
        <section className="card p-4">
          <h2 className="font-semibold mb-3">{t("jobTitles")}</h2>
          <form action={createJobTitle} className="flex gap-2 mb-4">
            <input name="name" placeholder={t("jobTitlePlaceholder")} required maxLength={100} className="input flex-1" />
            <button className="btn-primary">{t("add")}</button>
          </form>
          <div className="divide-y border rounded-lg">
            {jobTitles.length === 0 && (
              <p className="p-4 text-slate-500 text-sm">{t("noJobTitles")}</p>
            )}
            {jobTitles.map((j) => (
              <div key={j.id} className="p-3 flex items-center gap-2 text-sm">
                <form action={renameJobTitle} className="flex gap-2 flex-1">
                  <input type="hidden" name="id" value={j.id} />
                  <input name="name" defaultValue={j.name} required maxLength={100} className="input" />
                  <button className="btn-secondary text-xs">{t("save")}</button>
                </form>
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  {t("jobTitleCountsShort", { users: j._count.users, plans: j._count.plans })}
                </span>
                <form action={deleteJobTitle}>
                  <input type="hidden" name="id" value={j.id} />
                  <button className="text-xs text-red-600 hover:underline">{t("delete")}</button>
                </form>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Editable App Options (previously hardcoded) */}
      <div className="grid md:grid-cols-3 gap-6 mt-6">
        {OPTION_CATEGORIES.map((c) => {
          const items = grouped.get(c.key) ?? [];
          return (
            <section key={c.key} className="card p-4">
              <h2 className="font-semibold mb-3">{t(`categories.${c.key}.title` as never)}</h2>
              <form action={createAppOption} className="flex gap-2 mb-4">
                <input type="hidden" name="category" value={c.key} />
                <input name="label" placeholder={t(`categories.${c.key}.placeholder` as never)} className="input flex-1" />
                <button className="btn-primary">{t("add")}</button>
              </form>
              <div className="divide-y border rounded-lg">
                {items.length === 0 && (
                  <p className="p-4 text-slate-500 text-sm">{t("noOption")}</p>
                )}
                {items.map((opt) => (
                  <div key={opt.id} className="p-3 flex items-center gap-2 text-sm">
                    <form action={renameAppOption} className="flex gap-2 flex-1">
                      <input type="hidden" name="id" value={opt.id} />
                      <input name="label" defaultValue={opt.label} className="input" />
                      <button className="btn-secondary text-xs">{t("save")}</button>
                    </form>
                    <form action={deleteAppOption}>
                      <input type="hidden" name="id" value={opt.id} />
                      <button className="text-xs text-red-600 hover:underline">{t("delete")}</button>
                    </form>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-400 mt-4">
        {t("systemNote")}
      </p>

      {/* Sertifika şablonu */}
      <section className="card p-5 mt-8">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <h2 className="font-semibold">{t("certificate.title")}</h2>
          <div className="flex gap-2">
            <a
              href="/api/admin/certificate-template/preview"
              target="_blank"
              rel="noopener"
              className="btn-secondary text-xs"
            >
              {t("certificate.preview")}
            </a>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          {t.rich("certificate.intro", { b: (c) => <b>{c}</b> })}
        </p>

        <form action={saveCertificateTemplate} className="grid md:grid-cols-2 gap-4">
          <label className="block text-sm md:col-span-2">
            <span className="block text-slate-600 mb-1">{t("certificate.accentColor")}</span>
            <div className="flex items-center gap-3">
              <input
                type="color"
                name="certAccentColor"
                defaultValue={certTemplate.accentColor}
                className="h-10 w-16 rounded border border-slate-300 cursor-pointer"
              />
              <span className="text-xs text-slate-500">
                {t("certificate.accentColorHelp", { hex: DEFAULT_CERTIFICATE_TEMPLATE.accentColor })}
              </span>
            </div>
          </label>

          <label className="block text-sm">
            <span className="block text-slate-600 mb-1">{t("certificate.titleAchievement")}</span>
            <input
              name="certTitleAchievement"
              defaultValue={certTemplate.titleAchievement}
              maxLength={TEMPLATE_FIELD_LIMITS.title}
              className="input w-full"
            />
          </label>
          <label className="block text-sm">
            <span className="block text-slate-600 mb-1">{t("certificate.titleParticipation")}</span>
            <input
              name="certTitleParticipation"
              defaultValue={certTemplate.titleParticipation}
              maxLength={TEMPLATE_FIELD_LIMITS.title}
              className="input w-full"
            />
          </label>

          <label className="block text-sm">
            <span className="block text-slate-600 mb-1">{t("certificate.subtitleAchievement")}</span>
            <input
              name="certSubtitleAchievement"
              defaultValue={certTemplate.subtitleAchievement}
              maxLength={TEMPLATE_FIELD_LIMITS.subtitle}
              className="input w-full"
            />
          </label>
          <label className="block text-sm">
            <span className="block text-slate-600 mb-1">{t("certificate.subtitleParticipation")}</span>
            <input
              name="certSubtitleParticipation"
              defaultValue={certTemplate.subtitleParticipation}
              maxLength={TEMPLATE_FIELD_LIMITS.subtitle}
              className="input w-full"
            />
          </label>

          <label className="block text-sm md:col-span-2">
            <span className="block text-slate-600 mb-1">
              {t("certificate.bodyAchievement")}
            </span>
            <textarea
              name="certBodyAchievement"
              defaultValue={certTemplate.bodyAchievement}
              maxLength={TEMPLATE_FIELD_LIMITS.body}
              rows={2}
              className="input w-full"
            />
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="block text-slate-600 mb-1">
              {t("certificate.bodyParticipation")}
            </span>
            <textarea
              name="certBodyParticipation"
              defaultValue={certTemplate.bodyParticipation}
              maxLength={TEMPLATE_FIELD_LIMITS.body}
              rows={2}
              className="input w-full"
            />
          </label>

          <label className="block text-sm md:col-span-2">
            <span className="block text-slate-600 mb-1">{t("certificate.footerLine")}</span>
            <input
              name="certFooterLine"
              defaultValue={certTemplate.footerLine}
              maxLength={TEMPLATE_FIELD_LIMITS.footer}
              className="input w-full"
            />
          </label>

          <fieldset className="md:col-span-2 border border-slate-200 rounded-lg p-3">
            <legend className="text-xs font-semibold text-slate-600 px-1">
              {t("certificate.visibleFieldsLegend")}
            </legend>
            <p className="text-[11px] text-slate-500 mb-2">
              {t.rich("certificate.visibleFieldsHelp", { b: (c) => <b>{c}</b> })}
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="certShowBirthDate"
                  defaultChecked={certTemplate.showBirthDate}
                />
                <span>{t("certificate.fieldBirthDate")}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="certShowBirthPlace"
                  defaultChecked={certTemplate.showBirthPlace}
                />
                <span>{t("certificate.fieldBirthPlace")}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="certShowOwnerManager"
                  defaultChecked={certTemplate.showOwnerManager}
                />
                <span>{t("certificate.fieldOwnerManager")}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="certShowQr"
                  defaultChecked={certTemplate.showQr}
                />
                <span>{t("certificate.fieldQr")}</span>
              </label>
            </div>
          </fieldset>

          <div className="md:col-span-2 flex items-center gap-3">
            <button type="submit" className="btn-primary">
              {t("save")}
            </button>
            <span className="text-xs text-slate-500">
              {t("certificate.saveHint")}
            </span>
          </div>
        </form>
      </section>
    </Shell>
  );
}
