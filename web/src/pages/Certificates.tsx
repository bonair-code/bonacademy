import { PageHead } from "../components/PageHead";
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/auth";
import { CertificateSheet, type Cert } from "../components/CertificateSheet";
import { printCertificate } from "../lib/print";
import { Modal } from "../components/Modal";
import { ExternalCertForm, type ExternalRecord } from "../components/ExternalCertForm";
import { FilePreview } from "../components/FilePreview";
import { addValidity, DAY, fmt } from "../lib/records";

/**
 * Kişinin eğitim kayıtları — **eğitim başına** bir satır, kayıt başına değil.
 *
 * Eskiden sayfa iki ayrı tabloydu: BonAcademy sertifikaları ve dış kayıtlar.
 * Aynı eğitimin hem sistem sertifikası hem dış belgesi hem de kâğıttan
 * aktarılmış kaydı olabiliyor; iki tablo bunları ilişkilendirmediği için
 * hangisinin geçerli olduğu görünmüyordu. Artık her eğitim tek grup:
 * üstte geçerli olan kayıt ve kalan gün, altında aynı eğitimin geçmişi.
 */


type Course = { every: number | null; unit: string; title: string; methods: string[] };

type Source = "BONACADEMY" | "EXTERNAL" | "PAPER";

type Record_ = {
  id: string;
  source: Source;
  /** Kaynağın kendi etiketi: sağlayıcı adı ya da "BonAcademy". */
  label: string;
  date: Date | null;
  expiry: Date | null;
  serialNo: string | null;
  fileUrl: string | null;
  method: string | null;
  /** Sistem sertifikasıysa belge burada — modalda gösterilir. */
  cert: Cert | null;
  /** Dış kayıtsa düzenlenebilir hâli. */
  external: ExternalRecord | null;
};

type Group = {
  key: string;
  title: string;
  records: Record_[];
  /** En son TAMAMLANAN kayıt — geçerliliği bu belirler. */
  current: Record_;
};

const SOURCE_LABEL: Record<Source, string> = {
  BONACADEMY: "BonAcademy",
  EXTERNAL: "External",
  PAPER: "On paper",
};

