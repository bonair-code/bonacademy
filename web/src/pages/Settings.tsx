import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { PageHead } from "../components/PageHead";
import { Modal } from "../components/Modal";
import { RowMenu } from "../components/RowMenu";

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
type JobTitle = Ref & { requiredCourseIds?: string[]; subScopes?: SubScope[] };
type CourseLite = { id: string; title: string };

/**
 * Ayar kartları. Giriş ekranı her ayarın NE İŞE YARADIĞINI söylüyor —
 * eskiden bu bilgi hiçbir yerde yoktu, ayarları ancak kullanarak öğreniyordun.
 */
type SettingKey = "org" | "departments" | "scopes" | "tracked";

const TILES: {
  key: SettingKey;
  icon: string;
  bg: string;
  title: string;
  desc: string;
}[] = [
  {
    key: "org",
    icon: "🏢",
    bg: "rgba(31,63,110,.1)",
    title: "Certificate Settings",
    desc: "Defaults printed on issued certificates, such as where online training is held.",
  },
  {
    key: "departments",
    icon: "👥",
    bg: "rgba(45,93,79,.12)",
    title: "Departments",
    desc: "Staff are grouped by this list — Training Follow-Up and Users use the same groups.",
  },
  {
    key: "scopes",
    icon: "🛡️",
    bg: "rgba(139,16,19,.1)",
    title: "Authorisation Scopes",
    desc: "Each scope carries its own required training. Give someone a scope and that training starts being tracked.",
  },
  {
    key: "tracked",
    icon: "📋",
    bg: "rgba(138,90,18,.12)",
    title: "Tracked Trainings",
    desc: "Mandatory training BonAir does not deliver. No content, no certificate — tracked only.",
  },
];

