import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { PageHead } from "../components/PageHead";
import type { Cert } from "../components/CertificateSheet";
import {
  CertModal,
  RecordHistory,
  courseMetaMap,
  useRecordGroups,
} from "../components/RecordHistory";
import { Modal } from "../components/Modal";
import { RowMenu } from "../components/RowMenu";
import { ExternalCertForm } from "../components/ExternalCertForm";
import { requirementFor } from "../lib/requirements";
import {
  DAY,
  daysLeft,
  expiryOf,
  fmt,
  isAssignmentOpen,
  keyOf,
  pickLatest,
  resolveCoverage,
  type Coverage,
} from "../lib/records";
import {
  AssignPanel,
  DeleteConfirm,
  PasswordReset,
  ROLE_LABEL,
  UserForm,
  type MethodCourse,
  type Ref,
  type ScopeRef,
  type UserRow,
} from "../components/user/UserDialogs";
import { PrintButton } from "../components/PrintButton";
import { printReport } from "../lib/print";
import { FilePreview } from "../components/FilePreview";

type CourseRow = {
  id: string;
  title: string;
  isActive?: boolean;
  delivery?: string;
  methods?: string[];
  recurrenceEvery?: number | null;
  recurrenceUnit?: string;
};

/**
 * Ekran "C" tasarımı (CAPELLA/kullanici-detay-tasarimlari.html): sekme yok;
 * dört widget ve onlara göre süzülen tek liste.
 *   all  — kişinin ilgili olduğu her eğitim (en acili üstte)
 *   att  — dikkat: eksik, süresi dolmuş, SOON_DAYS içinde dolacak
 *   next — süresi olan geçerli eğitimler, en yakın bitiş üstte
 *   cert — BonAir sertifikaları + TÜM dış kayıtlar
 */
type Filter = "all" | "att" | "next" | "cert";
const FILTER_TITLE: Record<Filter, string> = {
  all: "All training",
  att: "Needs attention",
  next: "Expiring next",
  cert: "Certificates & records",
};
/** Bu kadar gün içinde dolacak geçerli eğitim "dikkat" sayılır. */
const SOON_DAYS = 90;
type ExternalRow = {
  id: string;
  courseId: string | null;
  title: string;
  provider: string;
  completedAt?: Timestamp | null;
  expiresAt?: Timestamp | null;
  fileUrl?: string;
  fileName?: string | null;
  externalSerialNo?: string | null;
  /** Metod bazlı eğitimde bu kaydın metodu (ör. NDT → PT). */
  method?: string | null;
};


type Line = {
  course: CourseRow;
  required: boolean;
  state: "DONE" | "PLANNED" | "MISSING";
  /** Gereklilik başka eğitimlerle karşılandıysa onların kayıtları. */
  via?: Coverage["via"];
  date: Date | null;
  expires: Date | null;
  days: number | null;
  external: ExternalRow | null;
  certificateId: string | null;
};

/**
 * Bir kişinin tam kaydı.
 *
 * İki yerden açılıyor: yöneticiler `/team/:userId` ile başkasının kaydını,
 * personel `/certificates` ile KENDİ kaydını görüyor (`self`). Aynı bilgiyi
 * iki ayrı ekranda tutmak ikisinin de kaymasına yol açıyordu; sorguların
 * hepsi zaten `userId` ile sınırlı ve kurallar kişinin kendi kaydını
 * okumasına izin veriyor, bu yüzden tek bileşen ikisine de yetiyor.
 */
