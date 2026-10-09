import { useEffect, useState, type ReactNode } from "react";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import { PageHead } from "../components/PageHead";
import { Modal } from "../components/Modal";
import { RowMenu } from "../components/RowMenu";

/**
 * Ayarlar — "B, sade" tasarımı (CAPELLA/ayarlar-b-sade.html'de onaylandı).
 *
 * Solda üç bölüm, sağda içerik. Eskiden kart → bölüm → geri dön akışı vardı,
 * "Yeni" butonları beyaz zeminde beyaz yazıydı (görünmüyordu) ve yetki ekranı
 * iç içe kutulardan oluşuyordu. Şimdi:
 *   - Departman tek satırda eklenir (yaz, Enter); ada tıklayınca yeniden adlandırılır.
 *   - Yetki ekranı iki düz liste: zorunlu eğitimler ve alt yetkiler. Alt yetkiye
 *     tıklayınca kendi görünümü açılır.
 *   - Silinen her şey birkaç saniye "Undo" ile geri alınabilir — onay penceresi yok.
 *
 * "Certificate Settings" kaldırıldı: tek alanı (online eğitimin yeri) zaten
 * "Online" kayıtlı ve sertifikaya aynen basılmaya devam ediyor
 * (orgSettings/singleton.trainingLocation, sunucu okur).
 */

type Ref = { id: string; name: string };
/**
 * Alt yetki. Örnek: "Auditor" kapsamının altında Procedures / Product /
 * Quality / NDT. Kişiye kapsam verilir, altındaki alt yetkiler tik ile
 * seçilir; her alt yetkinin kendi gerekli eğitimi olur. NDT tikli değilse
 * NDT Familiarization o kişide zorunlu görünmez.
 */
type SubScope = {
  id: string;
  name: string;
  requiredCourseIds?: string[];
  /** Bu alt yetki taşındığında kapsamın gerekliliğinden DÜŞEN eğitimler. */
  excludedCourseIds?: string[];
};
/** Yetki (kapsam). Koleksiyon adı geçmişten: jobTitles. */
type JobTitle = Ref & { requiredCourseIds?: string[]; subScopes?: SubScope[] };
type RecurUnit = "NONE" | "DAY" | "MONTH" | "YEAR";
type Course = {
  id: string;
  title: string;
  delivery?: string;
  recurrenceEvery?: number | null;
  recurrenceUnit?: RecurUnit;
  /** Eğitim metodlara bölünüyorsa (ör. NDT: PT, MT, UT) bunların listesi. */
  methods?: string[];
};

type Toast = { msg: string; undo?: () => Promise<void> } | null;
type Say = (msg: string, undo?: () => Promise<void>) => void;
type Tab = "departments" | "scopes" | "tracked" | "email";

