import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { doc, onSnapshot, type Timestamp } from "firebase/firestore";
import { auth, db } from "./firebase";
import { primaryRole, rolesOf, sortRoles } from "./roles";

/**
 * CUSTOMER: dışarıdan eğitim satın alan müşteri. Personel değil — yetki
 * kapsamı taşımaz, kurum uyum raporlarına girmez; yalnızca kendisine atanan
 * eğitime ve kendi sertifikalarına erişir.
 */
export type Role = "ADMIN" | "MANAGER" | "INSTRUCTOR" | "USER" | "CUSTOMER";

/** Personel mi? Müşteri kurum uyumuna ve Follow-Up matrisine dahil değil. */
export function isStaffRole(role?: string | null): boolean {
  return role !== "CUSTOMER";
}

export type Profile = {
  uid: string;
  email: string;
  name: string;
  role: Role;
  departmentId: string | null;
  locale: "tr" | "en";
  /** Admin geçici şifre verdiyse ilk girişte değiştirmek zorunlu. */
  mustChangePassword: boolean;
  birthPlace: string | null;
  birthDate: string | null;
  /** Müşteri hesaplarında bağlı olduğu kurum; personelde boş. */
  company: string | null;
  /**
   * Eğitmen yetkisi: öğretebileceği kursların kimlikleri ve yetkinin bitişi
   * (boşsa süresiz). Ekranlar bunu lib/instructors.ts → canTeach ile okuyor,
   * o yüzden profilin taşıması şart — eksik olsa yetkili eğitmen bile hiçbir
   * kurs göremezdi.
   */
  instructorFor: string[];
  instructorAuthExpiry: Timestamp | null;
  /**
   * Kişinin SAHİP OLDUĞU bütün roller — gerçek yetki budur. `role` ise
   * şu an seçili olan rol (bkz. AuthProvider). Tek rollü kişide ikisi
   * aynıdır.
   */
  roles: Role[];
};

/** Sertifikada basıldığı için bu alanlar eksikse profil tamamlanmamış sayılır. */
export function profileIncomplete(p: Profile | null): boolean {
  return !!p && (!p.birthPlace || !p.birthDate);
}
export function needsOnboarding(p: Profile | null): boolean {
  return !!p && (p.mustChangePassword || profileIncomplete(p));
}

type AuthState = {
  user: User | null;
  profile: Profile | null;
  /** AKTİF rol — ekranları daraltır. Gerçek yetki için `roles`. */
  role: Role | null;
  /** Sahip olunan bütün roller. */
  roles: Role[];
  /** Birden çok rolü olan kişi şapkasını değiştirir. */
  setActiveRole: (r: Role) => void;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

/**
 * Seçili rol tarayıcıda durur: kişiye özel bir kolaylık, yetkiyle ilgisi
 * yok. Okunamazsa (gizli pencere, kapalı depolama) sessizce birincil role
 * düşer — ekran yine açılır.
 */
const ACTIVE_KEY = "bonacademy.activeRole";
const readActive = (uid: string): Role | null => {
  try {
    const raw = localStorage.getItem(`${ACTIVE_KEY}.${uid}`);
    return raw ? (raw as Role) : null;
  } catch {
    return null;
  }
};
const writeActive = (uid: string, r: Role) => {
  try {
    localStorage.setItem(`${ACTIVE_KEY}.${uid}`, r);
  } catch {
    /* depolama kapalıysa seçim yalnızca bu oturumda yaşar */
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [active, setActive] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // users/{uid} dokümanının canlı dinleyicisi. Tek seferlik okuma yetmiyordu:
    // kullanıcı ilk giriş formunu doldurunca profil güncellenmediği için ekran
    // açılmıyordu. Canlı dinleme rol/departman değişikliklerini de anında yansıtır.
    let stopProfile: (() => void) | null = null;

    const stopAuth = onAuthStateChanged(auth, async (u) => {
      stopProfile?.();
      stopProfile = null;
      setUser(u);
      setActive(null);
      if (!u) {
        setProfile(null);
        setLoading(false);
        return;
      }
      // Rol, güvenlik açısından custom claim'den (token) okunur; profil
      // görünen ad/departman için users/{uid} dokümanından gelir.
      const tokenRes = await u.getIdTokenResult();
      const claimRole = tokenRes.claims.role as Role | undefined;

      stopProfile = onSnapshot(
        doc(db, "users", u.uid),
        (snap) => {
          const data = snap.data() as Partial<Profile> | undefined;
          // Yetki claim'den gelir; claim'de rol listesi yoksa (eski jeton)
          // kullanıcı dokümanına düşülür. İkisi de yoksa en azı: USER.
          const claimRoles = (tokenRes.claims.roles as Role[] | undefined) ?? null;
          const roles = sortRoles(
            claimRoles?.length ? claimRoles : rolesOf({ roles: data?.roles, role: claimRole ?? data?.role })
          );
          const all: Role[] = roles.length ? roles : ["USER"];
          setProfile({
            uid: u.uid,
            email: u.email ?? data?.email ?? "",
            name: data?.name ?? u.displayName ?? u.email ?? "",
            // Aktif rol: kişinin seçtiği, yoksa en yetkili olan. Seçim
            // artık sahip olmadığı bir role işaret ediyorsa yok sayılır.
            role: (() => {
              const chosen = readActive(u.uid);
              return chosen && all.includes(chosen) ? chosen : primaryRole(all);
            })(),
            roles: all,
            departmentId: data?.departmentId ?? null,
            locale: data?.locale ?? "tr",
            mustChangePassword: data?.mustChangePassword === true,
            birthPlace: data?.birthPlace ?? null,
            birthDate: data?.birthDate ?? null,
            company: data?.company ?? null,
            instructorFor: data?.instructorFor ?? [],
            instructorAuthExpiry: data?.instructorAuthExpiry ?? null,
          });
          setLoading(false);
        },
        () => setLoading(false)
      );
    });

    return () => {
      stopProfile?.();
      stopAuth();
    };
  }, []);

  const roles = profile?.roles ?? [];
  /** Seçim geçersizse (rol elinden alındıysa) profilin kendi rolü geçerli. */
  const role = active && roles.includes(active) ? active : profile?.role ?? null;

  const value: AuthState = {
    user,
    profile,
    role,
    roles,
    setActiveRole: (r: Role) => {
      if (!user || !roles.includes(r)) return;
      writeActive(user.uid, r);
      setActive(r);
    },
    loading,
    signOut: () => fbSignOut(auth),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
