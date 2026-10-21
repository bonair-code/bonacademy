import { useEffect, useState } from "react";
import { MAIL_ENABLED } from "../lib/features";
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
import { placeCase } from "../lib/text";

type Session = {
  courseTitle: string;
  status: "DRAFT" | "OPEN" | "ATTENDANCE_CLOSED" | "CLOSING" | "CLOSED";
  startDate?: string | null;
  endDate?: string | null;
  location?: string | null;
  instructorName?: string | null;
};

/**
 * Katılım formu — giriş gerektirmez. Oturum id'si linkin içindedir ve parola
 * yerine geçer; kayıt yalnızca oturum AÇIKKEN kabul edilir (güvenlik kuralı).
 */
/** Yazılırken "10092001" → "10.09.2001". */
function maskDmy(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join(".");
}
/** "10.09.2001" → "2001-09-10"; geçersiz ya da eksikse "". */
function isoFromDmy(v: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v);
  if (!m) return "";
  const [dd, mm, yyyy] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
  const ok =
    dt.getUTCFullYear() === yyyy && dt.getUTCMonth() === mm - 1 && dt.getUTCDate() === dd &&
    yyyy >= 1900 && dt.getTime() <= Date.now();
  return ok ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

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
  /** Elle yazılır: GG.AA.YYYY (telefonda tarih seçici çok zahmetliydi). */
  const [birthText, setBirthText] = useState("");
  const birthDate = isoFromDmy(birthText);
  const birthInvalid = birthText.length > 0 && !birthDate;
  /** Sertifika PDF'i bu adrese gönderilir. */
  const [email, setEmail] = useState("");
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
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
    if (!sessionId || !firstName.trim() || !lastName.trim() || !emailOk || birthInvalid) return;
    setBusy(true);
    setErr(null);
    try {
      await addDoc(collection(db, "classSessions", sessionId, "attendees"), {
        fullName,
        firstName: firstName.trim().toLocaleUpperCase("tr"),
        lastName: lastName.trim().toLocaleUpperCase("tr"),
        birthPlace: placeCase(birthPlace) || null,
        birthDate: birthDate || null,
        email: email.trim().toLowerCase(),
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
              session?.status === "CLOSED" || session?.status === "CLOSING"
                ? " — the session has finished."
                : session?.status === "ATTENDANCE_CLOSED"
                ? " — attendance is closed."
                : " yet."
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
        <p className="text-[13px] leading-relaxed text-slate-600">
          <b className="text-slate-900">{fullName}</b> is on the attendance list for{" "}
          {session?.courseTitle}. Your certificate is issued when the instructor closes the
          session.
        </p>
      )}

      {open && !done && (
        <form onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={pubLabel}>First Name *</label>
              {/* Örnek ad yazılmaz ve tarayıcı önerileri kapalı: ortak bir
                  telefonda/tablette önceki kişinin adı önerilmesin. */}
              <input
                className={`${pubInput} uppercase`}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                name="att-first"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
            </div>
            <div>
              <label className={pubLabel}>Surname *</label>
              <input
                className={`${pubInput} uppercase`}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                name="att-last"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="mt-3.5">
            <label className={pubLabel}>Place of Birth</label>
            <input
              className={`${pubInput} uppercase`}
              value={birthPlace}
              onBlur={() => setBirthPlace(placeCase(birthPlace))}
              onChange={(e) => setBirthPlace(e.target.value)}
              name="att-place"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          <div className="mt-3.5">
            <label className={pubLabel}>Date of Birth</label>
            {/* Elle yazılır; noktalar kendiliğinden gelir. Tarih seçici telefonda
                hem zahmetliydi hem de kutudan taşıyordu. */}
            <input
              className={pubInput}
              value={birthText}
              onChange={(e) => setBirthText(maskDmy(e.target.value))}
              inputMode="numeric"
              placeholder="DD.MM.YYYY"
              maxLength={10}
              name="att-birth"
              autoComplete="off"
            />
            {birthInvalid && birthText.length === 10 && (
              <p className="text-[12px] text-amber-200 mt-1.5">Please check the date (DD.MM.YYYY).</p>
            )}
          </div>

          <div className="mt-3.5">
            <label className={pubLabel}>Email *</label>
            <input
              className={pubInput}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputMode="email"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              name="att-email"
              autoComplete="off"
            />
          </div>

          {/* E-posta alanı kalıyor: sertifikanın sahibini tanımlıyor ve posta
              açıldığında gönderim adresi bu. Yalnız vaat edilen şey değişiyor. */}
          <p className="text-[11.5px] mt-2 mb-4 text-slate-500">
            Your place and date of birth are printed on the certificate.
            {MAIL_ENABLED
              ? " It is emailed to you as a PDF when the training is complete."
              : " Your instructor hands it to you when the training is complete."}
          </p>

          {err && <PublicError>{err}</PublicError>}

          <button
            type="submit"
            disabled={busy || !firstName.trim() || !lastName.trim() || !emailOk || birthInvalid}
            className={pubButton}
          >
            {busy ? "Signing in…" : "Sign In to Attendance"}
          </button>
        </form>
      )}
    </PublicShell>
  );
}