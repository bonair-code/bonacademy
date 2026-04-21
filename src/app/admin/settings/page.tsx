import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { revalidatePath } from "next/cache";

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

export default async function SettingsPage() {
  const user = await requireRole("ADMIN");
  const [departments, jobTitles] = await Promise.all([
    prisma.department.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.jobTitle.findMany({
      include: { _count: { select: { users: true, plans: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <Shell user={user}>
      <h1 className="text-xl font-semibold mb-1">Ayarlar</h1>
      <p className="text-sm text-slate-500 mb-6">
        Sistem genelinde açılır menülerde (Departman, Görev tanımı vb.) görünen seçenekleri buradan yönetin.
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Departments */}
        <section className="bg-white border rounded-xl p-4">
          <h2 className="font-semibold mb-3">Departmanlar</h2>
          <form action={createDepartment} className="flex gap-2 mb-4">
            <input
              name="name"
              placeholder="Yeni departman adı"
              className="border rounded-lg px-3 py-2 flex-1 text-sm"
            />
            <button className="bg-slate-900 text-white rounded-lg px-4 text-sm">Ekle</button>
          </form>
          <div className="divide-y border rounded-lg">
            {departments.length === 0 && (
              <p className="p-4 text-slate-500 text-sm">Henüz departman yok.</p>
            )}
            {departments.map((d) => (
              <div key={d.id} className="p-3 flex items-center gap-2 text-sm">
                <form action={renameDepartment} className="flex gap-2 flex-1">
                  <input type="hidden" name="id" value={d.id} />
                  <input
                    name="name"
                    defaultValue={d.name}
                    className="border rounded px-2 py-1 flex-1"
                  />
                  <button className="text-xs border rounded px-2 py-1 hover:bg-slate-50">
                    Kaydet
                  </button>
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
        <section className="bg-white border rounded-xl p-4">
          <h2 className="font-semibold mb-3">Görev Tanımları</h2>
          <form action={createJobTitle} className="flex gap-2 mb-4">
            <input
              name="name"
              placeholder="Ör. Pilot, Kabin Memuru"
              className="border rounded-lg px-3 py-2 flex-1 text-sm"
            />
            <button className="bg-slate-900 text-white rounded-lg px-4 text-sm">Ekle</button>
          </form>
          <div className="divide-y border rounded-lg">
            {jobTitles.length === 0 && (
              <p className="p-4 text-slate-500 text-sm">Henüz görev tanımı yok.</p>
            )}
            {jobTitles.map((j) => (
              <div key={j.id} className="p-3 flex items-center gap-2 text-sm">
                <form action={renameJobTitle} className="flex gap-2 flex-1">
                  <input type="hidden" name="id" value={j.id} />
                  <input
                    name="name"
                    defaultValue={j.name}
                    className="border rounded px-2 py-1 flex-1"
                  />
                  <button className="text-xs border rounded px-2 py-1 hover:bg-slate-50">
                    Kaydet
                  </button>
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

      <section className="bg-white border rounded-xl p-4 mt-6">
        <h2 className="font-semibold mb-2">Sabit Seçenekler (bilgi)</h2>
        <p className="text-xs text-slate-500 mb-3">
          Aşağıdaki listeler kod tarafında tanımlıdır; eklemek/çıkarmak için yazılım güncellemesi gerekir.
        </p>
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="font-medium mb-1">Roller</div>
            <ul className="list-disc pl-5 text-slate-600">
              <li>Admin</li>
              <li>Yönetici (Manager)</li>
              <li>Kullanıcı</li>
            </ul>
          </div>
          <div>
            <div className="font-medium mb-1">Tekrar Aralıkları</div>
            <ul className="list-disc pl-5 text-slate-600">
              <li>Tekrar yok</li>
              <li>6 Ay</li>
              <li>1 Yıl</li>
              <li>2 Yıl</li>
            </ul>
          </div>
          <div>
            <div className="font-medium mb-1">SCORM Sürümleri</div>
            <ul className="list-disc pl-5 text-slate-600">
              <li>SCORM 1.2</li>
              <li>SCORM 2004</li>
            </ul>
          </div>
        </div>
      </section>
    </Shell>
  );
}