export function Settings() {
  const [tab, setTab] = useState<Tab>("departments");
  const [toast, setToast] = useState<Toast>(null);
  const [depts, setDepts] = useState<Ref[]>([]);
  const [scopes, setScopes] = useState<JobTitle[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);

  useEffect(() => {
    const subs = [
      onSnapshot(query(collection(db, "departments"), orderBy("name")), (s) =>
        setDepts(s.docs.map((d) => ({ id: d.id, name: (d.data() as Ref).name })))
      ),
      onSnapshot(query(collection(db, "jobTitles"), orderBy("name")), (s) =>
        setScopes(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<JobTitle, "id">) })))
      ),
      onSnapshot(query(collection(db, "courses"), orderBy("title")), (s) =>
        setCourses(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Course, "id">) })))
      ),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const say: Say = (msg, undo) => setToast({ msg, undo });
  const tracked = courses.filter((c) => c.delivery === "EXTERNAL_ONLY");

  const NAV: { k: Tab; t: string; n: number }[] = [
    { k: "departments", t: "Departments", n: depts.length },
    { k: "scopes", t: "Authorisations", n: scopes.length },
    { k: "tracked", t: "Tracked Trainings", n: tracked.length },
    { k: "email", t: "Email", n: 0 },
  ];

  return (
    <div>
      <PageHead title="Settings" subtitle="Everything the system is configured by." />

      <div className="card flex flex-col lg:flex-row min-h-[560px] !overflow-visible">
        <nav className="lg:w-[210px] shrink-0 p-2 lg:p-3 flex lg:flex-col gap-1 overflow-x-auto border-b lg:border-b-0 lg:border-r border-slate-100">
          {NAV.map((n) => (
            <button
              key={n.k}
              onClick={() => setTab(n.k)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] text-left whitespace-nowrap transition ${
                tab === n.k
                  ? "bg-brand-50 text-brand-700 font-semibold"
                  : "text-slate-600 font-medium hover:bg-slate-50"
              }`}
            >
              {n.t}
              {n.k !== "email" && (
                <span className={`ml-auto text-[12px] ${tab === n.k ? "text-brand-700" : "text-slate-400"}`}>
                  {n.n}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0 p-4 sm:p-6">
          {tab === "departments" && <Departments rows={depts} say={say} />}
          {tab === "scopes" && <Authorisations rows={scopes} courses={courses} say={say} />}
          {tab === "tracked" && <TrackedTrainings rows={tracked} say={say} />}
          {tab === "email" && <EmailSettings say={say} />}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-[13px] rounded-lg pl-4 pr-2 py-2 shadow-xl flex items-center gap-3 no-print">
          {toast.msg}
          {toast.undo && (
            <button
              onClick={async () => {
                const u = toast.undo!;
                setToast(null);
                await u();
              }}
              className="font-semibold text-[#9fc0ff] hover:text-white px-2 py-1"
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── E-posta ───────────────────────────────────────────── */

/**
 * Sertifika e-postası: eğitim bitince belge PDF olarak kişiye gider (online
 * eğitimde sertifika hak edilince, sınıf eğitiminde "sertifika ver" denince).
 * Buradan şablonu denemek için ÖRNEK bir sertifika gönderilir — numarası
 * "SAMPLE", konu satırında [ÖRNEK] yazar, kayda geçmez.
 */
function EmailSettings({ say }: { say: Say }) {
  const [users, setUsers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(
    () =>
      onSnapshot(query(collection(db, "users"), orderBy("name")), (s) =>
        setUsers(
          s.docs
            .map((d) => ({ id: d.id, ...(d.data() as { name?: string; email?: string; isActive?: boolean }) }))
            .filter((u) => u.email && u.isActive !== false)
            .map((u) => ({ id: u.id, name: u.name || u.email!, email: u.email! }))
        )
      ),
    []
  );
  async function send() {
    if (!uid) return;
    setBusy(true);
    try {
      const r = (await httpsCallable(functions, "emailCertificateNow")({ sampleUserId: uid })).data as {
        ok: boolean;
        to?: string;
        error?: string;
      };
      say(r.ok ? `Sample certificate sent to ${r.to}.` : `Could not send: ${r.error ?? "unknown error"}`);
    } catch (e) {
      say((e as Error).message || "Could not send.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="max-w-[560px]">
      <Title
        title="Email"
        desc="Certificates are emailed as a PDF when an online training is completed, and to the address entered on the QR form when a class session issues certificates."
      />
      <div className="mt-5 rounded-xl border border-slate-200/80 bg-white p-4">
        <div className="text-[13.5px] font-semibold text-slate-800">Send a sample certificate</div>
        <p className="text-[12.5px] text-slate-500 mt-0.5">
          To check how the email and the PDF look. Marked as a sample; nothing is recorded.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 mt-3">
          <select className="input sm:flex-1" value={uid} onChange={(e) => setUid(e.target.value)}>
            <option value="">Choose a person…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.email}
              </option>
            ))}
          </select>
          <button className="btn-primary" disabled={!uid || busy} onClick={send}>
            {busy ? "Sending…" : "Send sample"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Ortak parçalar ─────────────────────────────────────── */

function Title({ title, desc }: { title: string; desc: string }) {
  return (
    <>
      <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-slate-900">{title}</h2>
      <p className="text-[13px] text-slate-500 mt-1">{desc}</p>
    </>
  );
}

const ROWS = "rounded-xl border border-slate-200/80 bg-white divide-y divide-slate-100 overflow-hidden";
const ROW = "group flex items-center gap-2.5 px-3.5 min-h-[46px] text-[13.5px] text-slate-800";

/** Satır sonundaki ×. Fareyle üzerine gelince belirir (dokunmatikte hep açık). */
function RemoveX({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      aria-label={title}
      className="shrink-0 h-7 w-7 grid place-items-center rounded-md text-[17px] leading-none text-slate-400 hover:text-red-600 hover:bg-red-50 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100 transition"
    >
      ×
    </button>
  );
}

/** Yerinde ad düzenleme: Enter / dışarı tıklama kaydeder, Esc vazgeçer. */
function NameInput({
  value,
  onSave,
  onDone,
  className = "",
}: {
  value: string;
  onSave: (v: string) => Promise<void> | void;
  onDone: () => void;
  className?: string;
}) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (busy) return;
    const t = v.trim();
    if (t && t !== value) {
      setBusy(true);
      await onSave(t);
    }
    onDone();
  }
  return (
    <input
      className={`input !py-1.5 ${className}`}
      value={v}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        }
        if (e.key === "Escape") onDone();
      }}
    />
  );
}

/** Tek satırlık ekleme: yaz, Enter ya da Add. */
function AddLine({
  placeholder,
  onAdd,
  children,
}: {
  placeholder: string;
  onAdd: (v: string) => Promise<boolean | void>;
  children?: ReactNode;
}) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    const t = v.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      if ((await onAdd(t)) !== false) setV("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <input
        className="input flex-1 min-w-[180px]"
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            go();
          }
        }}
      />
      {children}
      <button onClick={go} disabled={busy || !v.trim()} className="btn-primary text-xs px-4 disabled:opacity-40">
        Add
      </button>
    </div>
  );
}

/**
 * Eğitim listesi: satır satır, sonda "+ Add training". Basınca eklenebilecekler
 * listelenir (çok uzunsa arama), her tıklama bir eğitim ekler; liste açık kalır.
 * `allowCreate`: listede olmayan bir eğitimi yazıp eklemek — Tracked Training
 * olarak kaydedilir (sistemde vermediğimiz eğitim için Courses'e kurs açmak
 * gerekmesin).
 */
function CourseList({
  ids,
  pool,
  courses,
  addLabel,
  empty,
  onAdd,
  onRemove,
  allowCreate = false,
  tone = "plain",
}: {
  ids: string[];
  pool: string[];
  courses: Course[];
  addLabel: string;
  empty: string;
  onAdd: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  allowCreate?: boolean;
  tone?: "plain" | "minus";
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const title = (id: string) => courses.find((c) => c.id === id)?.title;
  const left = pool.filter((id) => !ids.includes(id));
  const needle = q.trim().toLocaleLowerCase("tr");
  const shown = needle ? left.filter((id) => (title(id) ?? "").toLocaleLowerCase("tr").includes(needle)) : left;

  async function create() {
    const t = newTitle.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const dup = courses.find((c) => c.title.toLocaleLowerCase("tr") === t.toLocaleLowerCase("tr"));
      let id = dup?.id;
      if (!id) {
        const ref = await addDoc(collection(db, "courses"), {
          title: t,
          delivery: "EXTERNAL_ONLY",
          isActive: true,
          recurrenceEvery: null,
          recurrenceUnit: "NONE",
          exam: { required: false },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        id = ref.id;
      }
      if (!ids.includes(id)) await onAdd(id);
      setNewTitle("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ul className={ROWS}>
      {ids.length === 0 && <li className={`${ROW} text-slate-400`}>{empty}</li>}
      {ids.map((id) => (
        <li key={id} className={ROW}>
          <span className={`flex-1 min-w-0 truncate ${tone === "minus" ? "text-amber-800" : ""}`}>
            {title(id) ?? <span className="italic text-slate-400">Deleted course</span>}
          </span>
          <RemoveX onClick={() => onRemove(id)} title="Remove" />
        </li>
      ))}
      {!open ? (
        (left.length > 0 || allowCreate) && (
          <li>
            <button
              onClick={() => setOpen(true)}
              className="w-full text-left px-3.5 min-h-[44px] text-[13px] font-semibold text-brand-700 hover:bg-slate-50"
            >
              + {addLabel}
            </button>
          </li>
        )
      ) : (
        <>
          {left.length > 8 && (
            <li className="px-3 py-2">
              <input className="input !py-1.5" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            </li>
          )}
          {shown.map((id) => (
            <li key={id}>
              <button
                onClick={() => onAdd(id)}
                className="w-full text-left pl-8 pr-3.5 min-h-[40px] text-[13px] text-slate-700 hover:bg-brand-50 hover:text-brand-700 relative"
              >
                <span className="absolute left-3.5 font-bold text-brand-700">+</span>
                {title(id)}
              </button>
            </li>
          ))}
          {left.length > 0 && shown.length === 0 && (
            <li className={`${ROW} text-slate-400 text-[13px]`}>No match.</li>
          )}
          {allowCreate && (
            <li className="px-3 py-2.5 bg-slate-50/70">
              <div className="flex gap-2">
                <input
                  className="input !py-1.5 !text-[13px]"
                  placeholder="Not in the list? Type a name — press Enter"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      create();
                    }
                  }}
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Saved as a tracked training (no content or exam). Set its validity in Tracked Trainings.
              </p>
            </li>
          )}
          <li>
            <button
              onClick={() => {
                setOpen(false);
                setQ("");
              }}
              className="w-full text-right px-3.5 min-h-[38px] text-[12.5px] font-semibold text-slate-500 hover:text-slate-800"
            >
              Done
            </button>
          </li>
        </>
      )}
    </ul>
  );
}

/** Belgeyi silip "Undo"da aynı kimlikle geri yazar. */
async function deleteWithUndo(col: string, id: string, what: string, say: Say) {
  const ref = doc(db, col, id);
  const data = (await getDoc(ref)).data();
  await deleteDoc(ref);
  say(`${what} deleted.`, data ? async () => setDoc(ref, data) : undefined);
}

/* ── Departments ────────────────────────────────────────── */

function Departments({ rows, say }: { rows: Ref[]; say: Say }) {
  const [edit, setEdit] = useState<string | null>(null);
  return (
    <div className="max-w-[560px]">
      <Title title="Departments" desc="Staff are grouped by department in Users and Training Follow-Up." />
      <div className="mt-5">
        <AddLine
          placeholder="New department — press Enter"
          onAdd={async (name) => {
            if (rows.some((r) => r.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"))) {
              say(`${name} already exists.`);
              return false;
            }
            await addDoc(collection(db, "departments"), { name, createdAt: serverTimestamp() });
            say(`${name} added.`);
          }}
        />
      </div>
      <ul className={`${ROWS} mt-4`}>
        {rows.length === 0 && <li className={`${ROW} text-slate-400`}>No departments yet.</li>}
        {rows.map((r) => (
          <li key={r.id} className={ROW}>
            {edit === r.id ? (
              <NameInput
                value={r.name}
                onSave={(name) => updateDoc(doc(db, "departments", r.id), { name })}
                onDone={() => setEdit(null)}
              />
            ) : (
              <button
                onClick={() => setEdit(r.id)}
                className="flex-1 min-w-0 text-left truncate cursor-text py-3"
                title="Click to rename"
              >
                {r.name}
              </button>
            )}
            <RemoveX
              title={`Delete ${r.name}`}
              onClick={() => deleteWithUndo("departments", r.id, r.name, say)}
            />
          </li>
        ))}
      </ul>
      {rows.length > 0 && (
        <p className="text-[12px] text-slate-400 mt-2">
          Click a name to rename it. Staff in a deleted department keep their records.
        </p>
      )}
    </div>
  );
}

/* ── Authorisations ─────────────────────────────────────── */

function Authorisations({ rows, courses, say }: { rows: JobTitle[]; courses: Course[]; say: Say }) {
  const [sel, setSel] = useState<string | null>(null);
  const [subSel, setSubSel] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingSub, setAddingSub] = useState(false);

  const sc = rows.find((r) => r.id === sel) ?? rows[0];
  const subs = sc?.subScopes ?? [];
  const sub = subs.find((s) => s.id === subSel);
  const allIds = courses.map((c) => c.id);
  const title = (id: string) => courses.find((c) => c.id === id)?.title ?? "Deleted course";
  const ref = (jt: JobTitle) => doc(db, "jobTitles", jt.id);

  function pick(id: string | null, subId: string | null = null) {
    setSel(id);
    setSubSel(subId);
    setEditing(false);
    setAddingSub(false);
  }
  /** Alt yetki dizisini bütün olarak yazar — dizi içi tekil güncelleme yok. */
  const writeSubs = (jt: JobTitle, next: SubScope[]) => updateDoc(ref(jt), { subScopes: next });
  const patchSub = (jt: JobTitle, id: string, fn: (s: SubScope) => SubScope) =>
    writeSubs(jt, (jt.subScopes ?? []).map((s) => (s.id === id ? fn(s) : s)));

  let detail: ReactNode = (
    <p className="text-[13px] text-slate-400 py-6 text-center">Add an authorisation to get started.</p>
  );

  if (sc && !sub) {
    detail = (
      <>
        <div className="flex items-center gap-2">
          {editing ? (
            <NameInput
              value={sc.name}
              className="!text-[16px] font-semibold max-w-[360px]"
              onSave={(name) => updateDoc(ref(sc), { name })}
              onDone={() => setEditing(false)}
            />
          ) : (
            <h3 className="flex-1 min-w-0 text-[17px] font-semibold text-slate-900 truncate">{sc.name}</h3>
          )}
          <RowMenu
            label={`Actions for ${sc.name}`}
            items={[
              { label: "Rename", icon: "✎", onClick: () => setEditing(true) },
              {
                label: "Delete",
                icon: "🗑",
                danger: true,
                onClick: () => {
                  pick(null);
                  deleteWithUndo("jobTitles", sc.id, sc.name, say);
                },
              },
            ]}
          />
        </div>

        <h4 className="text-[13.5px] font-semibold text-slate-900 mt-6">Required training</h4>
        <p className="text-[12.5px] text-slate-500 mt-0.5 mb-2.5">Everyone holding {sc.name} must complete these.</p>
        <CourseList
          ids={sc.requiredCourseIds ?? []}
          pool={allIds}
          courses={courses}
          addLabel="Add training"
          empty="No training required yet."
          allowCreate
          onAdd={(id) => updateDoc(ref(sc), { requiredCourseIds: arrayUnion(id) })}
          onRemove={(id) => updateDoc(ref(sc), { requiredCourseIds: arrayRemove(id) })}
        />

        <h4 className="text-[13.5px] font-semibold text-slate-900 mt-7">
          Sub-authorisations <span className="font-normal text-slate-400">optional</span>
        </h4>
        <p className="text-[12.5px] text-slate-500 mt-0.5 mb-2.5">Ticked per person. Each can add or drop training.</p>
        <ul className={ROWS}>
          {subs.map((s) => {
            const plus = s.requiredCourseIds ?? [];
            const minus = s.excludedCourseIds ?? [];
            return (
              <li key={s.id}>
                <button
                  onClick={() => pick(sc.id, s.id)}
                  className="w-full flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 min-h-[46px] text-left hover:bg-slate-50"
                >
                  <span className="flex-1 min-w-[120px] text-[13.5px] font-medium text-slate-800">{s.name}</span>
                  {plus.map((id) => (
                    <span key={id} className="text-[11.5px] rounded-full px-2 py-0.5 bg-brand-50 text-brand-700">
                      + {title(id)}
                    </span>
                  ))}
                  {minus.map((id) => (
                    <span key={id} className="text-[11.5px] rounded-full px-2 py-0.5 bg-amber-50 text-amber-800">
                      − {title(id)}
                    </span>
                  ))}
                  {!plus.length && !minus.length && <span className="text-[12.5px] text-slate-400">No changes</span>}
                  <span className="text-slate-400 text-[16px] ml-1">›</span>
                </button>
              </li>
            );
          })}
          {addingSub ? (
            <li className="px-3 py-2">
              <NameInput
                value=""
                onSave={async (name) => {
                  await writeSubs(sc, [...subs, { id: crypto.randomUUID(), name, requiredCourseIds: [] }]);
                  say(`${name} added.`);
                }}
                onDone={() => setAddingSub(false)}
              />
            </li>
          ) : (
            <li>
              <button
                onClick={() => setAddingSub(true)}
                className="w-full text-left px-3.5 min-h-[44px] text-[13px] font-semibold text-brand-700 hover:bg-slate-50"
              >
                + Add sub-authorisation
              </button>
            </li>
          )}
        </ul>
      </>
    );
  }

  if (sc && sub) {
    detail = (
      <>
        <button onClick={() => pick(sc.id)} className="text-[12.5px] font-medium text-slate-500 hover:text-brand-700 mb-2">
          ← {sc.name}
        </button>
        <div className="flex items-center gap-2">
          {editing ? (
            <NameInput
              value={sub.name}
              className="!text-[16px] font-semibold max-w-[360px]"
              onSave={(name) => patchSub(sc, sub.id, (s) => ({ ...s, name }))}
              onDone={() => setEditing(false)}
            />
          ) : (
            <h3 className="flex-1 min-w-0 text-[17px] font-semibold text-slate-900 truncate">{sub.name}</h3>
          )}
          <RowMenu
            label={`Actions for ${sub.name}`}
            items={[
              { label: "Rename", icon: "✎", onClick: () => setEditing(true) },
              {
                label: "Delete",
                icon: "🗑",
                danger: true,
                onClick: async () => {
                  const before = subs;
                  pick(sc.id);
                  await writeSubs(sc, subs.filter((s) => s.id !== sub.id));
                  say(`${sub.name} deleted.`, async () => {
                    await writeSubs(sc, before);
                  });
                },
              },
            ]}
          />
        </div>
        <p className="text-[12.5px] text-slate-500 mt-1">Sub-authorisation of {sc.name}.</p>

        <h4 className="text-[13.5px] font-semibold text-slate-900 mt-6">Also requires</h4>
        <p className="text-[12.5px] text-slate-500 mt-0.5 mb-2.5">On top of {sc.name}&apos;s required training.</p>
        <CourseList
          ids={sub.requiredCourseIds ?? []}
          pool={allIds.filter((id) => !(sc.requiredCourseIds ?? []).includes(id))}
          courses={courses}
          addLabel="Add training"
          empty="Nothing extra."
          allowCreate
          onAdd={(id) =>
            patchSub(sc, sub.id, (s) => ({ ...s, requiredCourseIds: [...new Set([...(s.requiredCourseIds ?? []), id])] }))
          }
          onRemove={(id) =>
            patchSub(sc, sub.id, (s) => ({ ...s, requiredCourseIds: (s.requiredCourseIds ?? []).filter((c) => c !== id) }))
          }
        />

        {/* Muafiyet yalnızca kapsamın ZORUNLU tuttukları arasından seçilir.
            Ayrı ve görünür: sessizce düşen bir zorunluluk, uygunsuzluğu
            gizlemekle aynı şey olurdu. Takipte MISSING yerine N/A görünür. */}
        <h4 className="text-[13.5px] font-semibold text-slate-900 mt-7">
          Not required for this sub-authorisation <span className="font-normal text-slate-400">optional</span>
        </h4>
        <p className="text-[12.5px] text-slate-500 mt-0.5 mb-2.5">
          Drops training {sc.name} normally requires. Shown as N/A in Training Follow-Up.
        </p>
        <CourseList
          ids={sub.excludedCourseIds ?? []}
          pool={sc.requiredCourseIds ?? []}
          courses={courses}
          addLabel="Choose training to drop"
          empty="None — all of the required training applies."
          tone="minus"
          onAdd={(id) =>
            patchSub(sc, sub.id, (s) => ({ ...s, excludedCourseIds: [...new Set([...(s.excludedCourseIds ?? []), id])] }))
          }
          onRemove={(id) =>
            patchSub(sc, sub.id, (s) => ({ ...s, excludedCourseIds: (s.excludedCourseIds ?? []).filter((c) => c !== id) }))
          }
        />
      </>
    );
  }

  return (
    <div>
      <Title
        title="Authorisations"
        desc="Each authorisation carries its own required training. Give it to someone and that training starts being tracked."
      />
      <div className="flex flex-col md:flex-row gap-4 mt-5 items-start">
        <div className="w-full md:w-[240px] shrink-0">
          <ul className={ROWS}>
            {rows.map((r) => {
              const on = r.id === sc?.id;
              const n = r.requiredCourseIds?.length ?? 0;
              const k = r.subScopes?.length ?? 0;
              return (
                <li key={r.id}>
                  <button
                    onClick={() => pick(r.id)}
                    className={`w-full text-left px-3.5 py-2.5 transition ${on ? "bg-brand-600 text-white" : "hover:bg-slate-50 text-slate-800"}`}
                  >
                    <span className="block text-[13.5px] font-medium truncate">{r.name}</span>
                    <span className={`block text-[11.5px] ${on ? "text-white/70" : "text-slate-400"}`}>
                      {n} required{k ? ` · ${k} sub` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
            <li className="p-2">
              <NewScope
                onAdd={async (name) => {
                  const r = await addDoc(collection(db, "jobTitles"), {
                    name,
                    requiredCourseIds: [],
                    createdAt: serverTimestamp(),
                  });
                  pick(r.id);
                  say(`${name} added.`);
                }}
              />
            </li>
          </ul>
        </div>
        <div className="flex-1 min-w-0 w-full rounded-xl border border-slate-200/80 bg-white p-4 sm:p-5">{detail}</div>
      </div>
    </div>
  );
}

function NewScope({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [v, setV] = useState("");
  return (
    <input
      className="input !py-1.5 !text-[13px]"
      placeholder="+ New authorisation"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={async (e) => {
        if (e.key === "Enter" && v.trim()) {
          e.preventDefault();
          const t = v.trim();
          setV("");
          await onAdd(t);
        }
      }}
    />
  );
}

/* ── Tracked Trainings ──────────────────────────────────── */

const UNIT_LABEL: Record<RecurUnit, string> = {
  YEAR: "Year(s)",
  MONTH: "Month(s)",
  DAY: "Day(s)",
  NONE: "One time",
};

function recurText(every: number | null | undefined, unit: RecurUnit | undefined) {
  if (!unit || unit === "NONE" || !every) return "One time";
  const noun = unit === "DAY" ? "day" : unit === "MONTH" ? "month" : "year";
  return `Valid ${every} ${noun}${every === 1 ? "" : "s"}`;
}

/**
 * Bizim vermediğimiz, personelin dışarıdan almak zorunda olduğu eğitimler.
 * Courses sayfasında görünmezler. Aynı `courses` koleksiyonunda
 * `delivery: "EXTERNAL_ONLY"` olarak durur; böylece yetki gerekli-eğitim
 * listeleri, dış sertifika eşleşmesi ve geçerlilik hesabı hiç değişmeden
 * çalışır. Bir yetkiye eklenince Training Follow-Up'ta sütun olur.
 */
function TrackedTrainings({ rows, say }: { rows: Course[]; say: Say }) {
  const [every, setEvery] = useState("2");
  const [unit, setUnit] = useState<RecurUnit>("YEAR");
  const [edit, setEdit] = useState<Course | null>(null);
  const list = [...rows].sort((a, b) => a.title.localeCompare(b.title, "tr"));

  return (
    <div className="max-w-[680px]">
      <Title
        title="Tracked Trainings"
        desc="Mandatory training Capella does not deliver — staff obtain it elsewhere and we record the certificate. Add it to an authorisation to make it required."
      />
      <div className="mt-5">
        <AddLine
          placeholder="Training name, e.g. EWIS — external provider"
          onAdd={async (title) => {
            if (rows.some((r) => r.title.toLocaleLowerCase("tr") === title.toLocaleLowerCase("tr"))) {
              say(`${title} already exists.`);
              return false;
            }
            await addDoc(collection(db, "courses"), {
              title,
              delivery: "EXTERNAL_ONLY",
              isActive: true,
              recurrenceUnit: unit,
              recurrenceEvery: unit === "NONE" ? null : Number(every) || 1,
              methods: [],
              exam: { required: false },
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            say(`${title} added.`);
          }}
        >
          <input
            className="input !w-[70px]"
            type="number"
            min={1}
            value={unit === "NONE" ? "" : every}
            disabled={unit === "NONE"}
            onChange={(e) => setEvery(e.target.value)}
            aria-label="Valid for"
          />
          <select className="input !w-auto" value={unit} onChange={(e) => setUnit(e.target.value as RecurUnit)} aria-label="Unit">
            {(Object.keys(UNIT_LABEL) as RecurUnit[]).map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u]}
              </option>
            ))}
          </select>
        </AddLine>
      </div>
      <ul className={`${ROWS} mt-4`}>
        {list.length === 0 && <li className={`${ROW} text-slate-400`}>No tracked trainings yet.</li>}
        {list.map((r) => (
          <li key={r.id} className={`${ROW} cursor-pointer hover:bg-slate-50`} onClick={() => setEdit(r)}>
            <span className="flex-1 min-w-0 py-2.5">
              <span className="block truncate">{r.title}</span>
              {(r.methods ?? []).length > 0 && (
                <span className="flex flex-wrap gap-1 mt-1">
                  {r.methods!.map((m) => (
                    <span key={m} className="bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[10.5px] font-medium">
                      {m}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="text-[12.5px] text-slate-500 shrink-0">{recurText(r.recurrenceEvery, r.recurrenceUnit)}</span>
            <RemoveX title={`Delete ${r.title}`} onClick={() => deleteWithUndo("courses", r.id, r.title, say)} />
          </li>
        ))}
      </ul>
      {list.length > 0 && <p className="text-[12px] text-slate-400 mt-2">Click a training to edit its name, validity or methods.</p>}

      {edit && (
        <Modal title="Edit Tracked Training" onClose={() => setEdit(null)} width="max-w-lg">
          <TrackedForm
            existing={edit}
            onSubmit={async (data) => {
              await updateDoc(doc(db, "courses", edit.id), { ...data, updatedAt: serverTimestamp() });
              say(`${data.title} updated.`);
              setEdit(null);
            }}
            onCancel={() => setEdit(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function TrackedForm({
  existing,
  onSubmit,
  onCancel,
}: {
  existing: Course;
  onSubmit: (d: { title: string; recurrenceEvery: number | null; recurrenceUnit: RecurUnit; methods: string[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(existing.title);
  const [every, setEvery] = useState<string>(existing.recurrenceEvery ? String(existing.recurrenceEvery) : "");
  const [unit, setUnit] = useState<RecurUnit>(existing.recurrenceUnit ?? "NONE");
  const [methods, setMethods] = useState((existing.methods ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({
        title: title.trim(),
        recurrenceUnit: unit,
        recurrenceEvery: unit === "NONE" ? null : Number(every) || 1,
        methods: methods
          .split(/[,;\n]/)
          .map((m) => m.trim())
          .filter(Boolean),
      });
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label className="label">Training name</label>
      <input className="input mb-3" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />

      <label className="label">Validity</label>
      <div className="flex gap-2">
        <input
          className="input w-24"
          type="number"
          min={1}
          step={1}
          value={unit === "NONE" ? "" : every}
          disabled={unit === "NONE"}
          onChange={(e) => setEvery(e.target.value)}
          placeholder="2"
        />
        <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as RecurUnit)}>
          {(Object.keys(UNIT_LABEL) as RecurUnit[]).map((u) => (
            <option key={u} value={u}>
              {UNIT_LABEL[u]}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[11px] text-slate-400 mt-1">
        How long an external certificate stays valid, counted from its completion date.
      </p>

      {/* Metodlar: bazı eğitimler tek belge değil, birkaç ayrı yetki demek.
          Her metodun kendi belgesi ve kendi bitiş tarihi olur. */}
      <label className="label mt-4">Methods (optional)</label>
      <input
        className="input"
        value={methods}
        onChange={(e) => setMethods(e.target.value)}
        placeholder="e.g. PT, MT, UT"
      />
      <p className="text-[11px] text-slate-400 mt-1">
        Comma separated. Each person is ticked for the methods they hold; every method has its own certificate and expiry.
      </p>

      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button type="submit" disabled={busy || !title.trim()} className="btn-primary text-xs py-2">
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-red-700">{err}</span>}
      </div>
    </form>
  );
}
