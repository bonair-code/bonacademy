import { useSyncExternalStore } from "react";

/**
 * Giriş → uçuş → panel geçişinin ortak durumu.
 *
 * Sorun: signInWithEmailAndPassword başarılı olunca AuthProvider kullanıcıyı
 * hemen yayınlıyor, App de /login'i anında /dashboard'a çeviriyor — giriş
 * ekranı uçak uçamadan kayboluyordu. Çözüm: giriş denemesi süresince
 * `hold` açık; App bu sırada /login'i (ve onboarding kapısını) bekletir.
 *
 *   hold    — giriş ekranı açık kalsın (şifre doğrulanıyor ya da uçuş sürüyor)
 *   flying  — panel kaybolsun, uçak uçsun
 *   fading  — giriş ekranı kararsın (uçuşun son anı)
 *   landed  — panel ekranı yumuşak gelsin (Shell okuyup sıfırlar)
 */
type State = { hold: boolean; flying: boolean; fading: boolean; landed: boolean };

let state: State = { hold: false, flying: false, fading: false, landed: false };
const subs = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function useLoginFlight(): State {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state
  );
}

/** Uçağı uçuran sahne kendini buraya kaydeder; yoksa uçuş atlanır. */
type FlyHandler = (onFade: () => void) => Promise<void>;
let flyHandler: FlyHandler | null = null;
export function registerFlyHandler(fn: FlyHandler | null) {
  flyHandler = fn;
}

/** Giriş denemesi başlamadan çağrılır. */
export function holdLogin() {
  set({ hold: true, flying: false, fading: false });
}

/** Giriş başarısız: her şeyi bırak. */
export function releaseLogin() {
  set({ hold: false, flying: false, fading: false });
}

/**
 * Giriş başarılı: uçuşu oynat, bitince ekranı bırak. Sahne yoksa (WebGL
 * yok, hareket azaltma açık, model yüklenemedi) kısa bir kararma yeter.
 */
export async function flyAndRelease() {
  set({ flying: true });
  try {
    if (flyHandler) {
      await flyHandler(() => set({ fading: true }));
    } else {
      set({ fading: true });
      await new Promise((r) => setTimeout(r, 350));
    }
  } finally {
    set({ hold: false, flying: false, fading: false, landed: true });
  }
}

/** Panel ekranı geçiş animasyonunu bir kez oynattıktan sonra çağırır. */
export function clearLanded() {
  if (state.landed) set({ landed: false });
}