export function Certificates() {
  const { profile, role } = useAuth();
  const [certs, setCerts] = useState<any[]>([]);
  const [externals, setExternals] = useState<any[]>([]);
  const [courses, setCourses] = useState<Map<string, Course>>(new Map());
  const [view, setView] = useState<Cert | null>(null);
  const [edit, setEdit] = useState<ExternalRecord | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string; title: string } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  /**
   * Dış kaydı Firestore kuralları yalnızca ADMIN'e ve kaydın departmanının
   * müdürüne açıyor. İçe aktarılan kayıtlarda `userDepartmentId` boş olduğu
   * için müdür kendi kaydını bile değiştiremez — düğmeyi ona göstermek
   * tıklandığında yetki hatası verirdi.
   */
  const canEdit = role === "ADMIN";

  useEffect(() => {
    if (!profile) return;
    const u1 = onSnapshot(
      query(collection(db, "certificates"), where("userId", "==", profile.uid)),
      (s) => setCerts(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
    );
    const u2 = onSnapshot(
      query(collection(db, "externalTrainings"), where("userId", "==", profile.uid)),
      (s) => setExternals(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      () => {}
    );
    const u3 = onSnapshot(collection(db, "courses"), (s) =>
      setCourses(
        new Map(
          s.docs.map((d) => {
            const x = d.data() as any;
            return [
              d.id,
              {
                every: x.recurrenceEvery ?? null,
                unit: x.recurrenceUnit ?? "NONE",
                title: x.title ?? "",
                methods: (x.methods ?? []) as string[],
              },
            ];
          })
        )
      )
    );
    return () => {
      u1();
      u2();
      u3();
    };
  }, [profile]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const courseList = useMemo(
    () =>
      [...courses.entries()].map(([id, c]) => ({
        id,
        title: c.title,
        recurrenceEvery: c.every,
        recurrenceUnit: c.unit,
        methods: c.methods,
      })),
    [courses]
  );

  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, { title: string; records: Record_[] }>();
    const push = (key: string, title: string, r: Record_) => {
      const g = byKey.get(key) ?? { title, records: [] };
      g.records.push(r);
      if (!byKey.has(key)) byKey.set(key, g);
    };

    for (const c of certs) {
      const date = (c.issuedAt as Timestamp)?.toDate?.() ?? null;
      const course = courses.get(c.courseId);
      push(c.courseId || `t:${c.courseTitle}`, course?.title || c.courseTitle || "", {
        id: c.id,
        source: "BONACADEMY",
        label: "BonAcademy",
        date,
        expiry: date ? addValidity(date, course?.every ?? null, course?.unit ?? "NONE") : null,
        serialNo: c.serialNo ?? null,
        fileUrl: null,
        method: null,
        cert: c as Cert,
        external: null,
      });
    }

    for (const e of externals) {
      const date = (e.completedAt as Timestamp)?.toDate?.() ?? null;
      const course = e.courseId ? courses.get(e.courseId) : undefined;
      const paper = !e.fileUrl;
      push(e.courseId || `t:${e.title}`, course?.title || e.title || "", {
        id: e.id,
        source: paper ? "PAPER" : "EXTERNAL",
        label: paper ? "On paper" : e.provider || "External",
        date,
        expiry: (e.expiresAt as Timestamp)?.toDate?.() ?? null,
        serialNo: e.externalSerialNo ?? null,
        fileUrl: e.fileUrl ?? null,
        method: e.method ?? null,
        cert: null,
        external: e as ExternalRecord,
      });
    }

    return [...byKey.entries()]
      .map(([key, g]) => {
        // Kazanan en son TAMAMLANAN kayıt; sıralama tarihe göre.
        const records = [...g.records].sort(
          (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)
        );
        return { key, title: g.title, records, current: records[0] };
      })
      .sort((a, b) => {
        // Önce süresi dolan/dolmak üzere olan; sonra tarihe göre.
        const ea = a.current.expiry?.getTime() ?? Infinity;
        const eb = b.current.expiry?.getTime() ?? Infinity;
        return ea - eb;
      });
  }, [certs, externals, courses]);

  const counts = useMemo(() => {
    let valid = 0;
    let soon = 0;
    let expired = 0;
    for (const g of groups) {
      const e = g.current.expiry;
      if (!e) {
        valid++;
        continue;
      }
      const days = Math.round((e.getTime() - Date.now()) / DAY);
      if (days < 0) expired++;
      else if (days <= 90) soon++;
      else valid++;
    }
    return { valid, soon, expired };
  }, [groups]);

  return (
    <div>
      <PageHead
        title="My Certificates"
        subtitle="One row per training — the record that counts, and everything behind it."
      />

      {groups.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Tally n={counts.valid} label="In date" tone="#1f7a3c" />
          <Tally n={counts.soon} label="Due in 90 days" tone="#8a5c08" />
          <Tally n={counts.expired} label="Expired" tone="#b3241f" />
        </div>
      )}

      {groups.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-400">
          You have no training records yet.
        </div>
      ) : (
        <div className="space-y-2.5">
          {groups.map((g) => (
            <TrainingGroup
              key={g.key}
              g={g}
              expanded={!!open[g.key]}
              onToggle={() => setOpen((p) => ({ ...p, [g.key]: !p[g.key] }))}
              onView={setView}
              onPreview={setPreview}
              onEdit={canEdit ? setEdit : undefined}
            />
          ))}
        </div>
      )}

      {view && <CertModal cert={view} onClose={() => setView(null)} />}

      {preview && (
        <FilePreview
          url={preview.url}
          fileName={preview.name}
          title={preview.title}
          onClose={() => setPreview(null)}
        />
      )}

      {edit && profile && (
        <Modal
          title="Edit Training Record"
          subtitle={edit.title}
          onClose={() => setEdit(null)}
        >
          <ExternalCertForm
            user={{
              id: profile.uid,
              name: profile.name,
              departmentId: profile.departmentId,
            }}
            course={null}
            courses={courseList}
            existing={edit}
            onDone={(m) => {
              setToast(m);
              setEdit(null);
            }}
            onCancel={() => setEdit(null)}
          />
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-[13px] rounded-lg px-4 py-2.5 shadow-xl no-print">
          {toast}
        </div>
      )}
    </div>
  );
}

function Tally({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="card px-4 py-3">
      <div
        className="text-[22px] font-bold tabular-nums leading-none tracking-[-0.025em]"
        style={{ color: tone }}
      >
        {n}
      </div>
      <div className="text-[11.5px] text-slate-500 mt-1">{label}</div>
    </div>
  );
}

