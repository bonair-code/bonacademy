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
import {
  PublicError,
  PublicShell,
  pubButton,
  pubInput,
  pubLabel,
} from "../components/PublicShell";

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

  const open = state === "ready" && session?.status === "OPEN";

  return (
    <PublicShell
      title={
        state === "loading"
          ? "Loading…"
          : state === "missing"
          ? "Session not found"
          : !open
          ? "Attendance closed"
          : done
          ? "You are signed in"
          : session?.courseTitle
      }
      subtitle={
        state === "missing"
          ? "Check the link or ask your instructor for a new one."
          : state === "ready" && !open
          ? `${session?.courseTitle} is not accepting sign-ins${
              session?.status === "CLOSED" ? " — the session has finished." : " yet."
            }`
          : open && !done
          ? [
              session?.instructorName,
              session?.startDate ? session.startDate.split("-").reverse().join(".") : null,
              session?.location,
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined
      }
    >
      {open && done && (
        <p className="text-[12.5px] leading-relaxed" style={{ color: "#c7c7cc" }}>
          <b className="text-white">{fullName}</b> is on the attendance list for{" "}
          {session?.courseTitle}. Your certificate is issued when the instructor closes the
          session.
        </p>
      )}

      {open && !done && (
        <form onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={pubLabel}>First Name *</label>
              <input
                className={`${pubInput} uppercase`}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="TALHA"
                autoFocus
              />
            </div>
            <div>
              <label className={pubLabel}>Surname *</label>
              <input
                className={`${pubInput} uppercase`}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="DUYGU"
              />
            </div>
          </div>

          <div className="mt-3.5">
            <label className={pubLabel}>Place of Birth</label>
            <input
              className={`${pubInput} uppercase`}
              value={birthPlace}
              onChange={(e) => setBirthPlace(e.target.value)}
              placeholder="İSTANBUL"
            />
          </div>

          <div className="mt-3.5">
            <label className={pubLabel}>Date of Birth</label>
            <input
              className={pubInput}
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
          </div>

          <p className="text-[10.5px] mt-2 mb-4" style={{ color: "#8e8e93" }}>
            Your place and date of birth are printed on the certificate.
          </p>

          {err && <PublicError>{err}</PublicError>}

          <button
            type="submit"
            disabled={busy || !firstName.trim() || !lastName.trim()}
            className={pubButton}
          >
            {busy ? "Signing in…" : "Sign In to Attendance"}
          </button>
        </form>
      )}
    </PublicShell>
  );
}