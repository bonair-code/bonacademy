import { Fragment, useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import { useAuth, type Role } from "../lib/auth";
import { MultiSelect } from "../components/MultiSelect";
import { Modal } from "../components/Modal";
import { RowMenu } from "../components/RowMenu";
import { PageHead } from "../components/PageHead";
import { UserImport } from "../components/UserImport";
import { subScopesOf, type SubScope } from "../lib/requirements";

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  departmentId: string | null;
  jobTitleIds?: string[];
  subScopeIds?: string[];
  /** Sertifikadaki "PLACE & DATE of BIRTH" satırı için. */
  birthPlace?: string | null;
  birthDate?: string | null; // YYYY-MM-DD
  /** Metod bazlı eğitimlerde kişinin yetkili olduğu metodlar. */
  courseMethods?: Record<string, string[]>;
  /** Müşteri hesabının bağlı olduğu kurum; personelde boş. */
  company?: string | null;
  isActive: boolean;
};
type Ref = { id: string; name: string };
type MethodCourse = { id: string; title: string; methods: string[] };
type ScopeRef = Ref & { subScopes?: SubScope[] };

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  INSTRUCTOR: "Instructor",
  USER: "Employee",
  CUSTOMER: "Customer",
};

type Dialog =
  | { kind: "create" }
  | { kind: "import" }
  | { kind: "edit"; user: UserRow }
  | { kind: "assign"; user: UserRow }
  | { kind: "delete"; user: UserRow }
  | { kind: "password"; user: UserRow }
  | null;

