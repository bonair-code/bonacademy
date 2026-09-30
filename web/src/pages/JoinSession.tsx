import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { ORG } from "../lib/org";

type Session = {
  courseTitle: string;
  status: "DRAFT" | "OPEN" | "CLOSED";
  startDate?: string | null;
  endDate?: string | null;
  location?: string | null;
  instructorName?: string | null;
};

/**
 * Katılım formu — giriş gerektirmez. Oturum id'si linkin içindedir ve parola
 * yerine geçer; kayıt yalnızca oturum AÇIKKEN kabul edilir (güvenlik kuralı).
 */
export function JoinSession() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  /**
   * Ad ve soyad AYRI alınır: tek kutuda "talha duygu" ile "Duygu Talha"
   * ayırt edilemiyor, personel eşleştirmesi de bu yüzden şaşıyordu.
   * Her ikisi de Türkçe kurallarıyla BÜYÜK harfe çevrilip saklanır
   * (i→İ); sertifikada da böyle basılıyor.
   */
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const fullName = [firstName, lastName]
    .map((x) => x.trim())
    .filter(Boolean)
    .join(" ")
    .toLocaleUpperCase("tr");
  const [birthPlace, setBirthPlace] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    getDoc(doc(db, "classSessions", sessionId))
      .then((s) => {
        if (s.exists()) {
          setSession(s.data() as Session);
          setState("ready");
        } else setState("missing");
      })
      .catch(() => setState("missing"));
  }, [sessionId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId || !firstName.trim() || !lastName.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await addDoc(collection(db, "classSessions", sessionId, "attendees"), {
        fullName,
        firstName: firstName.trim().toLocaleUpperCase("tr"),
        lastName: lastName.trim().toLocaleUpperCase("tr"),
        birthPlace: birthPlace.trim().toLocaleUpperCase("tr") || null,
        birthDate: birthDate || null,
        // Personel eşleşmesi SUNUCUDA, sınıf kapatılırken ada göre yapılır.
        // Bu form girişsiz açıldığı için buradan `users` okunamıyor; eskiden
        // e-postayla eşleştirme denenip sessizce boş kalıyordu.
        userId: null,
        signedAt: serverTimestamp(),
      });
      setDone(true);
    } catch (e2) {
      const m = (e2 as Error).message;
      setErr(
        /permission/i.test(m)
          ? "Attendance is closed for this session."
          : "Could not save. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{ background: "linear-gradient(160deg,#8b1013 0%,#5c0a0d 100%)" }}
    >
      <div className="w-full max-w-[420px]">
        <div className="flex flex-col items-center mb-5">
          <div className="bg-white rounded-2xl px-8 py-5 shadow-lg">
            <img src="/Logo.png" alt="Bon Air" className="h-11 w-auto" />
          </div>
          <p className="text-white/60 text-[11px] tracking-[0.16em] uppercase mt-4">
            Training Attendance
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-2xl overflow-hidden">
          <span
            className="block h-1"
            style={{ background: "linear-gradient(90deg,#e31e24,#e8630a 60%,transparent)" }}
          />
          <div className="px-7 py-6">
            {state === "loading" && <p className="text-sm text-slate-400">Loading…</p>}

            {state === "missing" && (
              <>
                <h2 className="text-lg font-extrabold text-slate-900">Session not found</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Check the link or ask your instructor for a new one.
                </p>
              </>
            )}

            {state === "ready" && session && session.status !== "OPEN" && (
              <>
                <h2 className="text-lg font-extrabold text-slate-900">Attendance closed</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {session.courseTitle} is not accepting sign-ins
                  {session.status === "CLOSED" ? " — the session has finished." : " yet."}
                </p>
              </>
            )}

            {state === "ready" && session?.status === "OPEN" && done && (
              <>
                <h2 className="text-lg font-extrabold text-emerald-700">You are signed in</h2>
                <p className="text-xs text-slate-500 mt-1">
                  <b className="text-slate-700">{fullName.trim()}</b> is on the attendance list for{" "}
                  {session.courseTitle}. Your certificate is issued when the instructor closes the
                  session.
                </p>
              </>
            )}

            {state === "ready" && session?.status === "OPEN" && !done && (
              <>
                <h2 className="text-lg font-extrabold text-slate-900">{session.courseTitle}</h2>
                <p className="text-xs text-slate-500 mt-1 mb-5">
                  {session.instructorName ? `${session.instructorName} · ` : ""}
                  {session.startDate ? session.startDate.split("-").reverse().join(".") : ""}
                  {session.location ? ` · ${session.location}` : ""}
                </p>

                <form onSubmit={submit}>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="label">First Name *</label>
                      <input
                        className="input uppercase"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="TALHA"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="label">Surname *</label>
                      <input
                        className="input uppercase"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="DUYGU"
                      />
                    </div>
                  </div>
                  <label className="label">Place of Birth</label>
                  <input
                    className="input mb-3 uppercase"
                    value={birthPlace}
                    onChange={(e) => setBirthPlace(e.target.value)}
                    placeholder="İSTANBUL"
                  />
                  <label className="label">Date of Birth</label>
                  <input
                    className="input mb-3"
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                  />
                  <p className="text-[10px] text-slate-400 mb-4">
                    Your place and date of birth are printed on the certificate.
                  </p>

                  {err && (
                    <p className="text-xs text-brand-700 mb-3 rounded-md bg-brand-50 border border-brand-100 px-2.5 py-2">
                      {err}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={busy || !firstName.trim() || !lastName.trim()}
                    className="btn-primary w-full"
                  >
                    {busy ? "Signing in…" : "Sign In to Attendance"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>

        <p className="text-center text-white/40 text-[11px] mt-5">{ORG.legalFooter}</p>
      </div>
    </div>
  );
}
