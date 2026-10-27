/**
 * Müşterinin (CUSTOMER) kendi eğitim kayıtları — eğitim başına bir grup.
 *
 * Personel bu sayfayı GÖRMEZ: onlar için "/certificates" kendi tam kaydını
 * açıyor (MyRecord → StaffDetail), çünkü Users/Follow-Up'tan görülen kişi
 * sayfasıyla aynı bilgiyi iki ayrı yerde tutmak ikisinin de kaymasına yol
 * açıyordu. Müşteride departman ve yetki kapsamı yok; kurallar da
 * `departments`/`jobTitles` okumasını ona kapatıyor, dolayısıyla o sayfa
 * müşteride zaten çalışmaz. Kalan sade görünüm bu.
 *
 * Gruplama ve kart tasarımı components/RecordHistory.tsx'te — iki ekran
 * aynı bileşeni kullanıyor.
 */
import { PageHead } from "../components/PageHead";
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import type { Cert } from "../components/CertificateSheet";
import { FilePreview } from "../components/FilePreview";
import {
  CertModal,
  RecordHistory,
  RecordTally,
  courseMetaMap,
  recordCounts,
  useRecordGroups,
  type CourseMeta,
} from "../components/RecordHistory";

export function Certificates() {
  const { profile } = useAuth();
  const [certs, setCerts] = useState<any[]>([]);
  const [externals, setExternals] = useState<any[]>([]);
  const [courses, setCourses] = useState<Map<string, CourseMeta>>(new Map());
  const [view, setView] = useState<Cert | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string; title: string } | null>(null);

  useEffect(() => {
    if (!profile) return;
    const u1 = onSnapshot(
      query(
        collection(db, "certificates"),
        where("userId", "==", profile.uid),
        // Kural kendi belgesini yalnızca engellenmemişken açıyor; süzgeç
        // sorguda olmak zorunda, yoksa sorgunun tamamı reddedilir.
        where("blocked", "==", false)
      ),
      (s) => setCerts(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
    );
    const u2 = onSnapshot(
      query(collection(db, "externalTrainings"), where("userId", "==", profile.uid)),
      (s) => setExternals(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
    );
    const u3 = onSnapshot(collection(db, "courses"), (s) =>
      setCourses(courseMetaMap(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))))
    );
    return () => {
      u1();
      u2();
      u3();
    };
  }, [profile]);

  const groups = useRecordGroups(certs, externals, courses);

  return (
    <div>
      <PageHead
        title="My Certificates"
      />

      {groups.length > 0 && <RecordTally counts={recordCounts(groups)} />}

      <RecordHistory
        groups={groups}
        onView={setView}
        onPreview={setPreview}
        empty="You have no training records yet."
      />

      {view && <CertModal cert={view} onClose={() => setView(null)} />}

      {preview && (
        <FilePreview
          url={preview.url}
          fileName={preview.name}
          title={preview.title}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
