import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { CertificatesList } from "./CertificatesList";

export default async function CertificatesPage() {
  const user = await requireUser();
  const certs = await prisma.certificate.findMany({
    where: { userId: user.id },
    include: { assignment: { include: { plan: { include: { course: true } } } } },
    orderBy: { issuedAt: "desc" },
  });

  return (
    <Shell user={user} title="Sertifikalarım" subtitle={`${certs.length} sertifika`}>
      <CertificatesList
        items={certs.map((c) => ({
          id: c.id,
          serialNo: c.serialNo,
          issuedAt: c.issuedAt.toISOString(),
          courseTitle: c.assignment.plan.course.title,
        }))}
      />
    </Shell>
  );
}
