import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { revalidatePath } from "next/cache";

const OPTION_CATEGORIES: { key: string; title: string; placeholder: string; defaults: string[] }[] = [
  {
    key: "role",
    title: "Roller",
    placeholder: "Ör. Admin, Yönetici, Kullanıcı",
    defaults: ["Admin", "Yönetici", "Kullanıcı"],
  },
  {
    key: "recurrence",
    title: "Tekrar Aralıkları",
    placeholder: "Ör. 6 Ay, 1 Yıl",
    defaults: ["Tekrar yok", "6 Ay", "1 Yıl", "2 Yıl"],
  },
  {
    key: "scorm",
    title: "SCORM Sürümleri",
    placeholder: "Ör. SCORM 1.2",
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

export default async function SettingsPage() {
  const user = await requireRole("ADMIN");
  await ensureDefaults();

  const [departments, jobTitles, options] = await Promise.all([
    prisma.department.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.jobTitle.findMany({
      include: { _count: { select: { users: true, plans: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.appOption.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }] }),
  ]);

  const grouped = new Map<string, typeof options>();
  for (const opt of options) {
    const arr = grouped.get(opt.category) ?? [];
    arr.push(opt);
    grouped.set(opt.category, arr);
  }

  return (
    <Shell user={user} title="Ayarlar" subtitle="Açılır menü seçenekleri ve sistem ayarları">
      <p className="text-sm text-slate-500 mb-6">
        Sistem genelinde açılır menülerde (Departman, Görev tanımı, Rol, Tekrar sıklığı, SCORM sürümü)
        görünen seçenekleri buradan yönetin.
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Departments */}
        <section className="card p-4">
          <h2 className="font-semibold mb-3">Departmanlar</h2>
          <form action={createDepartment} className="flex gap-2 mb-4">
            <input name="name" placeholder="Yeni departman adı" required maxLength={100} className="input flex-1" />
            <button className="btn-primary">Ekle</button>
          </form>
          <div className="divide-y border rounded-lg">
            {departments.length === 0 && (
              <p className="p-4 text-slate-500 text-sm">Henüz departman yok.</p>
            )}
            {departments.map((d) => (
              <div key={d.id} className="p-3 flex items-center gap-2 text-sm">
                <form action={renameDepartment} className="flex gap-2 flex-1">
                  <input type="hidden" name="id" value={d.id} />
                  <input name="name" defaultValue={d.name} required maxLength={100} className="input" />
                  <button className="btn-secondary text-xs">Kaydet</button>
                </form>
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  {d._count.users} kullanıcı
                </span>
                <form action={deleteDepartment}>
                  <input type="hidden" name="id" value={d.id} />
                  <button className="text-xs text-red-600 hover:underline">Sil</button>
                </form>
              </div>
            ))}
          </div>
        </section>

        {/* Job Titles */}
        <section className="card p-4">
          <h2 className="font-semibold mb-3">Görev Tanımları</h2>
          <form action={createJobTitle} className="flex gap-2 mb-4">
            <input name="name" placeholder="Ör. Pilot, Kabin Memuru" required maxLength={100} className="input flex-1" />
            <button className="btn-primary">Ekle</button>
          </form>
          <div className="divide-y border rounded-lg">
            {jobTitles.length === 0 && (
              <p className="p-4 text-slate-500 text-sm">Henüz görev tanımı yok.</p>
            )}
            {jobTitles.map((j) => (
              <div key={j.id} className="p-3 flex items-center gap-2 text-sm">
                <form action={renameJobTitle} className="flex gap-2 flex-1">
                  <input type="hidden" name="id" value={j.id} />
                  <input name="name" defaultValue={j.name} required maxLength={100} className="input" />
                  <button className="btn-secondary text-xs">Kaydet</button>
                </form>
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  {j._count.users}k · {j._count.plans}p
                </span>
                <form action={deleteJobTitle}>
                  <input type="hidden" name="id" value={j.id} />
                  <button className="text-xs text-red-600 hover:underline">Sil</button>
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
              <h2 className="font-semibold mb-3">{c.title}</h2>
              <form action={createAppOption} className="flex gap-2 mb-4">
                <input type="hidden" name="category" value={c.key} />
                <input name="label" placeholder={c.placeholder} className="input flex-1" />
                <button className="btn-primary">Ekle</button>
              </form>
              <div className="divide-y border rounded-lg">
                {items.length === 0 && (
                  <p className="p-4 text-slate-500 text-sm">Seçenek yok.</p>
                )}
                {items.map((opt) => (
                  <div key={opt.id} className="p-3 flex items-center gap-2 text-sm">
                    <form action={renameAppOption} className="flex gap-2 flex-1">
                      <input type="hidden" name="id" value={opt.id} />
                      <input name="label" defaultValue={opt.label} className="input" />
                      <button className="btn-secondary text-xs">Kaydet</button>
                    </form>
                    <form action={deleteAppOption}>
                      <input type="hidden" name="id" value={opt.id} />
                      <button className="text-xs text-red-600 hover:underline">Sil</button>
                    </form>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-400 mt-4">
        Not: Roller, Tekrar Aralıkları ve SCORM Sürümleri için sistem motoru sabit mantık kullanır;
        buradaki etiketler açılır menülerde görünecek ad/sıra düzenlemesi içindir. Yeni bir rol veya
        tekrar aralığı türü eklenmek istenirse yazılım güncellemesi gerekir.
      </p>
    </Shell>
  );
}
