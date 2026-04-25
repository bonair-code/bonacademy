import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

// "Flash" bildirim altyapısı — server action son işine yakın setFlash çağırır,
// Next.js sonraki istekte (revalidate sonrası) cookie'yi okur ve Toaster
// component'i sağ alt köşede gösterir. Cookie tek kullanımlık: okunduğu anda
// silinir, yenilemede aynı toast tekrar görünmez.
//
// İçerik küçük (kısa metin + tip) — bütün flash mesajları sunucu tarafında
// i18n çevirisi ile üretilir, böylece kullanıcı diline saygılı olur.

const FLASH_COOKIE = "bonacademy_flash";

export type FlashKind = "success" | "error" | "info";

export type FlashPayload = {
  id: string;
  message: string;
  kind: FlashKind;
};

export async function setFlash(message: string, kind: FlashKind = "success") {
  const store = await cookies();
  // Her toast'a benzersiz id ver — client'taki Toaster bunu key olarak kullanır,
  // aynı içerikli iki ardışık toast bile farklı id ile yeniden tetiklenir.
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  store.set(FLASH_COOKIE, JSON.stringify({ id, message, kind }), {
    path: "/",
    // 10 saniye yeter — bir sonraki render'da okuyup silineceğiz; uzun TTL'in
    // yarısı bile gerekmez. Kullanıcı sekmeyi kapatırsa toast da kaybolur.
    maxAge: 10,
    httpOnly: false,
    sameSite: "lax",
  });
}

/**
 * Sadece okur — silmez. Server component (layout) bunu çağırır; cookie
 * mutasyonu Next.js 15'te server component'ten yasak. Silme işini Toaster
 * client component'i mount sonrası `clearFlash` server action'ı ile yapar.
 * Cookie zaten 10 saniye TTL'li olduğu için unutulsa bile hızla kaybolur.
 */
export async function readFlash(): Promise<FlashPayload | null> {
  const store = await cookies();
  const raw = store.get(FLASH_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FlashPayload>;
    if (typeof parsed.message !== "string") return null;
    const kind: FlashKind =
      parsed.kind === "error" || parsed.kind === "info" ? parsed.kind : "success";
    const id = typeof parsed.id === "string" ? parsed.id : Math.random().toString(36).slice(2);
    return { id, message: parsed.message, kind };
  } catch {
    return null;
  }
}

/**
 * Server action içinde tek satırda lokalize toast yazmak için kısayol.
 * `await flashToast("saved")` → "Başarıyla kaydedildi." (TR) / "Saved successfully." (EN).
 */
export type ToastKey =
  | "saved"
  | "added"
  | "deleted"
  | "updated"
  | "sent"
  | "uploaded"
  | "error";

export async function flashToast(key: ToastKey) {
  const t = await getTranslations("toast");
  await setFlash(t(key), key === "error" ? "error" : "success");
}

/**
 * Server action sarmalayıcısı: action'ı çalıştırır, başarıda success flash'ı,
 * exception'da error flash'ı yazar. NEXT_REDIRECT digest'i bypass edilir
 * (redirect throw eden action'lar için).
 */
export async function withFlash<T>(
  fn: () => Promise<T>,
  successMessage: string,
  errorMessage?: string
): Promise<T> {
  try {
    const result = await fn();
    await setFlash(successMessage, "success");
    return result;
  } catch (e) {
    if (
      typeof e === "object" &&
      e &&
      "digest" in e &&
      typeof (e as { digest?: string }).digest === "string" &&
      (e as { digest: string }).digest.startsWith("NEXT_")
    ) {
      // Redirect/notFound — başarılı action, success flash zaten yazıldı.
      throw e;
    }
    if (errorMessage) await setFlash(errorMessage, "error");
    throw e;
  }
}
