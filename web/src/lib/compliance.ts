import { collection, onSnapshot, query, where } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "./firebase";
import { requirementFor, type Scope } from "./requirements";
import { heldMethods, methodBreakdown, methodsOf, worstOf } from "./methods";
import { isStaffRole, type Role } from "./auth";

/**
 * Kurum uygunluk özeti — Training Follow-Up ile AYNI hesabı yapar, ama
 * satır satır matris yerine "kimde ne eksik" listesi üretir.
 *
 * Dashboard bunu kullanıyor: bir admin/müdür açtığında görmesi gereken şey
 * kendi üç ataması değil, kurumun nerede açık verdiği.
 */

const DAY = 86400000;

export type Finding = {
  userId: string;
  userName: string;
  departmentId: string | null;
  courseId: string;
  courseTitle: string;
  /**
   * MISSING: kişi bu eğitime sahip değil — hiç alınmamış ya da atanmış ama
   *          vadesi geçmiş. EXPIRED: almış, geçerliliği dolmuş.
   * SOON:    geçerliliği 90 gün içinde dolacak.
   */
  kind: "MISSING" | "EXPIRED" | "SOON";
  /** Kalan gün; negatif = geçmiş. MISSING'te vadesi geçmişse gecikme. */
  days: number | null;
};

export type ComplianceSummary = {
  loading: boolean;
  findings: Finding[];
  missing: number;
  expired: number;
  soon: number;
  /** Açığı olan personel sayısı (aynı kişi birden çok satırda sayılmaz). */
  staffAtRisk: number;
  staffTotal: number;
};

type AnyRow = Record<string, any>;

function addValidity(base: Date, every?: number | null, unit?: string): Date | null {
  if (!every || !unit || unit === "NONE") return null;
  const d = new Date(base);
  if (unit === "DAY") d.setDate(d.getDate() + every);
  else if (unit === "MONTH") d.setMonth(d.getMonth() + every);
  else if (unit === "YEAR") d.setFullYear(d.getFullYear() + every);
  else return null;
  return d;
}