/** Bir eğitim: geçerli kayıt üstte, geçmişi altında. */
function TrainingGroup({
  g,
  expanded,
  onToggle,
  onView,
  onPreview,
  onEdit,
}: {
  g: Group;
  expanded: boolean;
  onToggle: () => void;
  onView: (c: Cert) => void;
  onPreview: (p: { url: string; name: string; title: string }) => void;
  onEdit?: (r: ExternalRecord) => void;
}) {
  const cur = g.current;
  const days = cur.expiry ? Math.round((cur.expiry.getTime() - Date.now()) / DAY) : null;
  const state =
    days === null
      ? { chip: "No expiry", cls: "bg-slate-100 text-slate-600", tone: "#8e8e93" }
      : days < 0
      ? { chip: "Expired", cls: "bg-red-50 text-red-700", tone: "#b3241f" }
      : days <= 90
      ? { chip: "Due soon", cls: "bg-amber-50 text-amber-800", tone: "#8a5c08" }
      : { chip: "In date", cls: "bg-emerald-50 text-emerald-700", tone: "#1f7a3c" };

  const older = g.records.slice(1);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className={`text-[9.5px] font-bold uppercase tracking-[0.04em] px-2 py-1 rounded shrink-0 ${state.cls}`}
        >
          {state.chip}
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-slate-900 truncate">
            {g.title}
            {cur.method && (
              <span className="ml-1.5 bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[10.5px] font-medium">
                {cur.method}
              </span>
            )}
          </div>
          <div className="text-[11.5px] text-slate-500 truncate">
            {cur.label}
            {cur.serialNo ? ` · ${cur.serialNo}` : ""} · {fmt(cur.date)}
            {cur.expiry ? ` → ${fmt(cur.expiry)}` : ""}
          </div>
        </div>

        <div className="shrink-0 text-right leading-none" style={{ color: state.tone }}>
          {days === null ? (
            <span className="text-[12px] font-bold">—</span>
          ) : (
            <>
              <span className="block text-[19px] font-bold tabular-nums tracking-[-0.02em]">
                {Math.abs(days)}
              </span>
              <span className="block text-[10px] font-medium mt-0.5 opacity-80">
                {days < 0 ? "days overdue" : "days left"}
              </span>
            </>
          )}
        </div>

        <RecordActions r={cur} onView={onView} onPreview={onPreview} title={g.title} onEdit={onEdit} />
      </div>

      {older.length > 0 && (
        <button
          onClick={onToggle}
          className="w-full text-left px-4 py-1.5 border-t border-slate-100 bg-slate-50/60 text-[11px] text-slate-500 hover:text-slate-800"
        >
          {expanded ? "Hide" : "Show"} {older.length} earlier record
          {older.length === 1 ? "" : "s"}
        </button>
      )}

      {expanded &&
        older.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-3 px-4 py-2 border-t border-slate-100 bg-slate-50/40"
          >
            <span className="text-[9.5px] font-bold uppercase tracking-[0.04em] px-2 py-1 rounded bg-slate-100 text-slate-500 shrink-0">
              {SOURCE_LABEL[r.source]}
            </span>
            <span className="min-w-0 flex-1 text-[11.5px] text-slate-600 truncate">
              {r.label}
              {r.serialNo ? ` · ${r.serialNo}` : ""} · {fmt(r.date)}
              {r.expiry ? ` → ${fmt(r.expiry)}` : " · no expiry"}
            </span>
            <RecordActions r={r} onView={onView} onPreview={onPreview} title={g.title} onEdit={onEdit} small />
          </div>
        ))}
    </div>
  );
}

function RecordActions({
  r,
  onView,
  onPreview,
  title,
  onEdit,
  small,
}: {
  r: Record_;
  onView: (c: Cert) => void;
  onPreview: (p: { url: string; name: string; title: string }) => void;
  title: string;
  onEdit?: (e: ExternalRecord) => void;
  small?: boolean;
}) {
  const cls = small ? "btn-secondary text-[11px] py-1 px-2.5" : "btn-secondary text-xs py-1.5 px-3";
  return (
    <div className="flex items-center gap-1.5 shrink-0 no-print">
      {r.cert && (
        <button onClick={() => onView(r.cert!)} className={cls}>
          View
        </button>
      )}
      {/* Belge uygulamanın içinde açılır; yazdırma ve indirme orada. */}
      {r.fileUrl && (
        <button
          onClick={() =>
            onPreview({
              url: r.fileUrl!,
              name: r.external?.fileName ?? "certificate.pdf",
              title,
            })
          }
          className={cls}
        >
          Open
        </button>
      )}
      {/* Kâğıt kayıtta açılacak dosya yok; düzenleyip belge eklemek yine mümkün. */}
      {onEdit && r.external && (
        <button onClick={() => onEdit(r.external!)} className={cls}>
          Edit
        </button>
      )}
    </div>
  );
}

function CertModal({ cert, onClose }: { cert: Cert; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-auto"
      onClick={onClose}
    >
      <div className="w-full max-w-5xl overflow-x-auto" onClick={(e) => e.stopPropagation()}>
        <div className="rounded-xl overflow-hidden shadow-2xl min-w-[640px] lg:min-w-0">
          <CertificateSheet cert={cert} />
        </div>
        <div className="flex justify-center gap-3 mt-4 no-print">
          <button onClick={printCertificate} className="btn-primary">
            Print / PDF (landscape)
          </button>
          <button onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