export function Users() {
  const { profile, role } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<Ref[]>([]);
  const [jobTitles, setJobTitles] = useState<ScopeRef[]>([]);
  const [courses, setCourses] = useState<Ref[]>([]);
  /** Metodlara bölünmüş eğitimler — kişide hangi metodda yetkili olduğu tiklenir. */
  const [methodCourses, setMethodCourses] = useState<MethodCourse[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "">("");

  useEffect(() => {
    if (!profile) return;
    const base = collection(db, "users");
    const uq =
      role === "MANAGER"
        ? query(base, where("departmentId", "==", profile.departmentId))
        : base;
    const u1 = onSnapshot(uq, (snap) =>
      setUsers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<UserRow, "id">) })))
    );
    const u2 = onSnapshot(query(collection(db, "departments"), orderBy("name")), (snap) =>
      setDepartments(snap.docs.map((d) => ({ id: d.id, name: (d.data() as any).name })))
    );
    const u3 = onSnapshot(query(collection(db, "jobTitles"), orderBy("name")), (snap) =>
      setJobTitles(
        snap.docs.map((d) => ({
          id: d.id,
          name: (d.data() as any).name,
          subScopes: (d.data() as any).subScopes ?? [],
        }))
      )
    );
    const u4 = onSnapshot(query(collection(db, "courses"), orderBy("title")), (snap) => {
      setMethodCourses(
        snap.docs
          .map((d) => ({
            id: d.id,
            title: String((d.data() as any).title ?? ""),
            methods: ((d.data() as any).methods ?? []) as string[],
          }))
          .filter((c) => c.methods.length > 0)
      );
      setCourses(
        snap.docs
          // Dışarıdan alınan eğitimler sistemde tamamlanamaz — atanmaz.
          .filter((d) => (d.data() as any).delivery !== "EXTERNAL_ONLY")
          .map((d) => ({ id: d.id, name: (d.data() as any).title }))
      );
    });
    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, [profile, role]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const deptName = useMemo(() => {
    const m = new Map(departments.map((d) => [d.id, d.name]));
    return (id: string | null) => (id ? m.get(id) ?? "No department" : "No department");
  }, [departments]);

  const titleNames = useMemo(() => {
    const m = new Map(jobTitles.map((j) => [j.id, j.name]));
    return (ids?: string[]) => (ids ?? []).map((i) => m.get(i)).filter(Boolean) as string[];
  }, [jobTitles]);

  const isAdmin = role === "ADMIN";
  const inactiveCount = users.filter((u) => !u.isActive).length;
  const sorted = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    return users
      .filter((u) => (roleFilter ? u.role === roleFilter : true))
      .filter((u) =>
        needle
          ? `${u.name} ${u.email}`.toLocaleLowerCase("tr").includes(needle)
          : true
      )
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [users, q, roleFilter]);

  /**
   * Departmana göre grupla — Training Follow-Up ile aynı düzen, böylece aynı
   * personel iki ekranda aynı sırayla görünür. 71 satırlık düz alfabetik liste
   * "şu departmanda kim var" sorusuna cevap vermiyordu.
   *
   * Müşteriler kendi grubunda: personel değiller, departmanları da yok.
   */
  const groups = useMemo(() => {
    const m = new Map<string, UserRow[]>();
    for (const u of sorted) {
      const key = u.role === "CUSTOMER" ? "￿Customers" : deptName(u.departmentId);
      m.set(key, [...(m.get(key) ?? []), u]);
    }
    return [...m.entries()]
      // "￿" öneki müşterileri her zaman en sona atar.
      .sort((a, b) => a[0].localeCompare(b[0], "tr"))
      .map(([key, list]) => ({
        name: key === "￿Customers" ? "Customers" : key,
        list,
      }));
  }, [sorted, departments]);

  async function setActive(u: UserRow, isActive: boolean) {
    try {
      await httpsCallable(functions, "updateUser")({ uid: u.id, isActive });
      setToast(`${u.name} ${isActive ? "activated" : "deactivated"}.`);
    } catch (e) {
      setToast((e as Error).message);
    }
  }

  return (
    <div>
      <PageHead
        title="Users"
        subtitle={isAdmin ? "Staff accounts, roles and departments." : "Staff in your department."}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email…"
            className="input !w-64 !py-1.5 !text-xs"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as Role | "")}
            className="input !w-auto !py-1.5 !text-xs"
          >
            <option value="">All roles</option>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          {(q || roleFilter) && (
            <button
              onClick={() => {
                setQ("");
                setRoleFilter("");
              }}
              className="text-[11px] font-semibold text-slate-500 hover:text-brand-700"
            >
              Clear
            </button>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDialog({ kind: "import" })}
              className="btn-secondary text-xs py-2"
            >
              ↑ Import from Excel
            </button>
            <button
              onClick={() => setDialog({ kind: "create" })}
              className="btn-primary text-xs py-2"
            >
              + New User
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <span className="text-[13px] font-bold text-slate-900">
            People{" "}
            <span className="text-slate-400 font-normal">
              ({sorted.length}
              {sorted.length !== users.length ? ` of ${users.length}` : ""})
            </span>
          </span>
          <span className="text-[11.5px] text-slate-400">
            {groups.length} group{groups.length === 1 ? "" : "s"}
            {inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ""}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                <th className="th">Person</th>
                <th className="th">Role</th>
                <th className="th">Authorisation Scope(s)</th>
                <th className="th">Status</th>
                <th className="th w-12 text-right no-print">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    No users match these filters.
                  </td>
                </tr>
              )}
              {groups.map((g) => (
                <Fragment key={g.name}>
                  <tr>
                    <td
                      colSpan={5}
                      className="bg-slate-50 border-y border-slate-100 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.07em] text-slate-500"
                    >
                      {g.name}{" "}
                      <span className="font-normal normal-case tracking-normal text-slate-400 text-[10.5px]">
                        · {g.list.length} {g.list.length === 1 ? "person" : "people"}
                      </span>
                    </td>
                  </tr>
                  {g.list.map((u) => (
                    <UserRowView
                      key={u.id}
                      u={u}
                      titles={titleNames(u.jobTitleIds)}
                      isAdmin={isAdmin}
                      onEdit={() => setDialog({ kind: "edit", user: u })}
                      onToggle={() => setActive(u, !u.isActive)}
                      onPassword={() => setDialog({ kind: "password", user: u })}
                      onAssign={() => setDialog({ kind: "assign", user: u })}
                      onDelete={() => setDialog({ kind: "delete", user: u })}
                    />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-[13px] rounded-lg px-4 py-2.5 shadow-xl">
          {toast}
        </div>
      )}

      {dialog?.kind === "create" && (
        <Modal title="New User" onClose={() => setDialog(null)}>
          <UserForm
            departments={departments}
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

      {dialog?.kind === "import" && (
        <Modal title="Import Users from Excel" onClose={() => setDialog(null)}>
          <UserImport
            departments={departments}
            jobTitles={jobTitles}
            onClose={() => setDialog(null)}
            onDone={(m) => setToast(m)}
          />
        </Modal>
      )}

      {dialog?.kind === "edit" && (
        <Modal title="Edit User" subtitle={dialog.user.email} onClose={() => setDialog(null)}>
          <UserForm
            existing={dialog.user}
            departments={departments}
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

      {dialog?.kind === "assign" && (
        <Modal title="Assign Training" subtitle={dialog.user.name} onClose={() => setDialog(null)}>
          <AssignPanel
            userId={dialog.user.id}
            courses={courses}
            onDone={(m) => {
              setToast(m);
              setDialog(null);
            }}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === "delete" && (
        <Modal title="Delete User" subtitle={dialog.user.email} onClose={() => setDialog(null)} width="max-w-md">
          <DeleteConfirm
            user={dialog.user}
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
          subtitle={`${dialog.user.name} · ${dialog.user.email}`}
          onClose={() => setDialog(null)}
          width="max-w-md"
        >
          <PasswordReset
            user={dialog.user}
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

/** Rastgele, okunabilir geçici şifre — el ile aktarılacağı için karışık değil. */
/** Ad-soyaddan baş harfler — satırda kişiyi ayırt etmeyi hızlandırır. */
function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("tr");
}

/**
 * Personel satırı. Ad ve e-posta tek hücrede: iki ayrı sütun yatayda boşuna
 * yer yiyordu ve departman kolonu artık grup başlığında.
 */
function UserRowView({
  u,
  titles,
  isAdmin,
  onEdit,
  onToggle,
  onPassword,
  onAssign,
  onDelete,
}: {
  u: UserRow;
  titles: string[];
  isAdmin: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onPassword: () => void;
  onAssign: () => void;
  onDelete: () => void;
}) {
  // Üç kapsamı olan kişilerde satır taşıyordu; ilki yazılır, kalanı sayılır.
  const first = titles[0];
  const rest = titles.length - 1;

  return (
    <tr className="hover:bg-slate-50/70 border-b border-slate-100">
      <td className="td">
        <span className="flex items-center gap-2.5">
          <span className="h-7 w-7 rounded-full bg-brand-50 text-brand-700 grid place-items-center text-[10.5px] font-bold shrink-0">
            {initialsOf(u.name) || "?"}
          </span>
          <span className="min-w-0">
            <span className="block font-semibold text-slate-900 leading-tight truncate">
              {u.name}
            </span>
            <span className="block text-[11px] text-slate-400 leading-tight truncate">
              {u.email}
              {u.role === "CUSTOMER" && u.company ? ` · ${u.company}` : ""}
            </span>
          </span>
        </span>
      </td>
      <td className="td text-slate-600">{ROLE_LABEL[u.role]}</td>
      <td className="td">
        {titles.length === 0 ? (
          <span className="text-slate-300">—</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[11px] font-medium">
              {first}
            </span>
            {rest > 0 && (
              <span className="text-[11px] text-slate-400" title={titles.join(", ")}>
                +{rest}
              </span>
            )}
          </span>
        )}
      </td>
      <td className="td">
        <span
          className={`text-[9.5px] font-bold uppercase tracking-[0.04em] px-2 py-1 rounded ${
            u.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {u.isActive ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="td text-right no-print">
        {isAdmin ? (
          <RowMenu
            label={`Actions for ${u.name}`}
            items={[
              { label: "Edit", icon: "✎", onClick: onEdit },
              {
                label: u.isActive ? "Deactivate" : "Activate",
                icon: u.isActive ? "⦸" : "✓",
                onClick: onToggle,
              },
              { label: "Reset password", icon: "🔑", onClick: onPassword },
              { label: "Assign Training", icon: "▤", onClick: onAssign },
              { label: "Delete", icon: "🗑", danger: true, onClick: onDelete },
            ]}
          />
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
    </tr>
  );
}

function makePassword(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const num = "23456789";
  const low = "abcdefghijkmnpqrstuvwxyz";
  const pick = (s: string, n: number) =>
    Array.from(crypto.getRandomValues(new Uint32Array(n)))
      .map((r) => s[r % s.length])
      .join("");
  return `${pick(abc, 2)}${pick(low, 4)}${pick(num, 3)}!`;
}

/**
 * Admin, kullanıcının şifresini sıfırlar. Yeni şifre geçicidir — kullanıcı
 * ilk girişte kendi şifresini belirlemek zorunda kalır.
 */
function PasswordReset({
  user,
  onDone,
  onCancel,
}: {
  user: UserRow;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [pw, setPw] = useState(makePassword());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 6) return;
    setBusy(true);
    setErr(null);
    try {
      await httpsCallable(functions, "setUserPassword")({ uid: user.id, password: pw });
      onDone(`Password reset for ${user.name}.`);
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label className="label">Temporary Password</label>
      <div className="flex gap-2">
        <input
          className="input font-mono"
          value={pw}
          onChange={(e) => {
            setPw(e.target.value);
            setCopied(false);
          }}
          autoFocus
        />
        <button
          type="button"
          onClick={() => {
            setPw(makePassword());
            setCopied(false);
          }}
          className="btn-secondary text-xs py-1.5 shrink-0"
        >
          New
        </button>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(pw);
            setCopied(true);
          }}
          className="btn-secondary text-xs py-1.5 shrink-0"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-[10px] text-slate-500 mt-1">
        At least 6 characters. Copy it before saving — it is not shown again.
      </p>

      <p className="text-[12px] text-slate-700 mt-3 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-2">
        Temporary password. {user.name} is forced to set their own the next time they sign in.
      </p>

      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button type="submit" disabled={busy || pw.length < 6} className="btn-primary text-xs py-2">
          {busy ? "Saving…" : "Reset Password"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-brand-700">{err}</span>}
      </div>
    </form>
  );
}

/** Oluşturma ve düzenleme aynı form; `existing` varsa düzenleme kipi. */
function UserForm({
  existing,
  departments,
  jobTitles,
  methodCourses,
  onDone,
  onCancel,
}: {
  existing?: UserRow;
  departments: Ref[];
  jobTitles: ScopeRef[];
  methodCourses: MethodCourse[];
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const editing = !!existing;
  const [name, setName] = useState(existing?.name ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [roleV, setRoleV] = useState<Role>(existing?.role ?? "USER");
  const [departmentId, setDepartmentId] = useState(existing?.departmentId ?? "");
  const [jobTitleIds, setJobTitleIds] = useState<string[]>(existing?.jobTitleIds ?? []);
  const [subScopeIds, setSubScopeIds] = useState<string[]>(existing?.subScopeIds ?? []);
  const [birthPlace, setBirthPlace] = useState(existing?.birthPlace ?? "");
  const [birthDate, setBirthDate] = useState(existing?.birthDate ?? "");
  const [company, setCompany] = useState(existing?.company ?? "");
  const [courseMethods, setCourseMethods] = useState<Record<string, string[]>>(
    existing?.courseMethods ?? {}
  );
  const [password, setPassword] = useState("");
  /**
   * Müşteri personel değil: departmanı ve yetki kapsamı yok. Bu alanları
   * göstermek, müşteriye zorunlu eğitim atanması gibi yanlış bir sonuç
   * doğuruyordu — kapsam seçilirse Follow-Up onu personel gibi sayardı.
   */
  const isCustomer = roleV === "CUSTOMER";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const availableSubs = useMemo(
    () => subScopesOf(jobTitleIds, jobTitles),
    [jobTitleIds, jobTitles]
  );
  // Kapsam kaldırılınca altındaki tikler de düşmeli, yoksa görünmeyen bir
  // alt yetki sessizce eğitim zorunlu tutmaya devam eder.
  const validSubIds = subScopeIds.filter((id) => availableSubs.some((s) => s.id === id));

  const canSubmit = editing
    ? name.trim().length > 0
    : name.trim().length > 0 && email.trim().length > 0 && password.length >= 6;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      if (editing) {
        await httpsCallable(functions, "updateUser")({
          uid: existing!.id,
          name: name.trim(),
          role: roleV,
          departmentId: isCustomer ? null : departmentId || null,
          jobTitleIds: isCustomer ? [] : jobTitleIds,
          subScopeIds: isCustomer ? [] : validSubIds,
          birthPlace: birthPlace.trim() || null,
          birthDate: birthDate || null,
          company: isCustomer ? company.trim() || null : null,
          courseMethods: isCustomer ? {} : courseMethods,
        });
        onDone(`${name.trim()} updated.`);
      } else {
        await httpsCallable(functions, "createUser")({
          email: email.trim(),
          name: name.trim(),
          role: roleV,
          departmentId: isCustomer ? null : departmentId || null,
          jobTitleIds: isCustomer ? [] : jobTitleIds,
          subScopeIds: isCustomer ? [] : validSubIds,
          birthPlace: birthPlace.trim() || null,
          birthDate: birthDate || null,
          company: isCustomer ? company.trim() || null : null,
          courseMethods: isCustomer ? {} : courseMethods,
          password,
        });
        onDone(`${name.trim()} created.`);
      }
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Full Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            className="input disabled:bg-slate-50 disabled:text-slate-500"
            type="email"
            value={email}
            disabled={editing}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="first.last@bonair.com.tr"
          />
          {editing && (
            <p className="text-[10px] text-slate-400 mt-1">Email cannot be changed here.</p>
          )}
        </div>
        {!editing && (
          <div>
            <label className="label">Temporary Password</label>
            <input
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
            {password.length > 0 && password.length < 6 && (
              <p className="text-[10px] text-brand-700 mt-1">Must be at least 6 characters.</p>
            )}
          </div>
        )}
        <div>
          <label className="label">Role</label>
          <select className="input" value={roleV} onChange={(e) => setRoleV(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        {isCustomer ? (
          <div>
            <label className="label">Company</label>
            <input
              className="input"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Redstar Aviation"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Which organisation this customer belongs to.
            </p>
          </div>
        ) : (
          <div>
            <label className="label">Department</label>
            <select
              className="input"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">— Select —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {isCustomer && (
          <div className="sm:col-span-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] text-slate-600">
            A customer only sees their own training and certificates. No authorisation scope
            applies, and they are not counted in organisation compliance — assign their training
            from the row menu (<b className="text-slate-700">Assign courses</b>).
          </div>
        )}
        <div className={isCustomer ? "hidden" : "sm:col-span-2"}>
          <label className="label">Authorisation Scope(s)</label>
          <MultiSelect options={jobTitles} value={jobTitleIds} onChange={setJobTitleIds} />

          {/* Seçilen kapsamların alt yetkileri. Tik yoksa o alt yetkinin
              eğitimi bu kişide zorunlu olmaz. */}
          {availableSubs.length > 0 && (
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="text-[11px] font-semibold text-slate-600 mb-1.5">
                Sub-authorisations
              </div>
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
                {availableSubs.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-[13px] text-slate-700">
                    <input
                      type="checkbox"
                      className="accent-brand-600 h-3.5 w-3.5"
                      checked={subScopeIds.includes(s.id)}
                      onChange={(e) =>
                        setSubScopeIds((prev) =>
                          e.target.checked
                            ? [...prev, s.id]
                            : prev.filter((x) => x !== s.id)
                        )
                      }
                    />
                    {s.name}
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">
                Only ticked items bring their own required training. Leave one unticked and its
                courses show as N/A for this person.
              </p>
            </div>
          )}
        </div>
        {/* Metod bazlı eğitimler: kişi hangi metodlarda yetkili. Tikli olup
            belgesi olmayan metod Follow-Up'ta eksik görünür. */}
        {!isCustomer &&
          methodCourses.map((mc) => (
            <div key={mc.id} className="sm:col-span-2">
              <label className="label">{mc.title} — methods</label>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {mc.methods.map((m) => {
                  const on = (courseMethods[mc.id] ?? []).includes(m);
                  return (
                    <label
                      key={m}
                      className="flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="accent-brand-600 h-3.5 w-3.5"
                        checked={on}
                        onChange={(e) =>
                          setCourseMethods((prev) => {
                            const cur = prev[mc.id] ?? [];
                            const next = e.target.checked
                              ? [...cur, m]
                              : cur.filter((x) => x !== m);
                            return { ...prev, [mc.id]: next };
                          })
                        }
                      />
                      {m}
                    </label>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Each ticked method is tracked with its own certificate and expiry date.
              </p>
            </div>
          ))}

        <div>
          <label className="label">Place of Birth</label>
          <input
            className="input"
            value={birthPlace}
            onChange={(e) => setBirthPlace(e.target.value)}
            placeholder="e.g. İstanbul"
          />
        </div>
        <div>
          <label className="label">Date of Birth</label>
          <input
            className="input"
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Printed on the training certificate.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button type="submit" disabled={busy || !canSubmit} className="btn-primary text-xs py-2">
          {busy ? (editing ? "Saving…" : "Creating…") : editing ? "Save Changes" : "Create User"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-brand-700">{err}</span>}
      </div>
    </form>
  );
}

function AssignPanel({
  userId,
  courses,
  onDone,
  onCancel,
}: {
  userId: string;
  courses: Ref[];
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function assign() {
    if (selected.size === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await httpsCallable(functions, "assignCourses")({
        userId,
        courseIds: Array.from(selected),
      });
      const created = (res.data as { created?: number })?.created ?? 0;
      onDone(`${created} course(s) assigned.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-[11px] text-slate-500 mb-2">
        Select the courses to assign to this employee:
      </p>
      {courses.length === 0 ? (
        <p className="text-sm text-slate-400">No courses yet.</p>
      ) : (
        <div className="space-y-1 rounded-lg border border-slate-200 bg-white p-2 mb-2 max-h-64 overflow-auto">
          {courses.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                className="accent-brand-600 h-4 w-4"
              />
              <span className="text-[13px] text-slate-800">{c.name}</span>
            </label>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 mt-4 pt-4 border-t border-slate-100">
        <button
          onClick={assign}
          disabled={busy || selected.size === 0}
          className="btn-primary text-xs py-2"
        >
          {busy ? "Assigning…" : `Assign (${selected.size})`}
        </button>
        <button onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-brand-700">{err}</span>}
      </div>
    </div>
  );
}

function DeleteConfirm({
  user,
  onDone,
  onCancel,
}: {
  user: UserRow;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await httpsCallable(functions, "deleteUser")({ uid: user.id });
      onDone(`${user.name} deleted.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-slate-700 mb-2">
        Delete <strong>{user.name}</strong>? Their sign-in account and profile are removed and they
        lose access immediately.
      </p>
      <p className="text-[11px] text-slate-500">
        Completed training records and certificates are kept — deleting a person does not erase
        their training history.
      </p>
      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button onClick={remove} disabled={busy} className="btn-primary text-xs py-2">
          {busy ? "Deleting…" : "Delete User"}
        </button>
        <button onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-brand-700">{err}</span>}
      </div>
    </div>
  );
}
