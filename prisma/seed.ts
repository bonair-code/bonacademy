import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const dep = await prisma.department.upsert({
    where: { name: "Uçuş Operasyon" },
    update: {},
    create: { name: "Uçuş Operasyon" },
  });

  const initialPassword = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";
  const passwordHash = await bcrypt.hash(initialPassword, 10);

  await prisma.user.upsert({
    where: { email: "admin@bonair.com.tr" },
    update: { passwordHash },
    create: {
      email: "admin@bonair.com.tr",
      name: "Sistem Yöneticisi",
      role: Role.ADMIN,
      departmentId: dep.id,
      passwordHash,
    },
  });

  console.log("Seed tamamlandı. Admin şifresi:", initialPassword);
}

main().finally(() => prisma.$disconnect());
