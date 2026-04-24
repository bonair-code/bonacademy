"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

// Çerez bilgilendirme banner'ı. Kullanıcı "Kabul" veya "Reddet" seçtiğinde
// 1 yıllık bir cookie yazılır (bonacademy_cookie_consent) ve banner bir daha
// gösterilmez. İşlevsel olarak iki buton aynı: sistemin çalışması için zorunlu
// çerezler (oturum, dil, reCAPTCHA) zaten yüklenir. Banner yalnızca KVKK/GDPR
// bilgilendirme yükümlülüğünü karşılamak için gösterilir.

const COOKIE_NAME = "bonacademy_cookie_consent";
const ONE_YEAR = 60 * 60 * 24 * 365;

function readConsent(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + COOKIE_NAME + "=([^;]*)")
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function writeConsent(value: "accepted" | "rejected") {
  document.cookie =
    `${COOKIE_NAME}=${value}; path=/; max-age=${ONE_YEAR}; SameSite=Lax`;
}

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const t = useTranslations("cookie");

  useEffect(() => {
    // Hydration sonrası kontrol — SSR'da localStorage/document yok.
    if (!readConsent()) setVisible(true);
  }, []);

  if (!visible) return null;

  const decide = (v: "accepted" | "rejected") => {
    writeConsent(v);
    setVisible(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4">
      <div className="mx-auto max-w-3xl bg-white border border-slate-200 shadow-lg rounded-xl p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <div className="flex-1 text-xs sm:text-sm text-slate-700 leading-relaxed">
            <p>
              {t("message")}{" "}
              <a
                href="/kvkk"
                className="underline text-brand-700 hover:text-brand-800"
              >
                {t("learnMore")}
              </a>
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => decide("rejected")}
              className="px-3 py-1.5 text-xs sm:text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              {t("reject")}
            </button>
            <button
              type="button"
              onClick={() => decide("accepted")}
              className="px-3 py-1.5 text-xs sm:text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700"
            >
              {t("accept")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
