import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import Link from "next/link";
import { revalidatePath } from "next/cache";

async function createCourse(formData: FormData) {
  "use server";
  const title = String(formData.get("title") || "").trim();
  if (!title) return;
  await prisma.course.create({ data: { title } });
  revalidatePath("/admin/courses");
}

export default async function AdminCourses() {
  const user = await requireRole("ADMIN");
  const courses = await prisma.course.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <Shell user={user}>
      <h1 className="text-xl font-semibold mb-4">Kurslar</h1>
      <form action={createCourse} className="flex gap-2 mb-6">
        <input
          name="title"
          placeholder="Yeni kurs başlığı"
          className="border rounded-lg px-3 py-2 flex-1"
        />
        <button className="bg-slate-900 text-white rounded-lg px-4">Ekle</button>
      </form>
      <div className="bg-white border rounded-xl divide-y">
        {courses.map((c) => (
          <Link
            key={c.id}
            href={`/admin/courses/${c.id}`}
            className="flex justify-between p-4 hover:bg-slate-50"
          >
            <span>{c.title}</span>
            <span className="text-xs text-slate-500">
              {c.scormPackagePath ? "SCORM yüklü" : "SCORM bekleniyor"}
            </span>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
