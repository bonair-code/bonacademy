import React from "react";
import fs from "node:fs";
import path from "node:path";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  renderToBuffer,
} from "@react-pdf/renderer";

// Logoyu her istekte tekrar okumayalım.
let cachedLogo: Buffer | null = null;
function loadLogo(): Buffer | null {
  if (cachedLogo) return cachedLogo;
  try {
    const p = path.join(process.cwd(), "public", "Logo.png");
    cachedLogo = fs.readFileSync(p);
    return cachedLogo;
  } catch {
    return null;
  }
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Bekliyor",
  IN_PROGRESS: "Devam Ediyor",
  SCORM_COMPLETED: "Sınav Bekliyor",
  EXAM_PASSED: "Sınav Geçti",
  EXAM_FAILED: "Sınav Başarısız",
  RETAKE_REQUIRED: "Tekrar Gerekli",
  COMPLETED: "Tamamlandı",
  OVERDUE: "Gecikmiş",
};

const styles = StyleSheet.create({
  page: {
    padding: 32,
    fontSize: 9,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
    color: "#0f172a",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1pt solid #0f172a",
    paddingBottom: 10,
    marginBottom: 14,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { height: 32 },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 9, color: "#475569" },
  meta: { fontSize: 8, color: "#64748b", textAlign: "right" },

  kpiRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 14,
  },
  kpiBox: {
    flex: 1,
    border: "1pt solid #e2e8f0",
    borderRadius: 4,
    padding: 8,
  },
  kpiLabel: { fontSize: 7, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 },
  kpiValue: { fontSize: 16, fontFamily: "Helvetica-Bold", marginTop: 2 },

  memberBlock: {
    marginBottom: 10,
    border: "1pt solid #e2e8f0",
    borderRadius: 4,
    padding: 8,
  },
  memberHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
    paddingBottom: 4,
    borderBottom: "1pt solid #e2e8f0",
  },
  memberName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  memberMeta: { fontSize: 8, color: "#64748b", marginTop: 1 },
  memberStats: { fontSize: 8, color: "#334155" },

  row: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottom: "0.5pt solid #f1f5f9",
  },
  col: { paddingHorizontal: 2 },
  colCourse: { flex: 3 },
  colCycle: { width: 32, textAlign: "center" },
  colDue: { width: 64, textAlign: "center" },
  colStatus: { width: 80, textAlign: "right" },
  th: { fontSize: 7, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 },

  overdue: { color: "#b91c1c", fontFamily: "Helvetica-Bold" },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 32,
    right: 32,
    fontSize: 7,
    color: "#94a3b8",
    textAlign: "center",
  },
  empty: { fontSize: 9, color: "#64748b", fontStyle: "italic" },
});

export type TeamMemberSummary = {
  id: string;
  name: string;
  email: string;
  department: string | null;
  assignments: Array<{
    id: string;
    courseTitle: string;
    cycleNumber: number;
    dueDate: Date;
    status: string;
  }>;
};

export type TeamSummaryPdfInput = {
  managerName: string;
  scopeLabel: string; // "Ekibim" / "Tüm Şirket"
  generatedAt: Date;
  members: TeamMemberSummary[];
};

function fmtDate(d: Date) {
  return d.toLocaleDateString("tr-TR");
}

function fmtDateTime(d: Date) {
  return d.toLocaleString("tr-TR");
}

function MemberBlock({ m, now }: { m: TeamMemberSummary; now: Date }) {
  const total = m.assignments.length;
  const completed = m.assignments.filter(
    (a) => a.status === "COMPLETED" || a.status === "EXAM_PASSED"
  ).length;
  const overdue = m.assignments.filter(
    (a) => a.status === "OVERDUE" || (a.dueDate < now && a.status !== "COMPLETED")
  ).length;

  return (
    <View style={styles.memberBlock} wrap={false}>
      <View style={styles.memberHeader}>
        <View>
          <Text style={styles.memberName}>{m.name || "(isimsiz)"}</Text>
          <Text style={styles.memberMeta}>
            {m.email}
            {m.department ? ` · ${m.department}` : ""}
          </Text>
        </View>
        <Text style={styles.memberStats}>
          {completed}/{total} tamamlandı
          {overdue > 0 ? `  ·  ${overdue} gecikmiş` : ""}
        </Text>
      </View>

      {m.assignments.length === 0 ? (
        <Text style={styles.empty}>Atama yok.</Text>
      ) : (
        <View>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <Text style={[styles.col, styles.colCourse, styles.th]}>Kurs</Text>
            <Text style={[styles.col, styles.colCycle, styles.th]}>Dön.</Text>
            <Text style={[styles.col, styles.colDue, styles.th]}>Son Tarih</Text>
            <Text style={[styles.col, styles.colStatus, styles.th]}>Durum</Text>
          </View>
          {m.assignments.map((a) => {
            const isOverdue = a.dueDate < now && a.status !== "COMPLETED";
            return (
              <View key={a.id} style={styles.row}>
                <Text style={[styles.col, styles.colCourse]}>{a.courseTitle}</Text>
                <Text style={[styles.col, styles.colCycle]}>{a.cycleNumber}</Text>
                <Text style={[styles.col, styles.colDue, isOverdue ? styles.overdue : {}]}>
                  {fmtDate(a.dueDate)}
                </Text>
                <Text style={[styles.col, styles.colStatus]}>
                  {STATUS_LABEL[a.status] ?? a.status}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

export async function renderTeamSummaryPdf(input: TeamSummaryPdfInput): Promise<Buffer> {
  const logo = loadLogo();
  const now = input.generatedAt;

  // Özet KPI'leri
  const allAssignments = input.members.flatMap((m) => m.assignments);
  const totalAssignments = allAssignments.length;
  const totalCompleted = allAssignments.filter(
    (a) => a.status === "COMPLETED" || a.status === "EXAM_PASSED"
  ).length;
  const totalOverdue = allAssignments.filter(
    (a) => a.status === "OVERDUE" || (a.dueDate < now && a.status !== "COMPLETED")
  ).length;
  const totalActive = totalAssignments - totalCompleted;

  const doc = (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {logo ? <Image src={logo} style={styles.logo} /> : null}
            <View>
              <Text style={styles.title}>Ekibim Özeti</Text>
              <Text style={styles.subtitle}>
                {input.scopeLabel} · {input.members.length} kişi
              </Text>
            </View>
          </View>
          <View>
            <Text style={styles.meta}>Hazırlayan: {input.managerName}</Text>
            <Text style={styles.meta}>{fmtDateTime(now)}</Text>
          </View>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Toplam Atama</Text>
            <Text style={styles.kpiValue}>{totalAssignments}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Tamamlanan</Text>
            <Text style={[styles.kpiValue, { color: "#059669" }]}>{totalCompleted}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Aktif</Text>
            <Text style={[styles.kpiValue, { color: "#0891b2" }]}>{totalActive}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Gecikmiş</Text>
            <Text style={[styles.kpiValue, { color: "#b91c1c" }]}>{totalOverdue}</Text>
          </View>
        </View>

        {input.members.length === 0 ? (
          <Text style={styles.empty}>Ekipte kayıtlı kullanıcı yok.</Text>
        ) : (
          input.members.map((m) => <MemberBlock key={m.id} m={m} now={now} />)
        )}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `Bon Air Academy · Sayfa ${pageNumber} / ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