export function useCompliance(
  profile: { uid: string; departmentId: string | null } | null,
  role: Role | null
): ComplianceSummary {
  const [users, setUsers] = useState<AnyRow[]>([]);
  const [courses, setCourses] = useState<AnyRow[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [certs, setCerts] = useState<AnyRow[]>([]);
  const [assignments, setAssignments] = useState<AnyRow[]>([]);
  const [externals, setExternals] = useState<AnyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile || !role) return;
    // Müdür yalnızca kendi departmanını okuyabilir; kapsamsız sorgu komple
    // reddedilir, o yüzden her koleksiyon role göre daraltılır.
    const seesAll = role === "ADMIN" || role === "INSTRUCTOR";
    const dept = profile.departmentId;
    const scoped = (name: string, field: string) =>
      seesAll ? query(collection(db, name)) : query(collection(db, name), where(field, "==", dept));
    const silent = () => {};

    const subs = [
      onSnapshot(
        scoped("users", "departmentId"),
        (s) => {
          setUsers(s.docs.map((d) => ({ id: d.id, ...(d.data() as AnyRow) })));
          setLoading(false);
        },
        () => setLoading(false)
      ),
      onSnapshot(collection(db, "courses"), (s) =>
        setCourses(s.docs.map((d) => ({ id: d.id, ...(d.data() as AnyRow) })))
      ),
      onSnapshot(collection(db, "jobTitles"), (s) =>
        setScopes(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
      ),
      onSnapshot(scoped("certificates", "userDepartmentId"), (s) =>
        setCerts(s.docs.map((d) => d.data() as AnyRow)), silent),
      onSnapshot(scoped("assignments", "userDepartmentId"), (s) =>
        setAssignments(s.docs.map((d) => d.data() as AnyRow)), silent),
      onSnapshot(scoped("externalTrainings", "userDepartmentId"), (s) =>
        setExternals(s.docs.map((d) => d.data() as AnyRow)), silent),
    ];
    return () => subs.forEach((u) => u());
  }, [profile?.uid, profile?.departmentId, role]);

  return useMemo(() => {
    const now = Date.now();

    // (userId|courseId) → EN SON tamamlama. İç sertifika + dış eğitim birlikte.
    //
    // Dış kaydın geçerliliği kursun tekrar süresinden değil, belgenin kendi
    // bitiş tarihinden gelir — bu yüzden tarih ile birlikte taşınır. Aynı kurs
    // için birden fazla dış kayıt olabiliyor; kazanan en son TAMAMLANAN kayıt
    // olmalı. Eskiden döngüde en son gelen kazanıyordu, yani rastgeleydi.
    type Done = { date: Date; expiry: Date | null; external: boolean };
    const done = new Map<string, Done>();
    const put = (uid: string, cid: string, d: Done | null) => {
      if (!uid || !cid || !d) return;
      const k = `${uid}|${cid}`;
      const prev = done.get(k);
      if (!prev || d.date > prev.date) done.set(k, d);
    };
    for (const c of certs) {
      const d = (c.issuedAt as Timestamp)?.toDate?.();
      if (d) put(c.userId, c.courseId, { date: d, expiry: null, external: false });
    }
    for (const e of externals) {
      const d = (e.completedAt as Timestamp)?.toDate?.();
      if (d)
        put(e.userId, e.courseId, {
          date: d,
          expiry: (e.expiresAt as Timestamp)?.toDate?.() ?? null,
          external: true,
        });
    }

    /** (userId, courseId) → o kursun bütün dış kayıtları; metod dökümü için. */
    const methodRecs = new Map<string, { method?: string | null; date: Date; expiry: Date | null }[]>();
    for (const e of externals) {
      const d = (e.completedAt as Timestamp)?.toDate?.();
      if (!d || !e.userId || !e.courseId) continue;
      const k = `${e.userId}|${e.courseId}`;
      methodRecs.set(k, [
        ...(methodRecs.get(k) ?? []),
        { method: e.method ?? null, date: d, expiry: (e.expiresAt as Timestamp)?.toDate?.() ?? null },
      ]);
    }

    const openAssignments = assignments.filter(
      (a) => a.status !== "COMPLETED" && a.status !== "EXAM_PASSED"
    );
    const assignedSet = new Set(openAssignments.map((a) => `${a.userId}|${a.courseId}`));
    const openByKey = new Map(openAssignments.map((a) => [`${a.userId}|${a.courseId}`, a]));

    // Müşteri personel değil: kurum uyum yüzdesini ve eksik listesini bozmasın.
    const activeUsers = users.filter((u) => u.isActive !== false && isStaffRole(u.role));
    const findings: Finding[] = [];

    for (const u of activeUsers) {
      for (const c of courses) {
        if (!requirementFor(c as any, u.jobTitleIds ?? [], scopes, u.subScopeIds ?? [])) continue;
        const k = `${u.id}|${c.id}`;
        const d = done.get(k);
        const base = {
          userId: u.id,
          userName: u.name ?? "",
          departmentId: u.departmentId ?? null,
          courseId: c.id,
          courseTitle: c.title ?? "",
        };

        /**
         * Metod bazlı eğitim: en kötü metod belirler. Follow-Up matrisi ile
         * AYNI kuralı kullanmak zorunda — iki ekranın farklı cevap vermesi
         * daha önce başımıza gelmişti.
         */
        const ticked = heldMethods(u, c.id);
        if (methodsOf(c as any).length > 0 && ticked.length > 0) {
          const rows = methodBreakdown(ticked, methodRecs.get(k) ?? []);
          const w = worstOf(rows);
          if (w.missing.length > 0) {
            findings.push({
              ...base,
              courseTitle: `${base.courseTitle} (${w.missing.join(", ")})`,
              kind: "MISSING",
              days: null,
            });
            continue;
          }
          if (w.expiry) {
            const days = Math.round((w.expiry.getTime() - now) / DAY);
            if (days < 0) findings.push({ ...base, kind: "EXPIRED", days });
            else if (days <= 90) findings.push({ ...base, kind: "SOON", days });
          }
          continue;
        }
        if (!d) {
          // Atanmış ve vadesi GELMEMİŞSE açık sayılmaz — iş sürüyor.
          // Vadesi geçmişse kişi o eğitime sahip değil demektir; eksik.
          const a = openByKey.get(k);
          const due = (a?.dueDate as Timestamp)?.toMillis?.() ?? null;
          const late = due !== null && due < now;
          if (!assignedSet.has(k) || late) {
            findings.push({
              ...base,
              kind: "MISSING",
              days: late && due !== null ? Math.round((due - now) / DAY) : null,
            });
          }
          continue;
        }
        // Dış belgede geçerlilik belgenin kendi tarihinden; iç sertifikada
        // kursun tekrar süresinden hesaplanır.
        const exp = d.external
          ? d.expiry
          : addValidity(d.date, c.recurrenceEvery, c.recurrenceUnit);
        if (!exp) continue;
        const days = Math.round((exp.getTime() - now) / DAY);
        if (days < 0) findings.push({ ...base, kind: "EXPIRED", days });
        else if (days <= 90) findings.push({ ...base, kind: "SOON", days });
      }
    }

    // En acil önce: süresi geçmiş → eksik → yaklaşan.
    const rank = { EXPIRED: 0, MISSING: 1, SOON: 2 } as const;
    findings.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.days ?? 0) - (b.days ?? 0));

    return {
      loading,
      findings,
      missing: findings.filter((f) => f.kind === "MISSING").length,
      expired: findings.filter((f) => f.kind === "EXPIRED").length,
      soon: findings.filter((f) => f.kind === "SOON").length,
      staffAtRisk: new Set(findings.map((f) => f.userId)).size,
      staffTotal: activeUsers.length,
    };
  }, [users, courses, scopes, certs, assignments, externals, loading]);
}
