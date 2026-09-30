import {
  signInWithCustomToken,
  setPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import { auth } from "./firebase";

/**
 * Uygulama Merkezi'nden (bonair-launcher) gelen tek kullanımlık bileti
 * oturuma çevirir.
 *
 * Akış: launcher, BonAir Technic şifresiyle giriş yapmış kullanıcı için bu
 * projenin `sso` ucundan bir bilet alır ve BonAcademy'yi  .../#sso=<bilet>
 * adresiyle açar. Burada bilet custom token'a, custom token da oturuma
 * dönüşür. Ayrıntılı gerekçe: functions/src/sso.js
 *
 * Bilet 90 saniye yaşar ve ilk kullanımda sunucuda silinir.
 */

// Fonksiyonlar europe-west3'te — diğer BonAir projeleri farklı bölgelerde,
// adresi elle yazarken bölgeyi karıştırmak kolay.
const SSO_ENDPOINT = "https://europe-west3-bonair-academy.cloudfunctions.net/sso";

/* Bilet MODÜL YÜKLENİRKEN okunur ve adresten hemen silinir.
 *
 * Neden burada: main.tsx uygulamayı monte etmeden önce "bilet var mı" diye
 * soruyor, sonra kullanıyor. Okuma ile kullanma arasında adres değişirse
 * (router ilk yönlendirmesini yapar) bilet kaybolurdu.
 *
 * Adresten silmenin sebebi: kullanılmış bilet zaten işe yaramaz, ama tarayıcı
 * geçmişinde ve kullanıcının paylaştığı ekran görüntüsünde durmasının hiçbir
 * faydası yok. */
const TICKET: string | null = (() => {
  try {
    const m = /(?:^|[#&])sso=([A-Za-z0-9_-]+)/.exec(window.location.hash || "");
    if (!m) return null;
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    return m[1];
  } catch {
    return null;
  }
})();

/** Adreste bilet geldi mi? (senkron — main.tsx ilk kararı buna göre verir) */
export function ssoBekliyor(): boolean {
  return TICKET !== null;
}

/**
 * Bileti oturuma çevirir.
 * @returns oturum açıldıysa true
 */
export async function consumeSsoTicket(): Promise<boolean> {
  if (!TICKET) return false;

  try {
    const res = await fetch(SSO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "redeem", ticket: TICKET }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Giriş devredilemedi.");

    // Launcher'dan gelen oturum SEKME ÖMÜRLÜ. Kullanıcı "beni hatırla"yı
    // BonAcademy'nin kendi giriş ekranında işaretlemedi; sessizce kalıcı
    // oturum açmak, ortak kullanılan bir bilgisayarda onun adına açık kapı
    // bırakır.
    await setPersistence(auth, browserSessionPersistence);
    await signInWithCustomToken(auth, data.token);
    return true;
  } catch (err) {
    // Başarısızlıkta normal giriş ekranına düşülür — launcher zaten hesap ve
    // yetki kontrolünü bilet ÜRETİRKEN yapıyor; buraya kadar gelip patlayan
    // tek gerçekçi durum biletin süresinin dolması.
    console.warn("[SSO] bilet kullanılamadı:", (err as Error)?.message);
    return false;
  }
}
