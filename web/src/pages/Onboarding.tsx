import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../lib/firebase";
import { useAuth, profileIncomplete } from "../lib/auth";
import { ORG } from "../lib/org";
import { placeCase } from "../lib/text";

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
  // Ad-soyadı yönetici yazıyor, bazen yanlış: kişi burada düzeltir, onun
  // yazdığı esas alınır (yalnızca bu ilk adımda — sonrası yöneticide).
  const [name, setName] = useState(profile?.name ?? "");
  const [birthPlace, setBirthPlace] = useState(profile?.birthPlace ?? "");
  const [birthDate, setBirthDate] = useState(profile?.birthDate ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pwOk = pw1.length >= 8 && pw1 === pw2;

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pwOk || !auth.currentUser) return;
    setBusy(true);
    setErr(null);
    try {
      // Şifre ve "değiştirmeli" işareti SUNUCUDA birlikte değişir — işaret
      // istemciden kapatılamaz (geçici şifre kalıcı yapılamasın).
      const r = await httpsCallable(functions, "changeTempPassword")({ password: pw1 });
      // Şifre sunucuda değişince oturum yenilenir: yeni şifreyle tekrar gir.
      const email = (r.data as { email?: string }).email || auth.currentUser.email || "";
      await signInWithEmailAndPassword(auth, email, pw1).catch(() => undefined);
      // Profil de eksikse ikinci adıma geç; değilse akış biter.
      if (profileIncomplete(profile)) setStep("profile");
    } catch (e2) {
      setErr((e2 as Error).message.replace(/^.*?:\s*/, "") || "Could not set the password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !birthPlace.trim() || !birthDate || !profile) return;
    setBusy(true);
    setErr(null);
    try {
      // Sunucuda: kişi kendi adını kurala göre yazamıyor; ad yalnızca ilk
      // girişte değişebilir ve varsa sertifikalara da işlenir.
      await httpsCallable(functions, "completeProfile")({
        name: name.replace(/\s+/g, " ").trim(),
        birthPlace: placeCase(birthPlace),
        birthDate,
      });
    } catch (e2) {
      setErr((e2 as Error).message.replace(/^.*?:\s*/, ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{ background: "linear-gradient(160deg,var(--sidebar-top) 0%,var(--sidebar-bot) 100%)" }}
    >
      <div className="w-full max-w-[440px]">
        <div className="flex flex-col items-center mb-5">
          <div className="bg-white rounded-2xl px-8 py-5 shadow-lg">
            <img src="/Logo.png" alt="BonAir Aviation" className="h-12 w-auto" />
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
                    {pw1 && pw1.length < 8
                      ? "At least 8 characters."
                      : pw2 && pw1 !== pw2
                      ? "The two passwords do not match."
                      : "At least 8 characters."}
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
                  Your name, place and date of birth are printed on every training certificate we
                  issue. Please check them carefully before you start.
                </p>

                <form onSubmit={saveProfile}>
                  <label className="label">Full Name</label>
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    autoFocus
                  />
                  <p className="text-[11px] text-slate-400 mt-1 mb-3">
                    Exactly as it should appear on your certificates.
                  </p>

                  <label className="label">Place of Birth *</label>
                  <input
                    className="input mb-3"
                    value={birthPlace}
                    onBlur={() => setBirthPlace(placeCase(birthPlace))}
                    onChange={(e) => setBirthPlace(e.target.value)}
                    placeholder="İstanbul"
                  />
                  <label className="label">Date of Birth *</label>
                  {/* iPhone'da tarih kutusu boşken hiçbir şey yazmıyor ve kendi
                      genişliğini dayatıp karttan taşıyordu: görünüm sıfırlanır,
                      boşken "Select a date" yazısı üstüne bindirilir. */}
                  <div className="relative mb-4">
                    <input
                      className="input block w-full min-w-0 min-h-[44px] text-left"
                      style={{ WebkitAppearance: "none", appearance: "none" }}
                      type="date"
                      value={birthDate}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setBirthDate(e.target.value)}
                    />
                    {!birthDate && IOS && (
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-slate-400">
                        Select a date
                      </span>
                    )}
                  </div>

                  {err && <ErrorBox>{err}</ErrorBox>}
                  <button
                    type="submit"
                    disabled={busy || !name.trim() || !birthPlace.trim() || !birthDate}
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

/** iPhone/iPad Safari: boş tarih kutusu hiçbir şey göstermiyor. */
const IOS = typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent);

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
    <p className="text-xs text-red-700 mb-3 rounded-md bg-red-50 border border-red-100 px-2.5 py-2">
      {children}
    </p>
  );
}
