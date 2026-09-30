import { useState } from "react";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";
import {
  PublicError,
  PublicShell,
  pubButton,
  pubInput,
  pubLabel,
} from "../components/PublicShell";

export function Login() {
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function emailLogin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e2) {
      setErr(readable(e2));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setErr(null);
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setSent(true);
    } catch (e2) {
      // Hesabın var olup olmadığını sızdırma — kayıtlı olmayan adres de aynı
      // mesajı görsün. Yalnızca gerçek hatalar (biçim, ağ, limit) gösterilir.
      const code = (e2 as { code?: string })?.code ?? "";
      if (code.includes("user-not-found")) setSent(true);
      else setErr(readable(e2));
    } finally {
      setBusy(false);
    }
  }

  function backToSignIn() {
    setMode("signin");
    setSent(false);
    setErr(null);
  }

  if (mode === "reset") {
    return (
      <PublicShell
        title={sent ? "Check your inbox" : "Reset password"}
        subtitle={
          sent
            ? undefined
            : "Enter your work email and we will send you a reset link."
        }
      >
        {sent ? (
          <>
            <p className="text-[12.5px] leading-relaxed mb-4" style={{ color: "#c7c7cc" }}>
              If an account exists for <b className="text-white">{email.trim()}</b>, a password
              reset link is on its way. The link expires after a while — request a new one if it
              does.
            </p>
            <button onClick={backToSignIn} className={pubButton}>
              Back to sign in
            </button>
          </>
        ) : (
          <form onSubmit={resetPassword}>
            <label className={pubLabel}>Email</label>
            <input
              className={pubInput}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ad.soyad@bonair.com.tr"
              autoComplete="username"
              autoFocus
            />
            <div className="mt-4" />
            {err && <PublicError>{err}</PublicError>}
            <button type="submit" disabled={busy || !email.trim()} className={pubButton}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <button
              type="button"
              onClick={backToSignIn}
              className="w-full text-center text-[11px] font-semibold mt-3 text-white/45 hover:text-white/80"
            >
              ← Back to sign in
            </button>
          </form>
        )}
      </PublicShell>
    );
  }

  return (
    <PublicShell title="Sign in" subtitle="Compliance in aviation starts with training.">
      <form onSubmit={emailLogin}>
        <label className={pubLabel}>Email</label>
        <input
          className={pubInput}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ad.soyad@bonair.com.tr"
          autoComplete="username"
        />

        <div className="flex items-baseline justify-between mt-3.5">
          <label className={pubLabel}>Password</label>
          <button
            type="button"
            onClick={() => {
              setMode("reset");
              setErr(null);
            }}
            className="text-[10.5px] font-semibold text-brand-500 hover:text-brand-400 mb-1.5"
          >
            Forgot password?
          </button>
        </div>
        <input
          className={pubInput}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        <div className="mt-3.5" />
        {err && <PublicError>{err}</PublicError>}

        <button type="submit" disabled={busy} className={pubButton}>
          {busy ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </PublicShell>
  );
}

function readable(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code.includes("invalid-email")) return "That does not look like a valid email address.";
  if (code.includes("invalid-credential") || code.includes("wrong-password"))
    return "Incorrect email or password.";
  if (code.includes("user-not-found")) return "User not found.";
  if (code.includes("too-many-requests"))
    return "Too many attempts — wait a moment and try again.";
  if (code.includes("user-disabled")) return "This account is deactivated.";
  if (code.includes("network-request-failed")) return "No connection — check your network.";
  if (code.includes("operation-not-allowed"))
    return "This sign-in method is not enabled in Firebase yet.";
  return "Something went wrong. Please try again.";
}
