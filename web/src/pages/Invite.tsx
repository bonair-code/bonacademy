import { useEffect, useState } from "react";
import { ORG } from "../lib/org";
import { Link, useNavigate, useParams } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../lib/firebase";
import { PasswordInput, PublicError, PublicShell, pubButton, pubLabel } from "../components/PublicShell";

type Info = { valid: boolean; reason?: string; name?: string; email?: string };

/**
 * Davet bağlantısı (/invite/:token): kişi şifresini kendisi belirler ve
 * doğrudan giriş yapar. Bağlantı e-postadaki davetten gelir (createUser /
 * resendInvite); tek kullanımlık, 14 gün geçerli.
 */
export function Invite() {
  const { token = "" } = useParams<{ token: string }>();
  const nav = useNavigate();
  const [info, setInfo] = useState<Info | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    httpsCallable(functions, "inviteInfo")({ token })
      .then((r) => setInfo(r.data as Info))
      .catch(() => setInfo({ valid: false, reason: "invalid" }));
  }, [token]);

  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const ok = pw.length >= 8 && pw === pw2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await httpsCallable(functions, "acceptInvite")({ token, password: pw });
      const email = (r.data as { email: string }).email;
      // Şifre kaydedildi; kullanıcı doğrudan panele girer.
      try {
        await signInWithEmailAndPassword(auth, email, pw);
      } catch {
        nav("/login", { replace: true });
        return;
      }
      nav("/dashboard", { replace: true });
    } catch (e2) {
      setErr((e2 as Error).message.replace(/^.*?:\s*/, ""));
      setBusy(false);
    }
  }

  if (!info) {
    return (
      <PublicShell title="Welcome" subtitle="Checking your invitation…">
        <div className="h-10" />
      </PublicShell>
    );
  }

  if (!info.valid) {
    const msg =
      info.reason === "used"
        ? "This invitation was already used — your password is set. Sign in with your email, or use “Forgot password?” on the sign-in page."
        : info.reason === "expired"
        ? `This invitation link has expired. Please ask BonAir (${ORG.contactEmail}) for a new one.`
        : info.reason === "replaced"
        ? "A newer invitation was sent to you — please use the link in the most recent email."
        : "This invitation link is not valid. Please check that you opened the full link from the email.";
    return (
      <PublicShell title="Invitation" subtitle={undefined}>
        <p className="text-[14.5px] text-slate-600 leading-relaxed">{msg}</p>
        <Link to="/login" className={`${pubButton} mt-6 inline-flex justify-center w-full`}>
          Go to sign in
        </Link>
      </PublicShell>
    );
  }

  return (
    <PublicShell title={`Welcome${info.name ? `, ${info.name.split(" ")[0]}` : ""}`} subtitle="Set a password to activate your account.">
      <form onSubmit={submit}>
        <label className={pubLabel}>Email</label>
        <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-[14.5px] text-slate-700 mb-4 truncate">
          {info.email}
        </div>
        <label className={pubLabel}>New password</label>
        <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus required />
        {tooShort && <p className="text-[12px] text-amber-200 mt-1.5">At least 8 characters.</p>}
        <label className={`${pubLabel} mt-4`}>Repeat password</label>
        <PasswordInput value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />
        {mismatch && <p className="text-[12px] text-amber-200 mt-1.5">The passwords do not match.</p>}
        {err && <PublicError>{err}</PublicError>}
        <button type="submit" disabled={!ok || busy} className={`${pubButton} mt-6 w-full disabled:opacity-50`}>
          {busy ? "Saving…" : "Set password and sign in"}
        </button>
      </form>
    </PublicShell>
  );
}