export function Settings() {
  const [toast, setToast] = useState<string | null>(null);
  const [open, setOpen] = useState<SettingKey | null>(null);
  /** Kart üzerindeki sayılar — ayarı açmadan ne kadar dolu olduğu görünsün. */
  const [counts, setCounts] = useState<Partial<Record<SettingKey, string>>>({});

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const put = (k: SettingKey, v: string) => setCounts((p) => ({ ...p, [k]: v }));
    const u1 = onSnapshot(collection(db, "departments"), (s) =>
      put("departments", `${s.size} department${s.size === 1 ? "" : "s"}`)
    );
    const u2 = onSnapshot(collection(db, "jobTitles"), (s) => {
      const req = s.docs.reduce(
        (n, d) => n + ((d.data() as JobTitle).requiredCourseIds?.length ?? 0),
        0
      );
      put("scopes", `${s.size} scope${s.size === 1 ? "" : "s"} · ${req} required trainings`);
    });
    const u3 = onSnapshot(collection(db, "courses"), (s) => {
      const n = s.docs.filter((d) => (d.data() as any).delivery === "EXTERNAL_ONLY").length;
      put("tracked", `${n} training${n === 1 ? "" : "s"}`);
    });
    const u4 = onSnapshot(doc(db, "orgSettings", "singleton"), (d) => {
      const loc = (d.data() as any)?.trainingLocation;
      put("org", loc ? `Online training held: ${loc}` : "No default location set");
    });
    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, []);

  return (
    <div>
      <PageHead
        title="Settings"
        subtitle={
          open ? TILES.find((t) => t.key === open)?.title : "Everything the system is configured by."
        }
      />

      {open === null ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {TILES.map((t) => (
            <button
              key={t.key}
              onClick={() => setOpen(t.key)}
              className="card p-4 text-left hover:bg-slate-50/70 transition"
            >
              <span
                className="h-8 w-8 rounded-lg grid place-items-center text-[15px] mb-2.5"
                style={{ background: t.bg }}
                aria-hidden="true"
              >
                {t.icon}
              </span>
              <span className="block text-[13px] font-semibold text-slate-900 tracking-[-0.01em]">
                {t.title}
              </span>
              <p className="text-[11.5px] text-slate-500 mt-1 leading-relaxed">{t.desc}</p>
              <span className="block text-[11.5px] font-semibold text-slate-600 mt-2.5">
                {counts[t.key] ?? ""}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div>
          <button
            onClick={() => setOpen(null)}
            className="text-xs text-slate-500 hover:text-slate-800 mb-3"
          >
            ← All settings
          </button>
          {open === "departments" && (
            <RefList
              title="Departments"
              singular="Department"
              col="departments"
              placeholder="e.g. Maintenance / Quality"
              desc="Staff are grouped by this list — Training Follow-Up and Users use the same groups."
              onToast={setToast}
            />
          )}
          {open === "org" && <OrgSettings onToast={setToast} />}
          {open === "scopes" && <JobTitles onToast={setToast} />}
          {open === "tracked" && <TrackedTrainings onToast={setToast} />}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-[13px] rounded-lg px-4 py-2.5 shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ── Departments ────────────────────────────────────────── */

type RefDialog = { kind: "create" } | { kind: "edit"; row: Ref } | { kind: "delete"; row: Ref } | null;

function RefList({
  title,
  singular,
  col,
  placeholder,
  desc,
  onToast,
}: {
  title: string;
  singular: string;
  col: string;
  placeholder: string;
  desc?: string;
  onToast: (m: string) => void;
}) {
  const [rows, setRows] = useState<Ref[]>([]);
  const [dialog, setDialog] = useState<RefDialog>(null);

  useEffect(() => {
    return onSnapshot(query(collection(db, col), orderBy("name")), (snap) =>
      setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Ref, "id">) })))
    );
  }, [col]);

  return (
    <SectionCard
      title={title}
      count={rows.length}
      desc={desc}
      action={
        <button
          onClick={() => setDialog({ kind: "create" })}
          className="bg-white/15 hover:bg-white/25 text-white text-[11px] font-semibold rounded-md px-2.5 py-1 transition"
        >
          + New {singular}
        </button>
      }
    >
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-slate-50 text-slate-500">
            <th className="th w-10">#</th>
            <th className="th">Name</th>
            <th className="th w-12 text-right no-print">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="p-8 text-center text-slate-400">
                No records yet.
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={r.id} className="hover:bg-slate-50/70">
              <td className="td text-slate-400 tabular-nums">{i + 1}</td>
              <td className="td text-slate-800">{r.name}</td>
              <td className="td text-right">
                <RowMenu
                  label={`Actions for ${r.name}`}
                  items={[
                    { label: "Edit", icon: "✎", onClick: () => setDialog({ kind: "edit", row: r }) },
                    {
                      label: "Delete",
                      icon: "🗑",
                      danger: true,
                      onClick: () => setDialog({ kind: "delete", row: r }),
                    },
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(dialog?.kind === "create" || dialog?.kind === "edit") && (
        <Modal
          title={dialog.kind === "create" ? `New ${singular}` : `Edit ${singular}`}
          onClose={() => setDialog(null)}
          width="max-w-md"
        >
          <NameForm
            initial={dialog.kind === "edit" ? dialog.row.name : ""}
            placeholder={placeholder}
            submitLabel={dialog.kind === "create" ? "Create" : "Save Changes"}
            onSubmit={async (name) => {
              if (dialog.kind === "edit") {
                await updateDoc(doc(db, col, dialog.row.id), { name });
                onToast(`${name} updated.`);
              } else {
                await addDoc(collection(db, col), { name, createdAt: serverTimestamp() });
                onToast(`${name} created.`);
              }
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "delete" && (
        <Modal title={`Delete ${singular}`} onClose={() => setDialog(null)} width="max-w-md">
          <ConfirmDelete
            what={dialog.row.name}
            note={`Staff already assigned to this ${singular.toLowerCase()} keep their records.`}
            onConfirm={async () => {
              await deleteDoc(doc(db, col, dialog.row.id));
              onToast(`${dialog.row.name} deleted.`);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}
    </SectionCard>
  );
}

/* ── Authorisation Scopes (koleksiyon adı geçmişten jobTitles) ─────────────────────────────────────────── */

type JtDialog =
  | { kind: "create" }
  | { kind: "edit"; row: JobTitle }
  | { kind: "addTraining"; row: JobTitle }
  | { kind: "delete"; row: JobTitle }
  | { kind: "createSub"; row: JobTitle }
  | { kind: "editSub"; row: JobTitle; sub: SubScope }
  | { kind: "addSubTraining"; row: JobTitle; sub: SubScope }
  | { kind: "excludeSubTraining"; row: JobTitle; sub: SubScope }
  | { kind: "deleteSub"; row: JobTitle; sub: SubScope }
  | null;

function JobTitles({ onToast }: { onToast: (m: string) => void }) {
  const [rows, setRows] = useState<JobTitle[]>([]);
  const [courses, setCourses] = useState<CourseLite[]>([]);
  const [dialog, setDialog] = useState<JtDialog>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, "jobTitles"), orderBy("name")), (snap) =>
      setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<JobTitle, "id">) })))
    );
    const u2 = onSnapshot(query(collection(db, "courses"), orderBy("title")), (snap) =>
      setCourses(snap.docs.map((d) => ({ id: d.id, title: (d.data() as { title: string }).title })))
    );
    return () => {
      u1();
      u2();
    };
  }, []);

  async function removeCourse(jt: JobTitle, courseId: string) {
    const next = (jt.requiredCourseIds || []).filter((id) => id !== courseId);
    await updateDoc(doc(db, "jobTitles", jt.id), { requiredCourseIds: next });
    onToast("Training removed.");
  }

  async function addCourses(jt: JobTitle, ids: string[]) {
    const next = Array.from(new Set([...(jt.requiredCourseIds || []), ...ids]));
    await updateDoc(doc(db, "jobTitles", jt.id), { requiredCourseIds: next });
    onToast(`${ids.length} training added.`);
  }

  /** Alt yetki dizisini bütün olarak yazar — dizi içi tekil güncelleme yok. */
  async function writeSubs(jt: JobTitle, subs: SubScope[]) {
    await updateDoc(doc(db, "jobTitles", jt.id), { subScopes: subs });
  }
  const subsOf = (jt: JobTitle) => jt.subScopes ?? [];

  async function addSub(jt: JobTitle, name: string) {
    await writeSubs(jt, [
      ...subsOf(jt),
      { id: crypto.randomUUID(), name, requiredCourseIds: [] },
    ]);
    onToast(`${name} added.`);
  }
  async function renameSub(jt: JobTitle, sub: SubScope, name: string) {
    await writeSubs(jt, subsOf(jt).map((s) => (s.id === sub.id ? { ...s, name } : s)));
    onToast(`${name} updated.`);
  }
  async function deleteSub(jt: JobTitle, sub: SubScope) {
    await writeSubs(jt, subsOf(jt).filter((s) => s.id !== sub.id));
    onToast(`${sub.name} deleted.`);
  }
  async function addSubCourses(jt: JobTitle, sub: SubScope, ids: string[]) {
    await writeSubs(
      jt,
      subsOf(jt).map((s) =>
        s.id === sub.id
          ? { ...s, requiredCourseIds: Array.from(new Set([...(s.requiredCourseIds ?? []), ...ids])) }
          : s
      )
    );
    onToast(`${ids.length} training added.`);
  }
  async function removeSubCourse(jt: JobTitle, sub: SubScope, courseId: string) {
    await writeSubs(
      jt,
      subsOf(jt).map((s) =>
        s.id === sub.id
          ? { ...s, requiredCourseIds: (s.requiredCourseIds ?? []).filter((c) => c !== courseId) }
          : s
      )
    );
    onToast("Training removed.");
  }

  /**
   * Muafiyet: alt yetki, kapsamın zorunlu tuttuğu bir eğitimi düşürür.
   * Örn. NDT Staff release yetkisi kullanmadığı için İngilizce sınavı ondan
   * istenmez. Alt yetki yalnızca ekleyebildiği sürece bu modellenemiyordu.
   */
  async function addSubExclusions(jt: JobTitle, sub: SubScope, ids: string[]) {
    await writeSubs(
      jt,
      subsOf(jt).map((s) =>
        s.id === sub.id
          ? { ...s, excludedCourseIds: Array.from(new Set([...(s.excludedCourseIds ?? []), ...ids])) }
          : s
      )
    );
    onToast(`${ids.length} training no longer required.`);
  }
  async function removeSubExclusion(jt: JobTitle, sub: SubScope, courseId: string) {
    await writeSubs(
      jt,
      subsOf(jt).map((s) =>
        s.id === sub.id
          ? { ...s, excludedCourseIds: (s.excludedCourseIds ?? []).filter((c) => c !== courseId) }
          : s
      )
    );
    onToast("Exemption removed.");
  }

  return (
    <SectionCard
      title="Authorisation Scopes"
      count={rows.length}
      desc="Each scope carries its own required training. The moment a scope is given to someone, that training starts being tracked in Training Follow-Up."
      action={
        <button
          onClick={() => setDialog({ kind: "create" })}
          className="bg-white/15 hover:bg-white/25 text-white text-[11px] font-semibold rounded-md px-2.5 py-1 transition"
        >
          + New Authorisation Scope
        </button>
      }
    >
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-slate-50 text-slate-500">
            <th className="th w-10">#</th>
            <th className="th">Name</th>
            <th className="th">Required Training</th>
            <th className="th w-12 text-right no-print">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="p-8 text-center text-slate-400">
                No records yet.
              </td>
            </tr>
          )}
          {rows.map((r, i) => {
            const required = r.requiredCourseIds || [];
            const open = openId === r.id;
            return (
              <Fragment key={r.id}>
                <tr
                  className={`cursor-pointer ${open ? "bg-slate-50" : "hover:bg-slate-50/70"}`}
                  onClick={() => setOpenId(open ? null : r.id)}
                >
                  <td className="td text-slate-400 tabular-nums">{i + 1}</td>
                  <td className="td font-medium text-slate-800">
                    <span className="inline-flex items-center gap-2">
                      <svg
                        viewBox="0 0 20 20"
                        className={`h-3.5 w-3.5 text-slate-400 transition ${open ? "rotate-90" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {r.name}
                    </span>
                  </td>
                  <td className="td">
                    {required.length === 0 ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <span className="text-emerald-700 font-medium">
                        {required.length} course{required.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                    <RowMenu
                      label={`Actions for ${r.name}`}
                      items={[
                        {
                          label: "Edit",
                          icon: "✎",
                          onClick: () => setDialog({ kind: "edit", row: r }),
                        },
                        {
                          label: "Delete",
                          icon: "🗑",
                          danger: true,
                          onClick: () => setDialog({ kind: "delete", row: r }),
                        },
                      ]}
                    />
                  </td>
                </tr>

                {open && (
                  <tr>
                    <td colSpan={4} className="bg-slate-50 px-4 pb-4 pt-0">
                      <div className="rounded-lg border border-slate-200 bg-white">
                        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-100">
                          <div className="text-[12px] font-bold text-slate-700">
                            Required Training for {r.name}
                          </div>
                          <button
                            onClick={() => setDialog({ kind: "addTraining", row: r })}
                            className="btn-primary text-[11px] py-1 px-2.5"
                          >
                            + Add Training
                          </button>
                        </div>

                        {required.length === 0 ? (
                          <p className="px-4 py-6 text-center text-[13px] text-slate-400">
                            No training required for this scope yet.
                          </p>
                        ) : (
                          <ul className="divide-y divide-slate-100">
                            {required.map((cid) => {
                              const c = courses.find((x) => x.id === cid);
                              return (
                                <li
                                  key={cid}
                                  className="flex items-center justify-between gap-3 px-4 py-2"
                                >
                                  <span className="text-[13px] text-slate-800 min-w-0 truncate">
                                    {c ? (
                                      c.title
                                    ) : (
                                      <span className="text-slate-400 italic">
                                        Deleted course ({cid})
                                      </span>
                                    )}
                                  </span>
                                  <button
                                    onClick={() => removeCourse(r, cid)}
                                    className="text-[11px] font-semibold text-slate-500 hover:text-brand-700 shrink-0"
                                  >
                                    Remove
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>

                      {/* Alt yetkiler — kişide tik ile seçilir, her biri kendi
                          eğitimini getirir. */}
                      <div className="rounded-lg border border-slate-200 bg-white mt-3">
                        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-100">
                          <div className="min-w-0">
                            <div className="text-[12px] font-bold text-slate-700">
                              Sub-authorisations
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Ticked per person. Training below applies only to staff who hold
                              that sub-authorisation.
                            </div>
                          </div>
                          <button
                            onClick={() => setDialog({ kind: "createSub", row: r })}
                            className="btn-secondary text-[11px] py-1 px-2.5 shrink-0"
                          >
                            + Add Sub-authorisation
                          </button>
                        </div>

                        {subsOf(r).length === 0 ? (
                          <p className="px-4 py-6 text-center text-[13px] text-slate-400">
                            None — everyone with this scope needs exactly the training above.
                          </p>
                        ) : (
                          <ul className="divide-y divide-slate-100">
                            {subsOf(r).map((s) => (
                              <li key={s.id} className="px-4 py-2.5">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[13px] font-semibold text-slate-800 min-w-0 truncate">
                                    {s.name}
                                  </span>
                                  <div className="flex items-center gap-3 shrink-0">
                                    <button
                                      onClick={() =>
                                        setDialog({ kind: "addSubTraining", row: r, sub: s })
                                      }
                                      className="text-[11px] font-semibold text-brand-700 hover:underline"
                                    >
                                      + Training
                                    </button>
                                    <button
                                      onClick={() =>
                                        setDialog({ kind: "excludeSubTraining", row: r, sub: s })
                                      }
                                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                                      title="Drop a training the scope requires"
                                    >
                                      − Not required
                                    </button>
                                    <button
                                      onClick={() => setDialog({ kind: "editSub", row: r, sub: s })}
                                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                                    >
                                      Rename
                                    </button>
                                    <button
                                      onClick={() =>
                                        setDialog({ kind: "deleteSub", row: r, sub: s })
                                      }
                                      className="text-[11px] font-semibold text-slate-500 hover:text-brand-700"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                                {(s.requiredCourseIds ?? []).length === 0 ? (
                                  <p className="text-[11px] text-slate-400 mt-1">
                                    No training required.
                                  </p>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                                    {(s.requiredCourseIds ?? []).map((cid) => {
                                      const c = courses.find((x) => x.id === cid);
                                      return (
                                        <span
                                          key={cid}
                                          className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 rounded px-1.5 py-0.5 text-[11px]"
                                        >
                                          {c ? (
                                            c.title
                                          ) : (
                                            <span className="italic text-slate-400">
                                              Deleted course
                                            </span>
                                          )}
                                          <button
                                            onClick={() => removeSubCourse(r, s, cid)}
                                            aria-label={`Remove ${c?.title ?? cid}`}
                                            className="text-slate-400 hover:text-brand-700 leading-none"
                                          >
                                            ×
                                          </button>
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* Muafiyetler ayrı ve görünür: sessizce düşen
                                    bir zorunluluk, uygunsuzluğu gizlemekle
                                    aynı şey olurdu. */}
                                {(s.excludedCourseIds ?? []).length > 0 && (
                                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                    <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400">
                                      Not required
                                    </span>
                                    {(s.excludedCourseIds ?? []).map((cid) => {
                                      const c = courses.find((x) => x.id === cid);
                                      return (
                                        <span
                                          key={cid}
                                          className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 ring-1 ring-amber-200 rounded px-1.5 py-0.5 text-[11px]"
                                        >
                                          {c ? (
                                            c.title
                                          ) : (
                                            <span className="italic opacity-70">Deleted course</span>
                                          )}
                                          <button
                                            onClick={() => removeSubExclusion(r, s, cid)}
                                            aria-label={`Require ${c?.title ?? cid} again`}
                                            className="opacity-60 hover:opacity-100 leading-none"
                                          >
                                            ×
                                          </button>
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {(dialog?.kind === "create" || dialog?.kind === "edit") && (
        <Modal
          title={dialog.kind === "create" ? "New Authorisation Scope" : "Edit Authorisation Scope"}
          onClose={() => setDialog(null)}
          width="max-w-md"
        >
          <NameForm
            initial={dialog.kind === "edit" ? dialog.row.name : ""}
            placeholder="e.g. Certifying Staff"
            submitLabel={dialog.kind === "create" ? "Create" : "Save Changes"}
            onSubmit={async (name) => {
              if (dialog.kind === "edit") {
                await updateDoc(doc(db, "jobTitles", dialog.row.id), { name });
                onToast(`${name} updated.`);
              } else {
                await addDoc(collection(db, "jobTitles"), {
                  name,
                  requiredCourseIds: [],
                  createdAt: serverTimestamp(),
                });
                onToast(`${name} created.`);
              }
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "addTraining" && (
        <Modal title="Add Training" subtitle={dialog.row.name} onClose={() => setDialog(null)}>
          <AddTrainingPicker
            courses={courses}
            alreadyRequired={
              rows.find((r) => r.id === dialog.row.id)?.requiredCourseIds ??
              dialog.row.requiredCourseIds ??
              []
            }
            onAdd={async (ids) => {
              const live = rows.find((r) => r.id === dialog.row.id) ?? dialog.row;
              await addCourses(live, ids);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "delete" && (
        <Modal title="Delete Authorisation Scope" onClose={() => setDialog(null)} width="max-w-md">
          <ConfirmDelete
            what={dialog.row.name}
            note="Staff holding this scope keep their records and assigned training."
            onConfirm={async () => {
              await deleteDoc(doc(db, "jobTitles", dialog.row.id));
              onToast(`${dialog.row.name} deleted.`);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {(dialog?.kind === "createSub" || dialog?.kind === "editSub") && (
        <Modal
          title={dialog.kind === "createSub" ? "New Sub-authorisation" : "Rename Sub-authorisation"}
          subtitle={dialog.row.name}
          onClose={() => setDialog(null)}
          width="max-w-md"
        >
          <NameForm
            initial={dialog.kind === "editSub" ? dialog.sub.name : ""}
            placeholder="e.g. NDT"
            submitLabel={dialog.kind === "createSub" ? "Add" : "Save Changes"}
            onSubmit={async (name) => {
              const live = rows.find((r) => r.id === dialog.row.id) ?? dialog.row;
              if (dialog.kind === "editSub") await renameSub(live, dialog.sub, name);
              else await addSub(live, name);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "addSubTraining" && (
        <Modal
          title="Add Training"
          subtitle={`${dialog.row.name} · ${dialog.sub.name}`}
          onClose={() => setDialog(null)}
        >
          <AddTrainingPicker
            courses={courses}
            alreadyRequired={
              rows
                .find((r) => r.id === dialog.row.id)
                ?.subScopes?.find((s) => s.id === dialog.sub.id)?.requiredCourseIds ?? []
            }
            onAdd={async (ids) => {
              const live = rows.find((r) => r.id === dialog.row.id) ?? dialog.row;
              await addSubCourses(live, dialog.sub, ids);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {/* Muafiyet yalnızca kapsamın ZORUNLU tuttukları arasından seçilir —
          zaten gerekmeyen bir eğitimi "gerekmiyor" diye işaretlemek anlamsız
          ve listeyi kirletir. */}
      {dialog?.kind === "excludeSubTraining" && (
        <Modal
          title="Training Not Required"
          subtitle={`${dialog.row.name} · ${dialog.sub.name}`}
          onClose={() => setDialog(null)}
        >
          <p className="text-[12px] text-slate-600 mb-3">
            Pick what <b className="text-slate-800">{dialog.row.name}</b> requires but{" "}
            <b className="text-slate-800">{dialog.sub.name}</b> does not. Staff holding this
            sub-authorisation will show N/A for it instead of MISSING.
          </p>
          <AddTrainingPicker
            courses={courses.filter((c) =>
              (rows.find((r) => r.id === dialog.row.id)?.requiredCourseIds ?? []).includes(c.id)
            )}
            alreadyRequired={
              rows
                .find((r) => r.id === dialog.row.id)
                ?.subScopes?.find((s) => s.id === dialog.sub.id)?.excludedCourseIds ?? []
            }
            onAdd={async (ids) => {
              const live = rows.find((r) => r.id === dialog.row.id) ?? dialog.row;
              await addSubExclusions(live, dialog.sub, ids);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "deleteSub" && (
        <Modal title="Delete Sub-authorisation" onClose={() => setDialog(null)} width="max-w-md">
          <ConfirmDelete
            what={`${dialog.row.name} · ${dialog.sub.name}`}
            note="Staff who hold it keep their records; the training it required stops being required for them."
            onConfirm={async () => {
              const live = rows.find((r) => r.id === dialog.row.id) ?? dialog.row;
              await deleteSub(live, dialog.sub);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}
    </SectionCard>
  );
}

/* ── Tracked Trainings ──────────────────────────────────── */

type RecurUnit = "NONE" | "DAY" | "MONTH" | "YEAR";
type Tracked = {
  id: string;
  title: string;
  recurrenceEvery: number | null;
  recurrenceUnit: RecurUnit;
};
type TrDialog =
  | { kind: "create" }
  | { kind: "edit"; row: Tracked }
  | { kind: "delete"; row: Tracked }
  | null;

const UNIT_LABEL: Record<RecurUnit, string> = {
  NONE: "No recurrence",
  DAY: "Day(s)",
  MONTH: "Month(s)",
  YEAR: "Year(s)",
};

function recurText(every: number | null, unit: RecurUnit) {
  if (unit === "NONE" || !every) return "One time";
  const noun = unit === "DAY" ? "day" : unit === "MONTH" ? "month" : "year";
  return `Every ${every} ${noun}${every === 1 ? "" : "s"}`;
}

/**
 * Bizim vermediğimiz, personelin dışarıdan almak zorunda olduğu eğitimler.
 * Courses sayfasında görünmezler — orada yalnızca sistemden verdiğimiz online
 * ve sınıf eğitimleri var. Buradan tanımlananlar Training Follow-Up'ta sütun
 * olarak çıkar ve kişiye dış sertifika girilince kapanır.
 *
 * Aynı `courses` koleksiyonunda `delivery: "EXTERNAL_ONLY"` olarak durur;
 * böylece kapsam gerekli-eğitim listeleri, dış sertifika eşleşmesi ve
 * geçerlilik hesabı hiç değişmeden çalışır.
 */
function TrackedTrainings({ onToast }: { onToast: (m: string) => void }) {
  const [rows, setRows] = useState<Tracked[]>([]);
  const [dialog, setDialog] = useState<TrDialog>(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, "courses"), where("delivery", "==", "EXTERNAL_ONLY")),
      (snap) => {
        const list = snap.docs.map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            title: x.title ?? "",
            recurrenceEvery: x.recurrenceEvery ?? null,
            recurrenceUnit: (x.recurrenceUnit ?? "NONE") as RecurUnit,
          };
        });
        list.sort((a, b) => a.title.localeCompare(b.title, "tr"));
        setRows(list);
      }
    );
  }, []);

  return (
    <SectionCard
      title="Tracked Trainings"
      count={rows.length}
      desc="Mandatory training BonAir does not deliver — staff obtain it elsewhere. No content, no certificate; these only appear in Training Follow-Up."
      action={
        <button
          onClick={() => setDialog({ kind: "create" })}
          className="bg-white/15 hover:bg-white/25 text-white text-[11px] font-semibold rounded-md px-2.5 py-1 transition"
        >
          + New Tracked Training
        </button>
      }
    >
      <p className="px-4 py-2.5 text-[11px] text-slate-500 border-b border-slate-100 bg-slate-50">
        Training we do not deliver — staff obtain it outside and we record the certificate. It
        does not appear in Courses. Add it to an authorisation scope above to make it required,
        then it shows up in Training Follow-Up.
      </p>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-slate-50 text-slate-500">
            <th className="th w-10">#</th>
            <th className="th">Name</th>
            <th className="th">Validity</th>
            <th className="th w-12 text-right no-print">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="p-8 text-center text-slate-400">
                No records yet.
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={r.id} className="hover:bg-slate-50/70">
              <td className="td text-slate-400 tabular-nums">{i + 1}</td>
              <td className="td font-medium text-slate-800">{r.title}</td>
              <td className="td text-slate-500">
                {recurText(r.recurrenceEvery, r.recurrenceUnit)}
              </td>
              <td className="td text-right">
                <RowMenu
                  label={`Actions for ${r.title}`}
                  items={[
                    { label: "Edit", icon: "✎", onClick: () => setDialog({ kind: "edit", row: r }) },
                    {
                      label: "Delete",
                      icon: "🗑",
                      danger: true,
                      onClick: () => setDialog({ kind: "delete", row: r }),
                    },
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(dialog?.kind === "create" || dialog?.kind === "edit") && (
        <Modal
          title={dialog.kind === "create" ? "New Tracked Training" : "Edit Tracked Training"}
          onClose={() => setDialog(null)}
          width="max-w-lg"
        >
          <TrackedForm
            existing={dialog.kind === "edit" ? dialog.row : null}
            onSubmit={async (data) => {
              if (dialog.kind === "edit") {
                await updateDoc(doc(db, "courses", dialog.row.id), {
                  ...data,
                  updatedAt: serverTimestamp(),
                });
                onToast(`${data.title} updated.`);
              } else {
                await addDoc(collection(db, "courses"), {
                  ...data,
                  delivery: "EXTERNAL_ONLY",
                  isActive: true,
                  exam: { required: false },
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
                onToast(`${data.title} created.`);
              }
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "delete" && (
        <Modal title="Delete Tracked Training" onClose={() => setDialog(null)} width="max-w-md">
          <ConfirmDelete
            what={dialog.row.title}
            note="It disappears from Training Follow-Up. External certificates already recorded against it are kept."
            onConfirm={async () => {
              await deleteDoc(doc(db, "courses", dialog.row.id));
              onToast(`${dialog.row.title} deleted.`);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}
    </SectionCard>
  );
}

function TrackedForm({
  existing,
  onSubmit,
  onCancel,
}: {
  existing: Tracked | null;
  onSubmit: (d: {
    title: string;
    recurrenceEvery: number | null;
    recurrenceUnit: RecurUnit;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [every, setEvery] = useState<string>(
    existing?.recurrenceEvery ? String(existing.recurrenceEvery) : ""
  );
  const [unit, setUnit] = useState<RecurUnit>(existing?.recurrenceUnit ?? "NONE");
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
      });
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label className="label">Training Name</label>
      <input
        className="input mb-3"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. EWIS Group 1 — external provider"
        autoFocus
      />

      <label className="label">Validity Period</label>
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
        <select
          className="input"
          value={unit}
          onChange={(e) => setUnit(e.target.value as RecurUnit)}
        >
          {(Object.keys(UNIT_LABEL) as RecurUnit[]).map((u) => (
            <option key={u} value={u}>
              {UNIT_LABEL[u]}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[10px] text-slate-400 mt-1">
        How long an external certificate stays valid. Training Follow-Up counts the days down
        from the completion date on the certificate.
      </p>

      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button type="submit" disabled={busy || !title.trim()} className="btn-primary text-xs py-2">
          {busy ? "Saving…" : existing ? "Save Changes" : "Create"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-brand-700">{err}</span>}
      </div>
    </form>
  );
}

/* ── Shared bits ────────────────────────────────────────── */

function SectionCard({
  title,
  count,
  desc,
  action,
  children,
}: {
  title: string;
  count: number | null;
  /** Bu ayarın ne işe yaradığı. Eskiden hiçbir yerde yazmıyordu. */
  desc?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card mb-5">
      <div className="px-5 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-slate-900 tracking-[-0.01em]">
            {title}
            {count !== null && <span className="text-slate-400 font-normal"> ({count})</span>}
          </div>
          {desc && <p className="text-[11px] text-slate-500 mt-0.5 max-w-[70ch]">{desc}</p>}
        </div>
        {action}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

/** Zaten zorunlu olanları gizler — listede yalnızca eklenebilecekler kalır. */
function AddTrainingPicker({
  courses,
  alreadyRequired,
  onAdd,
  onCancel,
}: {
  courses: CourseLite[];
  alreadyRequired: string[];
  onAdd: (ids: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const available = courses.filter((c) => !alreadyRequired.includes(c.id));
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? available.filter((c) => c.title.toLowerCase().includes(needle))
    : available;

  function toggle(id: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function submit() {
    if (picked.size === 0) return;
    setBusy(true);
    setErr(null);
    try {
      await onAdd(Array.from(picked));
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  /**
   * Listede olmayan bir eğitimi doğrudan buraya yazmak. Önce Courses'e kurs
   * açma zorunluluğu vardı; sistemde vermediğimiz eğitimler için anlamsızdı.
   * Yazılan ad bir Tracked Training olarak kaydedilir (Settings → Tracked
   * Trainings'te görünür, adı oradan değiştirilebilir) ve hemen eklenir.
   */
  async function createAndAdd() {
    const title = newTitle.trim();
    if (!title) return;
    const dup = courses.find((c) => c.title.toLocaleLowerCase("tr") === title.toLocaleLowerCase("tr"));
    setBusy(true);
    setErr(null);
    try {
      let id = dup?.id;
      if (!id) {
        const ref = await addDoc(collection(db, "courses"), {
          title,
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
      await onAdd([id]);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-[11px] text-slate-500 mb-2">
        Pick the training required for this authorisation scope, or type a new one below.
        Training already required is not listed.
      </p>

      {available.length > 6 && (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search courses…"
          className="input mb-2"
        />
      )}

      {available.length === 0 ? (
        <p className="text-sm text-slate-400 py-4 text-center">
          Everything already required here — add a new one below.
        </p>
      ) : (
        <div className="space-y-1 rounded-lg border border-slate-200 p-2 max-h-72 overflow-auto">
          {shown.length === 0 && (
            <p className="text-center text-xs text-slate-400 py-4">No match.</p>
          )}
          {shown.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={picked.has(c.id)}
                onChange={() => toggle(c.id)}
                className="accent-brand-600 h-4 w-4"
              />
              <span className="text-[13px] text-slate-800">{c.title}</span>
            </label>
          ))}
        </div>
      )}

      {/* Listede yoksa elle yaz. Sistemde vermediğimiz eğitimler için
          Courses'e kurs açmak gerekmiyor. */}
      <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5">
        <div className="text-[11px] font-semibold text-slate-600 mb-1.5">
          Not in the list? Type it
        </div>
        <div className="flex gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                createAndAdd();
              }
            }}
            placeholder="e.g. NDT Level 2 — external provider"
            className="input !py-1.5 !text-xs"
          />
          <button
            onClick={createAndAdd}
            disabled={busy || !newTitle.trim()}
            className="btn-secondary text-xs py-1.5 shrink-0 disabled:opacity-40"
          >
            Add
          </button>
        </div>
        <p className="text-[10px] text-slate-500 mt-1">
          Saved as a tracked training — no content or exam. Rename or set its validity later in
          Settings → Tracked Trainings.
        </p>
      </div>

      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button
          onClick={submit}
          disabled={busy || picked.size === 0}
          className="btn-primary text-xs py-2"
        >
          {busy ? "Adding…" : `Add (${picked.size})`}
        </button>
        <button onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-brand-700">{err}</span>}
      </div>
    </div>
  );
}

function NameForm({
  initial,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(name.trim());
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label className="label">Name</label>
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        autoFocus
      />
      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button type="submit" disabled={busy || !name.trim()} className="btn-primary text-xs py-2">
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-brand-700">{err}</span>}
      </div>
    </form>
  );
}

function ConfirmDelete({
  what,
  note,
  onConfirm,
  onCancel,
}: {
  what: string;
  note: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-slate-700 mb-2">
        Delete <strong>{what}</strong>?
      </p>
      <p className="text-[11px] text-slate-500">{note}</p>
      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button onClick={go} disabled={busy} className="btn-primary text-xs py-2">
          {busy ? "Deleting…" : "Delete"}
        </button>
        <button onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-brand-700">{err}</span>}
      </div>
    </div>
  );
}

/* ── Kurum / sertifika ayarları ─────────────────────────── */

/**
 * Sertifikaya basılan kurum bilgileri. İmza hanesi sınıf eğitiminde eğitmenin
 * adını taşır; online eğitimde "BonAir Academy" yazar. Kalite müdürü hanesi
 * kaldırıldı — onay artık sağdaki doğrulama QRıyla yapılıyor.
 *
 * Değerler sertifika üretilirken DONDURULUR — burayı sonradan değiştirmek
 * daha önce verilmiş belgeleri değiştirmez.
 */
function OrgSettings({ onToast }: { onToast: (m: string) => void }) {
  const [loc, setLoc] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(doc(db, "orgSettings", "singleton"), (d) => {
      const x = (d.data() as any) || {};
      setLoc(x.trainingLocation ?? "");
      setLoaded(true);
    });
  }, []);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await setDoc(
        doc(db, "orgSettings", "singleton"),
        { trainingLocation: loc.trim() || null },
        { merge: true }
      );
      onToast("Certificate settings saved.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Certificate Settings"
      count={null}
      desc="Defaults printed on issued certificates."
    >
      <div className="px-5 py-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Default location for online training</label>
            <input
              className="input"
              value={loc}
              onChange={(e) => setLoc(e.target.value)}
              placeholder="ONLINE"
              disabled={!loaded}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Classroom sessions use their own location instead. Leave blank to print no place at
              all.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button onClick={save} disabled={busy || !loaded} className="btn-primary text-xs py-2">
            {busy ? "Saving…" : "Save"}
          </button>
          {err && <span className="text-xs text-brand-700">{err}</span>}
        </div>
      </div>
    </SectionCard>
  );
}
