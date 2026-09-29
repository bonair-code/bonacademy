import { useState } from "react";
import { updatePassword } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { useAuth, profileIncomplete } from "../lib/auth";
import { ORG } from "../lib/org";

/**
 * İlk giriş akışı. İki adım: geçici şifreyi değiştir, eksik profil bilgilerini
 * tamamla. Tamamlanmadan uygulamaya girilemez — doğum bilgisi sertifikada
 * basıldığı için sonradan toplamak zor.
 */
export function Onboarding() {
  const { profile, signOut } = useAuth();
  const needPassword = profile?.mustChangePassword === true;
  const [step, setStep] = useState<"password" | "profile">(
    needPassword ? "password" : "profile"
  );

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [birthPlace, setBirthPlace] = useState(profile?.birthPlace ?? "");
  const [birthDate, setBirthDate] = useState(profile?.birthDate ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pwOk = pw1.length >= 6 && pw1 === pw2;

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pwOk || !auth.currentUser) return;
    setBusy(true);
    setErr(null);
    try {
      await updatePassword(auth.currentUser, pw1);
      await updateDoc(doc(db, "users", profile!.uid), {
        mustChangePassword: false,
        updatedAt: serverTimestamp(),
      });
      // Profil de eksikse ikinci adıma geç; değilse akış biter.
      if (profileIncomplete(profile)) setStep("profile");
    } catch (e2) {
      const code = (e2 as { code?: string })?.code ?? "";
      setErr(
        code.includes("requires-recent-login")
          ? "For security, sign in again and then set your password."
          : code.includes("weak-password")
          ? "Password is too weak — use at least 6 characters."
          : "Could not set the password. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!birthPlace.trim() || !birthDate || !profile) return;
    setBusy(true);
    setErr(null);
    try {
      await updateDoc(doc(db, "users", profile.uid), {
        birthPlace: birthPlace.trim(),
        birthDate,
        profileCompletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{ background: "linear-gradient(160deg,#8b1013 0%,#5c0a0d 100%)" }}
    >
      <div className="w-full max-w-[440px]">
        <div className="flex flex-col items-center mb-5">
          <div className="bg-white rounded-2xl px-8 py-5 shadow-lg">
            <img src="/Logo.png" alt="Bon Air" className="h-11 w-auto" />
          </div>
          <p className="text-white/60 text-[11px] tracking-[0.16em] uppercase mt-4">
            Welcome, {profile?.name}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-2xl overflow-hidden">
          <span
            className="block h-1"
            style={{ background: "linear-gradient(90deg,#e31e24,#e8630a 60%,transparent)" }}
          />

          {/* Adım göstergesi */}
          {needPassword && (
            <div className="flex items-center gap-2 px-7 pt-5">
              <Dot on label="1" />
              <span className="h-px flex-1 bg-slate-200" />
              <Dot on={step === "profile"} label="2" />
            </div>
          )}

          <div className="px-7 py-6">
            {step === "password" ? (
              <>
                <h2 className="text-lg font-extrabold text-slate-900">Set your password</h2>
                <p className="text-xs text-slate-500 mt-1 mb-5">
                  You signed in with a temporary password. Choose your own before continuing.
                </p>

                <form onSubmit={savePassword}>
                  <label className="label">New Password</label>
                  <input
                    className="input mb-3"
                    type="password"
                    value={pw1}
                    onChange={(e) => setPw1(e.target.value)}
                    autoComplete="new-password"
                    autoFocus
                  />
                  <label className="label">Repeat Password</label>
                  <input
                    className="input mb-2"
                    type="password"
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                    autoComplete="new-password"
                  />
                  <p className="text-[10px] text-slate-400 mb-4">
                    {pw1 && pw1.length < 6
                      ? "At least 6 characters."
                      : pw2 && pw1 !== pw2
                      ? "The two passwords do not match."
                      : "At least 6 characters."}
                  </p>

                  {err && <ErrorBox>{err}</ErrorBox>}
                  <button type="submit" disabled={busy || !pwOk} className="btn-primary w-full">
                    {busy ? "Saving…" : "Set Password"}
                  </button>
                </form>
              </>
            ) : (
              <>
                <h2 className="text-lg font-extrabold text-slate-900">Complete your details</h2>
                <p className="text-xs text-slate-500 mt-1 mb-5">
                  Your place and date of birth are printed on every training certificate we issue,
                  so we need them before you start.
                </p>

                <form onSubmit={saveProfile}>
                  <label className="label">Full Name</label>
                  <input className="input mb-3 bg-slate-50 text-slate-500" value={profile?.name ?? ""} disabled />

                  <label className="label">Place of Birth *</label>
                  <input
                    className="input mb-3"
                    value={birthPlace}
                    onChange={(e) => setBirthPlace(e.target.value)}
                    placeholder="İstanbul"
                    autoFocus
                  />
                  <label className="label">Date of Birth *</label>
                  <input
                    className="input mb-4"
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                  />

                  {err && <ErrorBox>{err}</ErrorBox>}
                  <button
                    type="submit"
                    disabled={busy || !birthPlace.trim() || !birthDate}
                    className="btn-primary w-full"
                  >
                    {busy ? "Saving…" : "Save & Continue"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>

        <button
          onClick={() => signOut()}
          className="w-full text-center text-white/50 hover:text-white/80 text-[11px] mt-5"
        >
          Sign out
        </button>
        <p className="text-center text-white/40 text-[11px] mt-2">{ORG.legalFooter}</p>
      </div>
    </div>
  );
}

function Dot({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
        on ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400"
      }`}
    >
      {label}
    </span>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-brand-700 mb-3 rounded-md bg-brand-50 border border-brand-100 px-2.5 py-2">
      {children}
    </p>
  );
}
