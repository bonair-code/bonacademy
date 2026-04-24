"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

// Görünmez Google reCAPTCHA v3. Mount'ta script yükler, token üretir ve
// gizli input'a yazar. Token ~2 dakika geçerli olduğu için 90 saniyede
// bir yeniler. Form gönderilirken de güncel bir token alır.
// Sağ alttaki Google rozeti zorunlu (Google ToS). Görsel UI yok.

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  }
}

const SCRIPT_ID = "recaptcha-v3-script";

export function RecaptchaV3({
  name = "captchaToken",
  action = "login",
}: {
  name?: string;
  action?: string;
}) {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const inputRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const t = useTranslations("ui.recaptcha");

  useEffect(() => {
    if (!siteKey) return;
    if (document.getElementById(SCRIPT_ID)) {
      if (window.grecaptcha) setReady(true);
      else
        document
          .getElementById(SCRIPT_ID)
          ?.addEventListener("load", () => setReady(true));
      return;
    }
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
    s.async = true;
    s.defer = true;
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, [siteKey]);

  // Token üret + periyodik yenile
  useEffect(() => {
    if (!ready || !siteKey) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        await new Promise<void>((res) => window.grecaptcha!.ready(res));
        const token = await window.grecaptcha!.execute(siteKey, { action });
        if (!cancelled && inputRef.current) inputRef.current.value = token;
      } catch {
        /* sessizce geç — sunucu tarafı doğrulama yine reddeder */
      }
    };
    refresh();
    const id = setInterval(refresh, 90_000);
    // Form submit olmadan hemen önce de tazele — eski token süresi geçmesin
    const onSubmit = () => {
      void refresh();
    };
    inputRef.current?.form?.addEventListener("submit", onSubmit, { capture: true });
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ready, siteKey, action]);

  if (!siteKey) {
    return (
      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
        {t("notConfigured")}
      </p>
    );
  }

  return (
    <>
      <input ref={inputRef} type="hidden" name={name} defaultValue="" />
      <p className="text-[11px] text-slate-400">
        {t("protectedBy")}{" "}
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-slate-600"
        >
          {t("privacy")}
        </a>{" "}
        {t("and")}{" "}
        <a
          href="https://policies.google.com/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-slate-600"
        >
          {t("terms")}
        </a>{" "}
        {t("apply")}
      </p>
    </>
  );
}
