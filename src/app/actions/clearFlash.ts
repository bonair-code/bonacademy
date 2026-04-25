"use server";

import { cookies } from "next/headers";

// Toaster client component'i mount sonrası bu action'ı çağırır; flash cookie'si
// sıfırlanır ki kullanıcı sayfayı yenilediğinde aynı toast tekrar görünmesin.
export async function clearFlash() {
  const store = await cookies();
  store.set("bonacademy_flash", "", { path: "/", maxAge: 0 });
}
