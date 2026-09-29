import { useState } from "react";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";

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

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{ background: "linear-gradient(160deg,#8b1013 0%,#5c0a0d 100%)" }}
    >
      <div className="w-full max-w-[420px]">
        {/* Logo + kimlik */}
        <div className="flex flex-col items-center mb-6">
          <div className="bg-white rounded-2xl px-8 py-5 shadow-lg">
            <img src="/Logo.png" alt="Bon Air" className="h-12 w-auto" />
          </div>
          <h1 className="text-white text-2xl font-extrabold tracking-tight mt-5">BonAcademy</h1>
          <p className="text-white/60 text-[11px] tracking-[0.16em] uppercase mt-1">
            Training Management System
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-2xl overflow-hidden">
          <span
            className="block h-1"
            style={{ background: "linear-gradient(90deg,#e31e24,#e8630a 60%,transparent)" }}
          />
          <div className="px-8 py-7">
            {mode === "signin" ? (
              <>
                <h2 className="text-lg font-extrabold text-slate-900">Sign In</h2>
                <p className="text-xs text-slate-500 mt-1 mb-5">
                  Compliance in aviation starts with training.
                </p>

                <form onSubmit={emailLogin}>
                  <label className="label">Email</label>
                  <input
                    className="input mb-3"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ad.soyad@bonair.com.tr"
                    autoComplete="username"
                  />

                  <div className="flex items-center justify-between mb-1.5">
                    <label className="label !mb-0">Password</label>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("reset");
                        setErr(null);
                      }}
                      className="text-[11px] font-semibold text-brand-700 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <input
                    className="input mb-4"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />

                  {err && <ErrorBox>{err}</ErrorBox>}

                  <button type="submit" disabled={busy} className="btn-primary w-full">
                    {busy ? "Signing in…" : "Sign In"}
                  </button>
                </form>
              </>
            ) : sent ? (
              <>
                <h2 className="text-lg font-extrabold text-slate-900">Check your inbox</h2>
                <p className="text-xs text-slate-500 mt-1 mb-4">
                  If an account exists for <b className="text-slate-700">{email.trim()}</b>, a
                  password reset link is on its way. The link expires after a while — request a new
                  one if it does.
                </p>
                <button onClick={backToSignIn} className="btn-primary w-full">
                  Back to Sign In
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-extrabold text-slate-900">Reset Password</h2>
                <p className="text-xs text-slate-500 mt-1 mb-5">
                  Enter your work email and we will send you a reset link.
                </p>

                <form onSubmit={resetPassword}>
                  <label className="label">Email</label>
                  <input
                    className="input mb-4"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ad.soyad@bonair.com.tr"
                    autoComplete="username"
                    autoFocus
                  />

                  {err && <ErrorBox>{err}</ErrorBox>}

                  <button
                    type="submit"
                    disabled={busy || !email.trim()}
                    className="btn-primary w-full"
                  >
                    {busy ? "Sending…" : "Send Reset Link"}
                  </button>
                  <button
                    type="button"
                    onClick={backToSignIn}
                    className="w-full text-center text-[11px] font-semibold text-slate-500 hover:text-brand-700 mt-3"
                  >
                    ← Back to Sign In
                  </button>
                </form>
              </>
            )}
          </div>
        </div>

        <p className="text-center text-white/40 text-[11px] mt-5">
          BonAir Aviation · BonAir Academy
        </p>
      </div>
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-brand-700 mb-3 rounded-md bg-brand-50 border border-brand-100 px-2.5 py-2">
      {children}
    </p>
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
