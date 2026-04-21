import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, departmentId: true, isActive: true },
  });
  if (!u || !u.isActive) redirect("/login");
  return { id: u.id, name: u.name, email: u.email, role: u.role, departmentId: u.departmentId };
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
