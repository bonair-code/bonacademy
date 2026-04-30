import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const dep = await prisma.department.upsert({
    where: { name: "Uçuş Operasyon" },
    update: {},
    create: { name: "Uçuş Operasyon" },
  });

  const adminEmail = (
    process.env.SEED_ADMIN_EMAIL || "admin@bonair.com.tr"
  )
    .trim()
    .toLowerCase();
  const adminName = process.env.SEED_ADMIN_NAME || "Sistem Yöneticisi";
  const initialPassword = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";
  const passwordHash = await bcrypt.hash(initialPassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    // Mevcut admin kullanıcı için sadece şifre güncelleniyor — başka alanların
    // (rol, departman, isim) yanlışlıkla seed ile sıfırlanmaması için.
    update: { passwordHash },
    create: {
      email: adminEmail,
      name: adminName,
      role: Role.ADMIN,
      departmentId: dep.id,
      passwordHash,
    },
  });

  console.log(
    `Seed tamamlandı. Admin: ${adminEmail} · Şifre: ${initialPassword}`
  );
  if (initialPassword === "ChangeMe123!") {
    console.warn(
      "⚠️  SEED_ADMIN_PASSWORD env tanımlanmadı — varsayılan şifre kullanıldı. İlk girişte hemen değiştirin."
    );
  }
}

main().finally(() => prisma.$disconnect());
