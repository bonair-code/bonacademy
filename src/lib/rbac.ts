import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";

const DEV_BYPASS = true;
const DEV_EMAIL = "admin@bonair.com.tr";

async function devUser() {
  const u = await prisma.user.findUnique({
    where: { email: DEV_EMAIL },
    select: { id: true, name: true, email: true, role: true, departmentId: true },
  });
  if (!u) redirect("/login");
  return { id: u.id, name: u.name, email: u.email, role: u.role, departmentId: u.departmentId };
}

export async function requireUser() {
  if (DEV_BYPASS) return await devUser();
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session.user;
}

export async function requireRole(...roles: Role[]) {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/403");
  return user;
}

export function canSeeAssignment(
  viewer: { id: string; role: Role; departmentId: string | null },
  target: { userId: string; user?: { departmentId: string | null } }
) {
  if (viewer.role === "ADMIN") return true;
  if (viewer.id === target.userId) return true;
  if (
    viewer.role === "MANAGER" &&
    viewer.departmentId &&
    target.user?.departmentId === viewer.departmentId
  ) {
    return true;
  }
  return false;
}
