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
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";

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
  role: Role | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
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
          setProfile({
            uid: u.uid,
            email: u.email ?? data?.email ?? "",
            name: data?.name ?? u.displayName ?? u.email ?? "",
            role: claimRole ?? data?.role ?? "USER",
            departmentId: data?.departmentId ?? null,
            locale: data?.locale ?? "tr",
            mustChangePassword: data?.mustChangePassword === true,
            birthPlace: data?.birthPlace ?? null,
            birthDate: data?.birthDate ?? null,
            company: data?.company ?? null,
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

  const value: AuthState = {
    user,
    profile,
    role: profile?.role ?? null,
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
