/**
 * Kişiye özel diyaloglar: düzenle, şifre sıfırla, eğitim ata, sil.
 *
 * Users sayfasının içinde duruyorlardı; kişinin tam kaydı (/team/:id) da aynı
 * işlemleri sunduğu için ortak yere alındı. İki kopya tutmak, birinde alan
 * eklenip diğerinde eksik kalması demekti.
 */
import { useMemo, useState } from "react";
import { MAIL_ENABLED } from "../../lib/features";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../lib/firebase";
import type { Role } from "../../lib/auth";
import { assignCourses, skipNote } from "../../lib/assign";
import { ScopePicker } from "./ScopePicker";
import { ROLE_LABEL as ROLE_LABEL_, type MethodCourse, type Ref, type ScopeRef, type UserRow } from "./types";
import { ORG } from "../../lib/org";
import { placeCase } from "../../lib/text";

// Tipler types.ts'te: ScopePicker da kullanıyor, iki bileşen birbirini
// import etmesin diye ayrıldı. Buradan yeniden dışa veriliyor — çağıranlar
// (Users, StaffDetail) eskisi gibi UserDialogs'tan alabilsin.
export type { UserRow, Ref, MethodCourse, ScopeRef } from "./types";
export { ROLE_LABEL } from "./types";

export function makePassword(): string {
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
export function PasswordReset({
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
  /** Geçici şifre kişiye e-postayla gitsin. Posta kapalıyken seçenek yok. */
  const [notify, setNotify] = useState(MAIL_ENABLED);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await httpsCallable(functions, "setUserPassword")({ uid: user.id, password: pw, notify });
      const mail = (r.data as { mail?: { ok: boolean } | null }).mail;
      onDone(
        !notify
          ? `Password reset for ${user.name}.`
          : mail?.ok
          ? `Password reset — the temporary password was emailed to ${user.email}.`
          : `Password reset, but the email could not be sent. Pass the password on yourself.`
      );
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
        At least 8 characters. Copy it before saving — it is not shown again.
      </p>

      {MAIL_ENABLED && (
        <label className="flex items-center gap-2 mt-3 text-[12.5px] text-slate-700 cursor-pointer">
          <input type="checkbox" className="accent-brand-600" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Email it to <b className="font-semibold">{user.email}</b>
        </label>
      )}

      <p className="text-[12px] text-slate-700 mt-3 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-2">
        Temporary password. {user.name} is forced to set their own the next time they sign in.
      </p>

      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-100">
        <button type="submit" disabled={busy || pw.length < 8} className="btn-primary text-xs py-2">
          {busy ? "Saving…" : "Reset Password"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-2">
          Cancel
        </button>
        {err && <span className="text-xs text-red-700">{err}</span>}
      </div>
    </form>
  );
}

/** Oluşturma ve düzenleme aynı form; `existing` varsa düzenleme kipi. */
export function UserForm({
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
   * Yeni kullanıcıya şifre nasıl verilir: davet e-postası (kişi kendisi
   * belirler — varsayılan) ya da admin geçici şifre yazar (e-postası olmayan
   * ya da mail gitmeyen durumlar için yedek).
   */
  // Posta kapalıyken davet gönderilemez: tek yol geçici şifre.
  const [access, setAccess] = useState<"invite" | "password">(MAIL_ENABLED ? "invite" : "password");
  /**
   * Müşteri personel değil: departmanı ve yetki kapsamı yok. Bu alanları
   * göstermek, müşteriye zorunlu eğitim atanması gibi yanlış bir sonuç
   * doğuruyordu — kapsam seçilirse Follow-Up onu personel gibi sayardı.
   */
  const isCustomer = roleV === "CUSTOMER";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /**
   * Kapsam kaldırılınca altındaki tikler de düşmeli, yoksa görünmeyen bir alt
   * yetki sessizce eğitim zorunlu tutmaya devam eder. ScopePicker tiki anında
   * düşürüyor; bu, kayıt anındaki son emniyet (eski kayıtlarda artık var
   * olmayan bir alt yetki duruyor olabilir).
   */
  const validSubIds = useMemo(() => {
    const ok = new Set(
      jobTitles.filter((j) => jobTitleIds.includes(j.id)).flatMap((j) => (j.subScopes ?? []).map((x) => x.id))
    );
    return subScopeIds.filter((id) => ok.has(id));
  }, [jobTitleIds, jobTitles, subScopeIds]);

  const canSubmit = editing
    ? name.trim().length > 0
    : name.trim().length > 0 && email.trim().length > 0 && (access === "invite" || password.length >= 8);

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
          // Giriş adresi de buradan değişir (sunucu Auth hesabını da günceller).
          email: email.trim().toLowerCase(),
          role: roleV,
          departmentId: isCustomer ? null : departmentId || null,
          jobTitleIds: isCustomer ? [] : jobTitleIds,
          subScopeIds: isCustomer ? [] : validSubIds,
          birthPlace: placeCase(birthPlace) || null,
          birthDate: birthDate || null,
          company: isCustomer ? company.trim() || null : null,
          courseMethods: isCustomer ? {} : courseMethods,
        });
        onDone(`${name.trim()} updated.`);
      } else {
        const res = await httpsCallable(functions, "createUser")({
          email: email.trim(),
          name: name.trim(),
          role: roleV,
          departmentId: isCustomer ? null : departmentId || null,
          jobTitleIds: isCustomer ? [] : jobTitleIds,
          subScopeIds: isCustomer ? [] : validSubIds,
          birthPlace: placeCase(birthPlace) || null,
          birthDate: birthDate || null,
          company: isCustomer ? company.trim() || null : null,
          courseMethods: isCustomer ? {} : courseMethods,
          invite: access === "invite",
          password: access === "password" ? password : undefined,
        });
        const inv = (res.data as { invite?: { ok: boolean; error?: string } | null }).invite;
        onDone(
          access === "invite"
            ? inv?.ok
              ? `${name.trim()} created — invitation emailed to ${email.trim()}.`
              : `${name.trim()} created, but the invitation email could not be sent. Use “Send invitation” on the user later.`
            : `${name.trim()} created.`
        );
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
            onChange={(e) => setEmail(e.target.value)}
            placeholder={`first.last@${ORG.emailDomain}`}
          />
          {editing && (
            <p className="text-[10px] text-slate-400 mt-1">
              This is also their sign-in address. If you change it, they sign in with the new one.
            </p>
          )}
        </div>
        {!editing && (
          <div className="sm:col-span-2 rounded-lg border border-slate-200 p-3">
            <label className="label !mb-2">Sign-in</label>
            {MAIL_ENABLED ? (
              <>
                <label className="flex items-start gap-2.5 text-[13px] text-slate-800 cursor-pointer">
                  <input
                    type="radio"
                    className="mt-0.5 accent-brand-600"
                    checked={access === "invite"}
                    onChange={() => setAccess("invite")}
                  />
                  <span>
                    <b className="font-semibold">Email an invitation</b>{" "}
                    <span className="text-slate-500">(recommended) — they set their own password from the link.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 text-[13px] text-slate-800 cursor-pointer mt-2">
                  <input
                    type="radio"
                    className="mt-0.5 accent-brand-600"
                    checked={access === "password"}
                    onChange={() => setAccess("password")}
                  />
                  <span>
                    <b className="font-semibold">Set a temporary password</b>{" "}
                    <span className="text-slate-500">— you pass it on yourself; they change it at first sign-in.</span>
                  </span>
                </label>
              </>
            ) : (
              <p className="text-[12.5px] text-slate-600">
                Set a temporary password and pass it on yourself. They change it at first sign-in.
              </p>
            )}
            {access === "password" && (
              <div className="mt-2.5 pl-6">
                <input
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
                {password.length > 0 && password.length < 8 && (
                  <p className="text-[10px] text-red-700 mt-1">Must be at least 8 characters.</p>
                )}
              </div>
            )}
          </div>
        )}
        <div>
          <label className="label">Role</label>
          <select className="input" value={roleV} onChange={(e) => setRoleV(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL_) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL_[r]}
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
        {/* Yetki kapsamı, alt yetkiler ve metodlar TEK yerde — hepsi aynı
            soruyu cevaplıyor. Ayrıntı: components/user/ScopePicker.tsx */}
        <div className={isCustomer ? "hidden" : "sm:col-span-2"}>
          <ScopePicker
            scopes={jobTitles}
            methodCourses={methodCourses}
            scopeIds={jobTitleIds}
            setScopeIds={setJobTitleIds}
            subScopeIds={subScopeIds}
            setSubScopeIds={setSubScopeIds}
            courseMethods={courseMethods}
            setCourseMethods={setCourseMethods}
          />
        </div>

        <div>
          <label className="label">Place of Birth</label>
          <input
            className="input"
            value={birthPlace}
            onBlur={() => setBirthPlace(placeCase(birthPlace))}
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
        {err && <span className="text-xs text-red-700">{err}</span>}
      </div>
    </form>
  );
}

export function AssignPanel({
  userId,
  courses,
  preselect,
  onDone,
  onCancel,
}: {
  userId: string;
  courses: Ref[];
  /** Önceden işaretli kurslar (ör. kişi detayında eksik satırın "Assign"ı). */
  preselect?: string[];
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set((preselect ?? []).filter((id) => courses.some((c) => c.id === id)))
  );
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
      const r = await assignCourses(userId, Array.from(selected));
      onDone(`${r.created} course(s) assigned.` + skipNote(r.skipped));
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
        {err && <span className="text-xs text-red-700">{err}</span>}
      </div>
    </div>
  );
}

export function DeleteConfirm({
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
        {err && <span className="text-xs text-red-700">{err}</span>}
      </div>
    </div>
  );
}