export function StaffDetail({ self = false }: { self?: boolean } = {}) {
  const params = useParams<{ userId: string }>();
  const { profile, role } = useAuth();
  const navigate = useNavigate();
  const userId = self ? profile?.uid : params.userId;

  const [user, setUser] = useState<UserRow | null>(null);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [jobTitles, setJobTitles] = useState<
    (ScopeRef & { requiredCourseIds?: string[] })[]
  >([]);
  const [departments, setDepartments] = useState<Map<string, string>>(new Map());
  const [certs, setCerts] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [externals, setExternals] = useState<ExternalRow[]>([]);
  const [preview, setPreview] = useState<{ url: string; name: string; title: string } | null>(
    null
  );
  /** Tam boy gösterilen sertifika (Certificates sekmesindeki "View"). */
  const [certView, setCertView] = useState<Cert | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [dialog, setDialog] = useState<
    | { kind: "add"; course: CourseRow | null }
    | { kind: "remove"; row: ExternalRow }
    | { kind: "edit"; row: ExternalRow }
    | { kind: "force"; line: Line }
    // Kişi yönetimi — eskiden yalnızca Users sayfasının satır menüsünde vardı.
    | { kind: "editUser" }
    | { kind: "password" }
    | { kind: "assign"; preselect?: string[] }
    | { kind: "deleteUser" }
    | null
  >(null);
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !profile) return;
    const onErr = (e: { message: string }) => setErr(e.message);
    /**
     * Sorgunun süzgeci KURALA uymak zorunda: Firestore kuralı bir süzgeç
     * değil — sorgunun tamamını ya kabul eder ya reddeder.
     *  - admin / eğitmen: koşulsuz okuyabiliyor,
     *  - müdür: yalnız kendi departmanı, yani `userDepartmentId` süzgeci ŞART.
     *    Bu olmadan müdür başka birinin sayfasını açınca sorgu komple
     *    reddediliyor ve ekran boş kalıyordu,
     *  - kişinin kendisi: sertifikada ayrıca `blocked == false` şart.
     * Hepsi eşitlik süzgeci; bileşik indeks gerekmiyor.
     */
    const openly = role === "ADMIN" || role === "INSTRUCTOR";
    const asManager = !openly && role === "MANAGER";
    const deptScope = asManager
      ? [where("userDepartmentId", "==", profile.departmentId ?? null)]
      : [];
    const subs = [
      onSnapshot(doc(db, "users", userId), (d) =>
        setUser(d.exists() ? ({ id: d.id, ...(d.data() as any) }) : null), onErr),
      onSnapshot(query(collection(db, "courses"), orderBy("title")), (s) =>
        setCourses(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))),
      onSnapshot(collection(db, "jobTitles"), (s) =>
        setJobTitles(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))),
      onSnapshot(collection(db, "departments"), (s) =>
        setDepartments(new Map(s.docs.map((d) => [d.id, (d.data() as any).name])))),
      onSnapshot(
        query(
          collection(db, "certificates"),
          where("userId", "==", userId),
          ...(openly || asManager ? [] : [where("blocked", "==", false)]),
          ...deptScope
        ),
        (s) => setCerts(s.docs.map((d) => ({ __id: d.id, ...(d.data() as any) }))), onErr),
      onSnapshot(
        query(collection(db, "assignments"), where("userId", "==", userId), ...deptScope), (s) =>
        setAssignments(s.docs.map((d) => d.data())), onErr),
      onSnapshot(
        query(collection(db, "externalTrainings"), where("userId", "==", userId), ...deptScope), (s) =>
        setExternals(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), onErr),
    ];
    return () => subs.forEach((u) => u());
  }, [userId, profile]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Zorunluluk tek kaynaktan: kişinin authorisation scope'ları ve her kapsamın
  // gerekli eğitim listesi. Kapsamı olmayan personelde kurs N/A kalır.
  const requiredIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of courses) {
      if (requirementFor(c, user?.jobTitleIds ?? [], jobTitles, user?.subScopeIds ?? []))
        set.add(c.id);
    }
    return set;
  }, [courses, jobTitles, user]);

  // Kişinin ilgili olduğu her kurs: zorunlu olanlar + atanmışlar + tamamlananlar.
  const lines: Line[] = useMemo(() => {
    const assignedIds = new Set(
      assignments.filter((a) => isAssignmentOpen(a.status)).map((a) => a.courseId)
    );
    // Kazanan kayıt kuralı lib/records.ts'de: aynı kurs için birden fazla
    // kayıt varsa EN SON tamamlanan kazanır.
    const certByCourse = new Map<string, { date: Date; id: string }>();
    for (const c of certs) {
      const dt = (c.issuedAt as Timestamp)?.toDate?.();
      if (!dt || !c.courseId) continue;
      pickLatest(certByCourse, c.courseId, { date: dt, id: c.__id });
    }
    const extByCourse = new Map<string, ExternalRow & { date: Date }>();
    for (const e of externals) {
      const dt = e.completedAt?.toDate?.();
      if (!dt || !e.courseId) continue;
      pickLatest(extByCourse, e.courseId, { ...e, date: dt });
    }

    const relevant = courses.filter(
      (c) => requiredIds.has(c.id) || assignedIds.has(c.id) || certByCourse.has(c.id) || extByCourse.has(c.id)
    );

    /**
     * resolveCoverage, matristekiyle AYNI girdiyi bekliyor: (kişi|kurs) →
     * kazanan kayıt. Burada tek kişi var, yine de aynı anahtar biçimi
     * kullanılıyor ki iki ekran aynı fonksiyonu paylaşsın.
     */
    const courseById = new Map(courses.map((c) => [c.id, c]));
    const completions = new Map<
      string,
      { date: Date; external?: string | null; expiresAt?: Date | null }
    >();
    for (const c of courses) {
      const e = extByCourse.get(c.id) ?? null;
      const cert = certByCourse.get(c.id) ?? null;
      const eDate = e?.completedAt?.toDate?.() ?? null;
      const iDate = cert?.date ?? null;
      const viaExt = !!eDate && (!iDate || eDate > iDate);
      const d = viaExt ? eDate : iDate;
      if (!d || !user) continue;
      completions.set(keyOf(user.id, c.id), {
        date: d,
        external: viaExt ? e?.provider ?? "External" : null,
        expiresAt: viaExt ? e?.expiresAt?.toDate?.() ?? null : null,
      });
    }

    return relevant.map((course) => {
      const ext = extByCourse.get(course.id) ?? null;
      const internalCert = certByCourse.get(course.id) ?? null;
      const internal = internalCert?.date ?? null;
      const extDate = ext?.completedAt?.toDate?.() ?? null;
      // En son alınan geçerli sayılır — iç ya da dış fark etmez.
      const useExt = !!extDate && (!internal || extDate > internal);
      const date = useExt ? extDate : internal;

      /**
       * Kursun kendi kaydı yoksa eşdeğer eğitimlere bakılır (Safety = SMS + HF).
       * Kural lib/records.ts'de — matris ve bu sayfa aynı fonksiyonu kullanmak
       * zorunda, yoksa aynı kişi iki ekranda farklı görünür (daha önce oldu).
       */
      if (!date && user) {
        const cover = resolveCoverage(user.id, course, completions, courseById);
        if (cover && cover.via) {
          return {
            course,
            required: requiredIds.has(course.id),
            state: "DONE" as const,
            date: cover.date,
            expires: cover.expiry,
            days: daysLeft(cover.expiry),
            external: null,
            certificateId: null,
            via: cover.via,
          };
        }
      }

      if (date) {
        const expires = expiryOf(
          { date, external: useExt, externalExpiry: ext?.expiresAt?.toDate?.() ?? null },
          course
        );
        return {
          course,
          required: requiredIds.has(course.id),
          state: "DONE" as const,
          date,
          expires,
          days: daysLeft(expires),
          external: useExt ? ext : null,
          certificateId: useExt ? null : internalCert?.id ?? null,
        };
      }
      return {
        course,
        required: requiredIds.has(course.id),
        state: assignedIds.has(course.id) ? ("PLANNED" as const) : ("MISSING" as const),
        date: null,
        expires: null,
        days: null,
        external: null,
        certificateId: null,
      };
    });
  }, [courses, requiredIds, assignments, certs, externals]);

  /**
   * Sertifikanın MUTLAK adresi — raporun PDF'ine tıklanabilir link olarak
   * gitsin diye. Tercih herkese açık doğrulama sayfası: raporu okuyan kişi
   * (çoğu zaman bir denetçi) giriş yapmadan açabilsin. Göreli adres
   * (<Link to=…>) PDF'te tıklanacak bir şeye dönüşmüyor.
   */
  const certHref = (certificateId: string) => {
    const c = certs.find((x) => x.__id === certificateId);
    const base = window.location.origin;
    return c?.verifyToken
      ? `${base}/verify/${encodeURIComponent(c.verifyToken)}`
      : `${base}/certificate/${certificateId}`;
  };

  /** UserForm departman listesini dizi bekliyor; sayfa Map tutuyor. */
  const departmentList: Ref[] = useMemo(
    () => [...departments.entries()].map(([id, name]) => ({ id, name })),
    [departments]
  );
  /** Metodlara bölünmüş eğitimler — kişi formunda metod tikleri için. */
  const methodCourses: MethodCourse[] = useMemo(
    () =>
      courses
        .filter((c) => (c.methods ?? []).length > 0)
        .map((c) => ({ id: c.id, title: c.title, methods: c.methods ?? [] })),
    [courses]
  );
  /** Atanabilir eğitimler: dış eğitim sistemde tamamlanamaz, yayında olmayanın içeriği yok. */
  const assignableCourses: Ref[] = useMemo(
    () =>
      courses
        .filter((c) => c.delivery !== "EXTERNAL_ONLY" && c.isActive !== false)
        .map((c) => ({ id: c.id, name: c.title })),
    [courses]
  );

  const missing = lines.filter((l) => l.state === "MISSING");
  const planned = lines.filter((l) => l.state === "PLANNED");
  const done = lines.filter((l) => l.state === "DONE");
  const expired = done.filter((l) => l.days !== null && l.days < 0);
  const isExpired = (l: Line) => l.days !== null && l.days < 0;
  const isSoon = (l: Line) => l.days !== null && l.days >= 0 && l.days <= SOON_DAYS;
  const soon = done.filter(isSoon).sort((a, b) => a.days! - b.days!);
  const valid = done.filter((l) => !isExpired(l));
  const attention = [...expired, ...missing, ...soon];
  /** Süresi olan geçerli eğitimler, en yakın bitiş üstte. */
  const upcoming = done
    .filter((l) => l.days !== null && l.days >= 0)
    .sort((a, b) => a.days! - b.days!);
  const openByCourse = new Map(
    assignments.filter((a) => isAssignmentOpen(a.status)).map((a) => [a.courseId as string, a])
  );


  /**
   * Eğitim başına gruplanmış kayıtlar — Certificates sekmesi.
   * Bütün erken return'lerin ÜSTÜNDE: kanca her render'da aynı sırada
   * çağrılmak zorunda (eslint react-hooks/rules-of-hooks).
   */
  const recordGroups = useRecordGroups(certs, externals, courseMetaMap(courses));

  /**
   * Kurs kimliğine göre kayıt grubu — satırın altında geçmişi açmak için.
   * `recordGroups` anahtarı ya kurs kimliği ya da `t:<başlık>`; buraya
   * yalnız gerçek bir kursa bağlı olanlar giriyor.
   */
  const groupByCourse = useMemo(() => {
    const m = new Map<string, (typeof recordGroups)[number]>();
    for (const g of recordGroups) if (!g.key.startsWith("t:")) m.set(g.key, g);
    return m;
  }, [recordGroups]);

  /**
   * Hiçbir kursa bağlanmamış eski kayıtlar. Liste kurslardan kurulduğu için
   * bunlar hiçbir satıra düşmüyordu ve yalnız Certificates sekmesinde
   * görünüyordu — kâğıttan aktarılan belgelerin bir kısmı bu durumda
   * (ör. "GLOBAL_ENGINE RUN-UP_TRAINING"). Bir uygunluk boşluğu kapatmazlar
   * ama kişinin geçmişinin parçasıdırlar; listenin sonunda duruyorlar.
   */
  const unlinkedGroups = useMemo(() => {
    // Kurslar henüz gelmediyse hiçbir şey "bağlantısız" sayılmaz; yoksa ilk
    // render'da bütün kayıtlar bir an "Other records" altında görünürdü.
    if (courses.length === 0) return [];
    const ids = new Set(courses.map((c) => c.id));
    return recordGroups.filter((g) => g.key.startsWith("t:") || !ids.has(g.key));
  }, [recordGroups, courses]);

  /** Geçmişi açık olan eğitim satırları. */
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});

  /**
   * KAYIT işlemleri: dış sertifika ekle/değiştir/sil. Kurallar müdüre kendi
   * departmanı için izin veriyor (externalTrainings create/update).
   * Kişi kendi kaydına bakarken kapalı — kimse kendi belgesini kendi giremez.
   */
  const canEdit =
    !self &&
    (role === "ADMIN" || (role === "MANAGER" && user?.departmentId === profile?.departmentId));
  /**
   * HESAP işlemleri: bilgileri düzenle, şifre sıfırla, aktif/pasif, sil.
   * Sunucuda üçü de yalnızca ADMIN (updateUser ve deleteUser assertAdmin,
   * setUserPassword "admins only"). Müdüre göstermek, bastığında yetki
   * hatası yemesi demekti.
   */
  const canManageAccount = !self && role === "ADMIN";

  /**
   * PDF raporu. Antetli bir kurum kaydı dökümü, tek tek sertifikadan farklı:
   * denetimde gösterilen şey bu. Başkasının kaydını açabilen herkes
   * (admin, müdür, eğitmen) KENDİ kaydını da basabilir — müdür kendi
   * departmanıyla sınırlı, sayfa zaten ona göre açılıyor. Sıradan personel
   * ve müşteri basamaz; belgesi gerekiyorsa "View certificate"ten alır.
   */
  const canPrint =
    !self || role === "ADMIN" || role === "MANAGER" || role === "INSTRUCTOR";

  /**
   * Eğitim atamak kişiyi yönetmekten ayrı yetki: eğitimi veren atar. Müdür
   * personelinin kaydını düzenler ve dış eğitim girer, ama atama yapmaz.
   */
  const canAssign = role === "ADMIN" || role === "INSTRUCTOR";

  /** Hesabı aktif/pasif et. Users sayfasındaki ile aynı çağrı. */
  async function setActive(isActive: boolean) {
    if (!userId) return;
    setErr(null);
    try {
      await httpsCallable(functions, "updateUser")({ uid: userId, isActive });
      setToast(isActive ? "Account activated." : "Account deactivated.");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  // Kendi kaydını herkes görür; başkasınınkini yalnızca yönetici/eğitmen.
  if (!self && role !== "ADMIN" && role !== "MANAGER" && role !== "INSTRUCTOR")
    return <p className="text-sm text-slate-400 py-10">Not available for your role.</p>;

  if (!user)
    return (
      <div>
        <PageHead title={self ? "My Record" : "Staff"} />
        <p className="text-sm text-slate-400 py-10">
          {err ? err : "Loading…"}
        </p>
      </div>
    );

  const titleNames = (user.jobTitleIds ?? [])
    .map((id) => jobTitles.find((j) => j.id === id)?.name)
    .filter(Boolean) as string[];

  /** Ad soyaddan baş harfler (avatar). */
  const initials = user.name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i, all) => (i === 0 || i === all.length - 1 ? w[0] : ""))
    .join("")
    .toLocaleUpperCase("tr");

  const lineMenu = (l: Line) => [
    /**
     * Var olan kaydı DÜZELT — tarihi yanlış girilmiş bir belgeyi onarmanın
     * tek yolu yoktu: ya yenisi ekleniyordu (eskisi "earlier record" olarak
     * kalıyordu) ya da silinip baştan giriliyordu.
     */
    ...(l.external
      ? [{ label: "Edit record", icon: "✎", onClick: () => setDialog({ kind: "edit", row: l.external! }) }]
      : []),
    {
      // "Replace" yanıltıcıydı: bu, kaydın yerine geçmiyor, YENİ bir kayıt
      // açıyor ve eskisi geçmişte kalıyor. Yenileme akışı bu.
      label: l.external ? "Add newer record" : "Add external certificate",
      icon: "↑",
      onClick: () => setDialog({ kind: "add", course: l.course }),
    },
    ...(l.external
      ? [
          ...(l.external.fileUrl
            ? [
                {
                  label: "Open document",
                  icon: "↗",
                  onClick: () =>
                    setPreview({
                      url: l.external!.fileUrl!,
                      name: l.external!.fileName ?? "certificate.pdf",
                      title: l.external!.title,
                    }),
                },
              ]
            : []),
          {
            label: "Delete external record",
            icon: "🗑",
            danger: true,
            onClick: () => setDialog({ kind: "remove", row: l.external! }),
          },
        ]
      : []),
    // İçerik açılmadığı için kilitli kalan atamayı admin gerekçeyle kapatır.
    // Sınavı olan kurs bu yolla kapanmaz — Function reddeder.
    ...(role === "ADMIN" && l.state === "PLANNED"
      ? [{ label: "Mark as completed (admin)", icon: "✓", onClick: () => setDialog({ kind: "force", line: l }) }]
      : []),
  ];

  const assignedLabel = (status?: string) =>
    status === "ASSIGNED" ? "Assigned" : status === "EXAM_FAILED" ? "Exam failed — retake" : "In progress";

  /** Tek bir eğitim satırı: renk noktası, ad, kısa durum; sağda tek bilgi/işlem. */
  function renderLine(l: Line) {
    const exp = isExpired(l);
    const dueSoon = isSoon(l);
    const tone =
      l.state === "MISSING" || exp ? "bg-red-500" : dueSoon ? "bg-amber-500" : l.state === "PLANNED" ? "bg-sky-500" : "bg-emerald-500";
    const a = openByCourse.get(l.course.id);
    const cert = l.certificateId ? certs.find((c) => c.__id === l.certificateId) : null;
    const until = l.expires ? `until ${fmt(l.expires)}` : "no expiry";
    const sub =
      l.state === "MISSING"
        ? l.required
          ? "Required · not on record"
          : "Not on record"
        : exp
        ? `Expired ${-l.days!} day${l.days === -1 ? "" : "s"} ago · ${fmt(l.expires)}`
        : dueSoon
        ? `Expires ${fmt(l.expires)}${l.external ? ` · external · ${l.external.provider}` : ""}`
        : l.state === "PLANNED"
        ? `${assignedLabel(a?.status)}${a?.dueDate ? ` · due ${fmt(a.dueDate.toDate?.())}` : ""}`
        : [
            l.external ? `External · ${l.external.provider}` : cert?.serialNo ? `Certificate ${cert.serialNo}` : "BonAir",
            until,
          ].join(" · ");

    // Satıra basınca belgesi açılır: BonAir sertifikası ya da dış kaydın dosyası.
    const title = (
      <>
        <div className="text-[14px] font-medium text-slate-900 truncate">{l.course.title}</div>
        <div className={`text-[12px] mt-0.5 truncate ${exp ? "text-red-700" : "text-slate-500"}`}>{sub}</div>
      </>
    );
    const body =
      l.state === "DONE" && l.certificateId ? (
        <Link to={`/certificate/${l.certificateId}`} className="min-w-0 flex-1">
          {title}
        </Link>
      ) : l.external?.fileUrl ? (
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() =>
            setPreview({
              url: l.external!.fileUrl!,
              name: l.external!.fileName ?? "certificate.pdf",
              title: l.external!.title,
            })
          }
        >
          {title}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{title}</div>
      );

    // Bu eğitimin bütün kayıtları: güncel olan satırda zaten yazıyor,
    // kalanlar "earlier records" altında. Tek kaydı olanda açılacak bir şey
    // yok, o yüzden düğme de çıkmıyor.
    const g = groupByCourse.get(l.course.id);
    const older = g ? g.records.slice(1) : [];
    const histOpen = !!openHistory[l.course.id];

    return (
      <li key={l.course.id} className="flex flex-wrap items-center gap-3 pl-4 pr-2 py-2.5 min-h-[56px]">
        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${tone}`} />
        {body}
        {(l.state === "MISSING" || exp) && canAssign ? (
          <button
            onClick={() => setDialog({ kind: "assign", preselect: [l.course.id] })}
            className="shrink-0 text-[12.5px] font-semibold text-brand-700 rounded-full border border-slate-200 px-3 py-1 hover:bg-slate-50"
          >
            Assign
          </button>
        ) : dueSoon ? (
          <span className="shrink-0 text-[12.5px] font-semibold text-amber-700 tabular-nums">
            {l.days === 0 ? "today" : `${l.days} day${l.days === 1 ? "" : "s"}`}
          </span>
        ) : null}
        {canEdit ? (
          <RowMenu label={`Actions for ${l.course.title}`} items={lineMenu(l)} />
        ) : (
          <span className="w-7" />
        )}

        {older.length > 0 && (
          <button
            type="button"
            onClick={() => setOpenHistory((p) => ({ ...p, [l.course.id]: !p[l.course.id] }))}
            aria-expanded={histOpen}
            className="basis-full text-left text-[11.5px] text-slate-500 hover:text-slate-800 pl-[22px] -mt-1"
          >
            {histOpen ? "Hide" : "Show"} {older.length} earlier record{older.length === 1 ? "" : "s"}
          </button>
        )}
        {histOpen &&
          older.map((r) => (
            <div
              key={r.id}
              className="basis-full flex items-center gap-2.5 pl-[22px] pr-1 py-1.5 border-t border-slate-100 -mb-1"
            >
              <span className="text-[9.5px] font-bold uppercase tracking-[0.04em] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">
                {r.source === "BONACADEMY" ? "BonAcademy" : r.source === "PAPER" ? "On paper" : "External"}
              </span>
              <span className="min-w-0 flex-1 text-[11.5px] text-slate-600 truncate">
                {r.label}
                {r.serialNo ? ` · ${r.serialNo}` : ""} · {fmt(r.date)}
                {r.expiry ? ` → ${fmt(r.expiry)}` : " · no expiry"}
              </span>
              {r.cert && (
                <button onClick={() => setCertView(r.cert!)} className="btn-secondary text-[11px] py-1 px-2.5">
                  View
                </button>
              )}
              {r.fileUrl && (
                <button
                  onClick={() =>
                    setPreview({
                      url: r.fileUrl!,
                      name: r.external?.fileName ?? "certificate.pdf",
                      title: l.course.title,
                    })
                  }
                  className="btn-secondary text-[11px] py-1 px-2.5"
                >
                  Open
                </button>
              )}
            </div>
          ))}
      </li>
    );
  }

  const shown =
    filter === "att"
      ? attention
      : filter === "next"
      ? upcoming
      : [...expired, ...missing, ...soon, ...planned, ...valid.filter((l) => !isSoon(l))];

  const listCount = filter === "cert" ? recordGroups.length : shown.length;
  const nextUp = upcoming[0] ?? null;

  const widgets: { k: Filter; dot: string; label: string; big: ReactNode; small: string }[] = [
    {
      k: "all",
      dot: "bg-emerald-500",
      label: "Up to date",
      big: (
        <>
          {valid.length}
          <span className="text-[17px] text-slate-400 font-semibold">/{lines.length}</span>
        </>
      ),
      small: lines.length ? "trainings" : "no training linked",
    },
    {
      k: "att",
      dot: attention.length ? "bg-red-500" : "bg-emerald-500",
      label: "Attention",
      big: <span className={attention.length ? "text-red-600" : "text-emerald-600"}>{attention.length}</span>,
      small:
        [
          missing.length ? `${missing.length} missing` : "",
          expired.length ? `${expired.length} expired` : "",
          soon.length ? `${soon.length} due soon` : "",
        ]
          .filter(Boolean)
          .join(" · ") || "All clear",
    },
    {
      k: "next",
      dot: "bg-amber-500",
      label: "Next expiry",
      big: nextUp ? (
        <span className={nextUp.days! <= SOON_DAYS ? "text-amber-600" : ""}>
          {nextUp.days === 0 ? "Today" : `${nextUp.days} day${nextUp.days === 1 ? "" : "s"}`}
        </span>
      ) : (
        <span className="text-slate-300">—</span>
      ),
      small: nextUp ? `${nextUp.course.title} · ${fmt(nextUp.expires)}` : "Nothing expires",
    },
    {
      k: "cert",
      dot: "bg-sky-500",
      label: "Certificates",
      big: certs.length,
      small: externals.length
        ? `+${externals.length} external record${externals.length === 1 ? "" : "s"}`
        : "issued by BonAir",
    },
  ];

  return (
    <div>
      {/* ── EKRAN ─────────────────────────────────────────────── */}
      <div className="print:hidden">
        {/* Kendi kaydına menüden gelinir; "‹ Training Follow-Up" oraya
            erişimi olmayan personele anlamsız (ve kuralca kapalı) bir yer. */}
        {!self && (
          <Link to="/follow-up" className="text-[13px] font-medium text-brand-700 hover:underline">
            ‹ Training Follow-Up
          </Link>
        )}

        <div className="flex flex-wrap items-start justify-between gap-4 mt-3">
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className="h-[52px] w-[52px] shrink-0 rounded-full grid place-items-center text-white text-[19px] font-semibold"
              style={{ background: "linear-gradient(160deg,#c9393d,#8b1013)" }}
              aria-hidden
            >
              {initials}
            </div>
            <div className="min-w-0">
              <h1 className="text-[22px] font-bold tracking-[-0.02em] text-slate-900 leading-tight">{user.name}</h1>
              <div className="text-[13px] text-slate-500 mt-0.5 break-all">
                {[departments.get(user.departmentId ?? "") ?? "No department", ROLE_LABEL[user.role] ?? user.role, user.email]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {(titleNames.length > 0 || user.isActive === false) && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {user.isActive === false && (
                    <span className="rounded-full bg-slate-800 text-white px-2.5 py-0.5 text-[11.5px] font-semibold">
                      Inactive
                    </span>
                  )}
                  {titleNames.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11.5px] font-semibold text-slate-600"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canAssign && (
              <button onClick={() => setDialog({ kind: "assign" })} className="btn-primary rounded-xl">
                Assign training
              </button>
            )}
            {/* Kişiyle ilgili bütün işlemler tek menüde. Kendi kaydında
                yönetim eylemi yok; yalnız yetkisi varsa PDF düğmesi kalır. */}
            {self ? (
              canPrint && (
                <button onClick={() => printReport()} className="btn-secondary rounded-xl">
                  PDF report
                </button>
              )
            ) : (
            <RowMenu
              variant="round"
              label={`Manage ${user.name}`}
              items={[
                ...(canManageAccount
                  ? [
                      { label: "Edit details", icon: "✎", onClick: () => setDialog({ kind: "editUser" }) },
                      { label: "Reset password", icon: "🔑", onClick: () => setDialog({ kind: "password" }) },
                    ]
                  : []),
                ...(canEdit
                  ? [{ label: "Add external certificate", icon: "＋", onClick: () => setDialog({ kind: "add", course: null }) }]
                  : []),
                { label: "PDF report", icon: "⎙", onClick: () => printReport() },
                ...(canManageAccount
                  ? [
                      {
                        label: user.isActive === false ? "Activate" : "Deactivate",
                        icon: user.isActive === false ? "✓" : "⦸",
                        onClick: () => void setActive(user.isActive === false),
                      },
                      { label: "Delete user", icon: "🗑", danger: true, onClick: () => setDialog({ kind: "deleteUser" }) },
                    ]
                  : []),
              ]}
            />
            )}
          </div>
        </div>

        {/* Widget'lar — basınca alttaki liste süzülür. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          {widgets.map((w) => (
            <button
              key={w.k}
              onClick={() => setFilter(w.k)}
              aria-pressed={filter === w.k}
              className={`text-left bg-white rounded-2xl p-3.5 min-h-[112px] flex flex-col border-2 transition ${
                filter === w.k ? "border-sky-500" : "border-transparent shadow-card hover:border-slate-200"
              }`}
            >
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                <span className={`h-2 w-2 rounded-full ${w.dot}`} />
                {w.label}
              </span>
              <span className="mt-auto text-[28px] font-bold tracking-[-0.02em] text-slate-900 tabular-nums leading-tight">
                {w.big}
              </span>
              <span className="text-[12px] text-slate-500 truncate">{w.small}</span>
            </button>
          ))}
        </div>

        <div className="flex items-baseline justify-between mt-6 mb-2 px-1">
          <span className="text-[12.5px] font-semibold uppercase tracking-[0.03em] text-slate-500">
            {FILTER_TITLE[filter]} ({listCount})
          </span>
          {filter === "cert" && canEdit && (
            <button
              onClick={() => setDialog({ kind: "add", course: null })}
              className="text-[13px] font-medium text-brand-700 hover:underline"
            >
              + Add external record
            </button>
          )}
        </div>

        <div className={filter === "cert" ? "" : "bg-white rounded-2xl shadow-card overflow-hidden"}>
          {filter !== "cert" ? (
            shown.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-slate-400">
                {filter === "att"
                  ? "Nothing needs attention."
                  : filter === "next"
                  ? "No training with an expiry date."
                  : "No training linked to this person yet — assign a course or give them an authorisation scope with required training."}
              </p>
            ) : (
              <>
                <ul className="divide-y divide-slate-100">{shown.map(renderLine)}</ul>
                {/* Hiçbir eğitime bağlanmamış eski belgeler. Uygunluk
                    hesabına girmiyorlar ("closes no gap") ama kişinin
                    geçmişinin parçası; başka hiçbir yerde görünmüyorlardı. */}
                {filter === "all" && unlinkedGroups.length > 0 && (
                  <div className="border-t-[6px] border-slate-100">
                    <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
                      Other records · not linked to a training
                    </div>
                    <div className="px-3 pb-3">
                      <RecordHistory
                        groups={unlinkedGroups}
                        onView={setCertView}
                        onPreview={setPreview}
                        onEdit={
                          canEdit
                            ? (r) => setDialog({ kind: "edit", row: r as unknown as ExternalRow })
                            : undefined
                        }
                      />
                    </div>
                  </div>
                )}
              </>
            )
          ) : (
            /* Eğitim başına tek grup: geçerli kayıt üstte, geçmişi altında.
               Eskiden sertifikalar ve dış kayıtlar iki ayrı düz listeydi ve
               aynı eğitimin iki kaydından HANGİSİNİN geçerli olduğu
               görünmüyordu. Bileşen components/RecordHistory.tsx'te; kişinin
               kendi ekranı ve müşteri ekranı da aynısını kullanıyor. */
            <div className="p-3">
              <RecordHistory
                groups={recordGroups}
                onView={setCertView}
                onPreview={setPreview}
                onEdit={canEdit ? (r) => setDialog({ kind: "edit", row: r as unknown as ExternalRow }) : undefined}
                empty="No certificates or external records yet."
              />
            </div>
          )}
        </div>
        {err && <p className="mt-3 text-xs text-red-700">{err}</p>}
        {certView && <CertModal cert={certView} onClose={() => setCertView(null)} />}
      </div>

      {/* ── PDF RAPORU ────────────────────────────────────────────
          Ekranda görünmez. Rapor bir uygunluk belgesi: kimlik, özet sayılar
          ve bütün tablolar (eğitim, dış kayıtlar, sertifikalar, atamalar)
          eksiksiz basılır — ekranda neyin süzülü olduğundan bağımsız. */}
      {/* Basma yetkisi yoksa bölüm hiç çizilmez: yalnız düğmeyi gizlemek
          Ctrl+P'yi engellemiyordu, antetli kurum belgesi yine çıkıyordu. */}
      <div className={canPrint ? "hidden print:block" : "hidden"}>
  <Link to="/follow-up" className="text-xs text-slate-500 hover:text-slate-800 no-print">
          ← Training Follow-Up
        </Link>
        <PageHead
          title={user.name}
        />
        <div className="mb-4" />

        {/* Kimlik + özet. Bu kart her sekmede kalır: kişinin kim olduğu
            sekme değiştirince kaybolmamalı. */}
        <div className="card p-4 mb-3">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[13px] text-slate-500">{user.email}</div>
              <div className="text-[12px] text-slate-600 mt-1 flex flex-wrap items-center gap-1.5">
                <span>{departments.get(user.departmentId ?? "") ?? "No department"}</span>
                <span className="text-slate-300">·</span>
                <span>{ROLE_LABEL[user.role] ?? user.role}</span>
                {user.isActive === false && (
                  <span className="bg-slate-200 text-slate-700 rounded px-1.5 py-0.5 text-[10.5px] font-bold uppercase">
                    Inactive
                  </span>
                )}
                {titleNames.map((t) => (
                  <span
                    key={t}
                    className="bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[11px] font-medium"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 no-print">
              <PrintButton label="PDF Report" />
              {canEdit && (
                <button
                  onClick={() => setDialog({ kind: "add", course: null })}
                  className="btn-secondary text-xs py-2"
                >
                  + External Certificate
                </button>
              )}
              {/* Kişi yönetimi artık burada: eskiden Users sayfasının satır
                  menüsündeydi, yani bir kişiyi düzenlemek için tam kaydından
                  çıkıp başka sayfaya gitmek gerekiyordu. */}
              {canEdit && (
                <RowMenu
                  label={`Manage ${user.name}`}
                  items={[
                    { label: "Edit details", icon: "✎", onClick: () => setDialog({ kind: "editUser" }) },
                    { label: "Reset password", icon: "🔑", onClick: () => setDialog({ kind: "password" }) },
                    ...(canAssign
                      ? [
                          {
                            label: "Assign training",
                            icon: "▤",
                            onClick: () => setDialog({ kind: "assign" }),
                          },
                        ]
                      : []),
                    {
                      label: user.isActive === false ? "Activate" : "Deactivate",
                      icon: user.isActive === false ? "✓" : "⦸",
                      onClick: () => void setActive(user.isActive === false),
                    },
                    ...(role === "ADMIN"
                      ? [
                          {
                            label: "Delete user",
                            icon: "🗑",
                            danger: true,
                            onClick: () => setDialog({ kind: "deleteUser" }),
                          },
                        ]
                      : []),
                  ]}
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
            <Stat label="Completed" value={done.length - expired.length} cls="bg-emerald-50 text-emerald-800" />
            <Stat label="Planned" value={planned.length} cls="bg-sky-50 text-sky-800" />
            <Stat label="Missing" value={missing.length} cls="bg-slate-100 text-slate-700" />
            <Stat label="Expired" value={expired.length} cls="bg-red-50 text-red-800" />
          </div>
        </div>

        {/* Eğitim durumu */}
        <div className={`card`}>
          <div
            className="px-5 py-3 relative"
            style={{ background: "linear-gradient(180deg,#8b1013 0%,#6d0d11 100%)" }}
          >
            <div className="text-[13px] font-bold text-white">
              Training <span className="text-white/60 font-normal">({lines.length})</span>
            </div>
            <span
              className="absolute bottom-0 left-0 right-0 h-0.5"
              style={{ background: "linear-gradient(90deg,#e31e24,#e8630a 60%,transparent)" }}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  <th className="th w-10">#</th>
                  <th className="th">Training</th>
                  <th className="th">Required</th>
                  <th className="th">Status</th>
                  <th className="th">Completed</th>
                  <th className="th">Valid Until</th>
                  <th className="th">Source</th>
                  <th className="th w-12 text-right no-print">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-400">
                      No training linked to this person yet — assign a course or give them an authorisation scope
                      with required training.
                    </td>
                  </tr>
                )}
                {[...missing, ...planned, ...done].map((l, i) => {
                  const isExpired = l.days !== null && l.days < 0;
                  return (
                    <tr key={l.course.id} className="hover:bg-slate-50/70">
                      <td className="td text-slate-400 tabular-nums">{i + 1}</td>
                      <td className="td font-semibold text-slate-900">{l.course.title}</td>
                      <td className="td">
                        {l.required ? (
                          <span className="text-[11px] font-semibold text-slate-600">Yes</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="td">
                        <StateBadge state={l.state} expired={isExpired} />
                      </td>
                      <td className="td tabular-nums text-slate-500">{fmt(l.date)}</td>
                      <td className="td tabular-nums">
                        {l.expires ? (
                          <span className={isExpired ? "text-red-700 font-semibold" : "text-slate-600"}>
                            {fmt(l.expires)}
                            <span className="block text-[10px] text-slate-400">
                              {l.days! < 0 ? `${-l.days!}d overdue` : `${l.days}d left`}
                            </span>
                          </span>
                        ) : l.state === "DONE" ? (
                          <span className="text-slate-400 text-[11px]">no expiry</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="td">
                        {l.external ? (
                          // Belgesi olmayan (kâğıt) kayıtta link yerine düz metin.
                          l.external.fileUrl ? (
                            <button
                              onClick={() =>
                                setPreview({
                                  url: l.external!.fileUrl!,
                                  name: l.external!.fileName ?? "certificate.pdf",
                                  title: l.external!.title,
                                })
                              }
                              className="text-sky-700 hover:underline text-[12px]"
                              title={`Provider: ${l.external.provider}`}
                            >
                              External · {l.external.provider}
                            </button>
                          ) : (
                            <span
                              className="text-slate-500 text-[12px]"
                              title={`Provider: ${l.external.provider}`}
                            >
                              External · {l.external.provider}
                            </span>
                          )
                        ) : l.state === "DONE" && l.certificateId ? (
                          <a
                            href={certHref(l.certificateId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-700 hover:underline text-[12px] font-medium"
                          >
                            BonAir · view certificate
                          </a>
                        ) : l.state === "DONE" ? (
                          <span className="text-[12px] text-slate-500">BonAir</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="td text-right no-print">
                        {canEdit && (
                          <RowMenu
                            label={`Actions for ${l.course.title}`}
                            /* Ekrandakiyle AYNI liste. Eskiden buraya birebir
                               kopyalanmisti; biri guncellenince digeri geride
                               kaliyordu. */
                            items={lineMenu(l)}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {err && <p className="px-5 py-3 text-xs text-red-700 border-t border-slate-100">{err}</p>}
        </div>

        {/* TÜM dış kayıtlar. Eğitim tablosu kurs başına yalnızca kazanan kaydı
            gösteriyor; aynı kursa girilmiş ikinci bir kayıt hiçbir yerde
            görünmüyor, dolayısıyla silinemiyordu. Burası tam liste. */}
        <div className={`card mt-4`}>
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
            <span className="text-[13px] font-bold text-slate-800">
              External Certificates{" "}
              <span className="text-slate-400 font-normal">({externals.length})</span>
            </span>
            {canEdit && (
              <button
                onClick={() => setDialog({ kind: "add", course: null })}
                className="btn-secondary text-xs py-1.5 no-print"
              >
                + Add
              </button>
            )}
          </div>

          {externals.length === 0 ? (
            <p className="px-5 py-6 text-center text-[13px] text-slate-400">
              No external certificates recorded for {user.name}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="th">Training</th>
                    <th className="th">Counts As</th>
                    <th className="th">Provider</th>
                    <th className="th">Completed</th>
                    <th className="th">Valid Until</th>
                    <th className="th">Document</th>
                    {canEdit && <th className="th w-12 text-right no-print">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...externals]
                    .sort(
                      (a, b) =>
                        (b.completedAt?.toMillis?.() ?? 0) - (a.completedAt?.toMillis?.() ?? 0)
                    )
                    .map((e) => {
                      const exp = e.expiresAt?.toDate?.() ?? null;
                      const expired = !!exp && exp.getTime() < Date.now();
                      const linked = courses.find((c) => c.id === e.courseId);
                      return (
                        <tr key={e.id} className="hover:bg-slate-50/70">
                          <td className="td font-semibold text-slate-900">
                            {e.title}
                            {e.method && (
                              <span className="ml-1.5 bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[10.5px] font-medium">
                                {e.method}
                              </span>
                            )}
                          </td>
                          <td className="td">
                            {linked ? (
                              <span className="text-slate-700">{linked.title}</span>
                            ) : (
                              <span className="text-amber-700 text-[11px] font-medium">
                                Not linked — closes no gap
                              </span>
                            )}
                          </td>
                          <td className="td text-slate-600">{e.provider}</td>
                          <td className="td tabular-nums text-slate-500">
                            {fmt(e.completedAt?.toDate?.())}
                          </td>
                          <td className="td tabular-nums">
                            <span className={expired ? "text-red-700 font-semibold" : "text-slate-700"}>
                              {exp ? fmt(exp) : "—"}
                            </span>
                            {expired && (
                              <span className="ml-2 text-[10px] font-semibold text-red-700">
                                EXPIRED
                              </span>
                            )}
                          </td>
                          {/* Kâğıttan aktarılan kayıtların dijital kopyası yok;
                              koşulsuz "Open" linki ölü bağlantı basıyordu. */}
                          <td className="td">
                            {e.fileUrl ? (
                              <button
                                onClick={() =>
                                  setPreview({
                                    url: e.fileUrl!,
                                    name: e.fileName ?? "certificate.pdf",
                                    title: e.title,
                                  })
                                }
                                className="text-[12px] text-brand-700 hover:underline"
                              >
                                Open
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400">On paper</span>
                            )}
                          </td>
                          {canEdit && (
                            <td className="td text-right no-print">
                              <RowMenu
                                label={`Actions for ${e.title}`}
                                items={[
                                  {
                                    label: "Edit",
                                    icon: "✎",
                                    onClick: () => setDialog({ kind: "edit", row: e }),
                                  },
                                  {
                                    label: "Delete",
                                    icon: "🗑",
                                    danger: true,
                                    onClick: () => setDialog({ kind: "remove", row: e }),
                                  },
                                ]}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sertifikalar — bu kişiye sistemden verilen BonAir sertifikaları.
            Eskiden yalnızca kişinin kendi "My Certificates" sayfasında
            görünüyordu; müdür bir personelin sertifikasını göremiyordu. */}
        <div className={`card mt-4`}>
          <div className="px-5 py-3 border-b border-slate-100">
            <span className="text-[13px] font-bold text-slate-800">
              BonAir Certificates{" "}
              <span className="text-slate-400 font-normal">({certs.length})</span>
            </span>
          </div>
          {certs.length === 0 ? (
            <p className="px-5 py-6 text-center text-[13px] text-slate-400">
              No certificate issued by BonAir yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="th">No</th>
                    <th className="th">Training</th>
                    <th className="th">Issued</th>
                    <th className="th">Instructor</th>
                    <th className="th">Held</th>
                    <th className="th w-20 text-right no-print"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...certs]
                    .sort((a, b) => (b.issuedAt?.toMillis?.() ?? 0) - (a.issuedAt?.toMillis?.() ?? 0))
                    .map((c) => (
                      <tr key={c.__id} className="hover:bg-slate-50/70">
                        <td className="td font-semibold text-slate-900 tabular-nums">
                          {c.serialNo ?? "—"}
                        </td>
                        <td className="td text-slate-800">{c.courseTitle ?? "—"}</td>
                        <td className="td tabular-nums text-slate-500">
                          {fmt(c.issuedAt?.toDate?.())}
                        </td>
                        <td className="td text-slate-600">{c.instructorName || "—"}</td>
                        <td className="td text-slate-600">
                          {c.deliveryMode === "CLASSROOM" ? "Classroom" : c.heldIn || "—"}
                        </td>
                        <td className="td text-right no-print">
                          <Link
                            to={`/certificate/${c.__id}`}
                            className="text-[12px] font-medium text-brand-700 hover:underline"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Atamalar — bu listeyi hiçbir ekran göstermiyordu. Sayfa veriyi
            zaten çekiyordu ama sadece "Planned" durumu olarak kullanıyordu;
            son teslim tarihi, gecikme ve kimin attığı hiç görünmüyordu. */}
        <div className={`card mt-4`}>
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
            <span className="text-[13px] font-bold text-slate-800">
              Assignments{" "}
              <span className="text-slate-400 font-normal">({assignments.length})</span>
            </span>
            {canAssign && (
              <button
                onClick={() => setDialog({ kind: "assign" })}
                className="btn-secondary text-xs py-1.5 no-print"
              >
                + Assign
              </button>
            )}
          </div>
          {assignments.length === 0 ? (
            <p className="px-5 py-6 text-center text-[13px] text-slate-400">
              Nothing assigned to {user.name} yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="th">Training</th>
                    <th className="th">Status</th>
                    <th className="th">Due</th>
                    <th className="th">Completed</th>
                    <th className="th">Assigned by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...assignments]
                    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
                    .map((a) => {
                      const finished = a.status === "COMPLETED" || a.status === "EXAM_PASSED";
                      const dueMs = a.dueDate?.toMillis?.() ?? null;
                      const overdue = !finished && dueMs !== null && dueMs < Date.now();
                      return (
                        <tr key={`${a.courseId}_${a.cycleNumber ?? 1}`} className="hover:bg-slate-50/70">
                          <td className="td font-semibold text-slate-900">
                            {a.courseTitle || "—"}
                            {/* Eğitimin hangi dilde alındığı kaydın parçası —
                                denetimde sorulabilen bir şey. */}
                            {a.contentLanguage && (
                              <span className="ml-1.5 bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[10px] font-bold">
                                {a.contentLanguage}
                              </span>
                            )}
                          </td>
                          <td className="td">
                            <span
                              className={`text-[9.5px] font-bold uppercase tracking-[0.04em] px-2 py-1 rounded ${
                                finished
                                  ? "bg-emerald-50 text-emerald-700"
                                  : overdue
                                  ? "bg-red-50 text-red-700"
                                  : "bg-sky-50 text-sky-800"
                              }`}
                            >
                              {finished ? "Completed" : overdue ? "Overdue" : String(a.status ?? "—")}
                            </span>
                          </td>
                          <td className="td tabular-nums">
                            <span className={overdue ? "text-red-700 font-semibold" : "text-slate-600"}>
                              {fmt(a.dueDate?.toDate?.())}
                            </span>
                            {overdue && dueMs !== null && (
                              <span className="block text-[10px] text-slate-400">
                                {Math.round((Date.now() - dueMs) / DAY)}d overdue
                              </span>
                            )}
                          </td>
                          <td className="td tabular-nums text-slate-500">
                            {fmt(a.completedAt?.toDate?.())}
                          </td>
                          <td className="td text-slate-500 text-[12px]">
                            {a.triggeredBy === "MANAGER_REQUESTED" ? "Manager" : a.triggeredBy || "—"}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {preview && (
        <FilePreview
          url={preview.url}
          fileName={preview.name}
          title={preview.title}
          onClose={() => setPreview(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-[13px] rounded-lg px-4 py-2.5 shadow-xl">
          {toast}
        </div>
      )}

      {dialog?.kind === "add" && (
        <Modal
          title="External Certificate"
          subtitle={`${user.name}${dialog.course ? ` · ${dialog.course.title}` : ""}`}
          onClose={() => setDialog(null)}
        >
          <ExternalCertForm
            user={{ id: user.id, name: user.name, departmentId: user.departmentId }}
            course={dialog.course}
            courses={courses}
            onDone={(m) => {
              setToast(m);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "edit" && (
        <Modal
          title="Edit External Certificate"
          subtitle={`${user.name} · ${dialog.row.title}`}
          onClose={() => setDialog(null)}
        >
          <ExternalCertForm
            user={{ id: user.id, name: user.name, departmentId: user.departmentId }}
            course={null}
            courses={courses}
            existing={dialog.row as any}
            onDone={(m) => {
              setToast(m);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "remove" && (
        <Modal title="Delete Record" subtitle={dialog.row.title} onClose={() => setDialog(null)} width="max-w-md">
          <p className="text-sm text-slate-700 mb-2">
            Delete this external training record? The person will be shown as missing this training
            again.
          </p>
          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
            <button
              onClick={async () => {
                await deleteDoc(doc(db, "externalTrainings", dialog.row.id));
                setToast("Record deleted.");
                setDialog(null);
              }}
              className="btn-primary text-xs py-2"
            >
              Delete Record
            </button>
            <button onClick={() => setDialog(null)} className="btn-secondary text-xs py-2">
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* Kişi yönetimi diyalogları — Users sayfasıyla aynı bileşenler. */}
      {dialog?.kind === "editUser" && (
        <Modal title="Edit User" subtitle={user.email} onClose={() => setDialog(null)}>
          <UserForm
            existing={user}
            departments={departmentList}
            jobTitles={jobTitles}
            methodCourses={methodCourses}
            onDone={(m) => {
              setToast(m);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "password" && (
        <Modal
          title="Reset Password"
          subtitle={user.name}
          onClose={() => setDialog(null)}
          width="max-w-md"
        >
          <PasswordReset
            user={user}
            onDone={(m) => {
              setToast(m);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "assign" && (
        <Modal title="Assign Training" subtitle={user.name} onClose={() => setDialog(null)}>
          <AssignPanel
            userId={user.id}
            courses={assignableCourses}
            preselect={dialog.preselect}
            onDone={(m) => {
              setToast(m);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "deleteUser" && (
        <Modal
          title="Delete User"
          subtitle={user.email}
          onClose={() => setDialog(null)}
          width="max-w-md"
        >
          <DeleteConfirm
            user={user}
            onDone={() => {
              // Kişi silindi; bu sayfanın konusu artık yok.
              setDialog(null);
              navigate("/users");
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "force" && (
        <Modal
          title="Mark as Completed"
          subtitle={`${user.name} · ${dialog.line.course.title}`}
          onClose={() => setDialog(null)}
          width="max-w-lg"
        >
          <ForceCompleteForm
            userId={user.id}
            courseId={dialog.line.course.id}
            onDone={(m) => {
              setToast(m);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}
    </div>
  );
}

/**
 * İçerik açılmadığı için kilitli kalan atamayı admin elle kapatır.
 * Gerekçe zorunlu — belge bir uygunluk kaydı, kimin neden kapattığı yazmalı.
 * Sınavı olan ve geçilmemiş kursu Function reddeder.
 */
function ForceCompleteForm({
  userId,
  courseId,
  onDone,
  onCancel,
}: {
  userId: string;
  courseId: string;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 5) return;
    setBusy(true);
    setErr(null);
    try {
      await httpsCallable(functions, "forceCompleteAssignment")({
        assignmentId: `${userId}_${courseId}`,
        reason: reason.trim(),
      });
      onDone("Marked as completed. Certificate issued.");
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="text-[12px] text-slate-600 mb-3">
        Use this only when the person completed the training but the system could not record it —
        for example the content would not load. A certificate is issued and the reason below is
        stored on both the assignment and the certificate.
      </p>
      <label className="label">Reason *</label>
      <textarea
        className="input"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Content file failed to load on 26.08.2026; training delivered in the classroom and attendance verified."
        autoFocus
      />
      <p className="text-[10px] text-slate-500 mt-1">
        If the course has an exam that has not been passed, this will be refused — exam results
        cannot be entered by hand.
      </p>
      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button
          type="submit"
          disabled={busy || reason.trim().length < 5}
          className="btn-primary text-xs py-2"
        >
          {busy ? "Saving…" : "Mark Completed"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-red-700">{err}</span>}
      </div>
    </form>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={`rounded-lg px-3 py-2.5 ${cls}`}>
      <div className="text-xl font-bold leading-none tabular-nums">{value}</div>
      <div className="text-[11px] font-semibold mt-0.5">{label}</div>
    </div>
  );
}

function StateBadge({ state, expired }: { state: Line["state"]; expired: boolean }) {
  if (state === "DONE")
    return expired ? (
      <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold ring-1 bg-red-50 text-red-700 ring-red-200">
        Expired
      </span>
    ) : (
      <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold ring-1 bg-emerald-50 text-emerald-700 ring-emerald-200">
        Completed
      </span>
    );
  if (state === "PLANNED")
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold ring-1 bg-sky-50 text-sky-700 ring-sky-200">
        Planned
      </span>
    );
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold ring-1 bg-slate-100 text-slate-600 ring-slate-200">
      Missing
    </span>
  );
}
