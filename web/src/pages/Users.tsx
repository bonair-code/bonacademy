import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import { useAuth, type Role } from "../lib/auth";
import { Modal } from "../components/Modal";
import { RowMenu } from "../components/RowMenu";
import { PageHead } from "../components/PageHead";
import { UserImport } from "../components/UserImport";
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
            className="input !w-full sm:!w-64 !py-1.5 !text-xs"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as Role | "")}
            className="input !w-full sm:!w-auto !py-1.5 !text-xs"
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
                {/* Telefonda rol ve kapsam gizli: satır ad + durum + eylem
                    olarak sığıyor, detay kişinin kaydında zaten var. */}
                <th className="th hidden md:table-cell">Role</th>
                <th className="th hidden md:table-cell">Authorisation Scope(s)</th>
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
                      canManage={
                        isAdmin ||
                        (role === "MANAGER" && u.departmentId === profile?.departmentId)
                      }
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
  canManage,
  onEdit,
  onToggle,
  onPassword,
  onAssign,
  onDelete,
}: {
  u: UserRow;
  titles: string[];
  isAdmin: boolean;
  /** Müdür kendi departmanı için yönetebilir; silme yine adminde. */
  canManage: boolean;
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
            {/* Kişinin tam kaydı tek yerde: eğitimler, sertifikalar, dış
                kayıtlar ve atamalar. Eskiden satırın hiçbir tıklama hedefi
                yoktu, bilgi Users modallarıyla /team sayfası arasında
                bölünmüştü. */}
            <Link
              to={`/team/${u.id}`}
              className="block font-semibold text-slate-900 leading-tight truncate hover:text-brand-700 hover:underline"
            >
              {u.name}
            </Link>
            <span className="block text-[11px] text-slate-400 leading-tight truncate">
              {u.email}
              {u.role === "CUSTOMER" && u.company ? ` · ${u.company}` : ""}
            </span>
          </span>
        </span>
      </td>
      <td className="td text-slate-600 hidden md:table-cell">{ROLE_LABEL[u.role]}</td>
      <td className="td hidden md:table-cell">
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
        {canManage ? (
          <RowMenu
            label={`Actions for ${u.name}`}
            items={[
              { label: "Open record", icon: "→", to: `/team/${u.id}` },
              { label: "Edit", icon: "✎", onClick: onEdit },
              {
                label: u.isActive ? "Deactivate" : "Activate",
                icon: u.isActive ? "⦸" : "✓",
                onClick: onToggle,
              },
              { label: "Reset password", icon: "🔑", onClick: onPassword },
              { label: "Assign Training", icon: "▤", onClick: onAssign },
              // Hesap silmek adminde kalıyor: personel silmek sertifika ve
              // atama kayıtlarını öksüz bırakıyor, denetim izi meselesi.
              ...(isAdmin
                ? [{ label: "Delete", icon: "🗑", danger: true, onClick: onDelete }]
                : []),
            ]}
          />
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
    </tr>
  );
}

