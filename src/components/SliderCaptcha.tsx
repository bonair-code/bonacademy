"use client";
import { useEffect, useState } from "react";

export function SliderCaptcha({ name = "captchaToken" }: { name?: string }) {
  const [state, setState] = useState<"loading" | "ok" | "err">("loading");
  const [token, setToken] = useState("");

  async function verify() {
    setState("loading");
    try {
      const r = await fetch("/api/captcha/issue", { method: "POST" });
      const d = await r.json();
      if (d.token) {
        setToken(d.token);
        setState("ok");
      } else setState("err");
    } catch {
      setState("err");
    }
  }

  useEffect(() => {
    const t = setTimeout(verify, 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={`flex items-center gap-3 border rounded-lg px-3 py-3 transition ${
        state === "ok"
          ? "bg-green-50 border-green-400"
          : state === "err"
          ? "bg-red-50 border-red-300 cursor-pointer"
          : "bg-slate-50 border-slate-300"
      }`}
      onClick={state === "err" ? verify : undefined}
    >
      <div
        className={`h-6 w-6 rounded flex items-center justify-center border ${
          state === "ok"
            ? "bg-green-600 border-green-600 text-white"
            : "bg-white border-slate-400"
        }`}
      >
        {state === "loading" && (
          <span className="h-3 w-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
        )}
        {state === "ok" && <span className="text-sm leading-none">✓</span>}
      </div>
      <span className="text-sm text-slate-700">
        {state === "ok"
          ? "Doğrulandı — siz bir insansınız"
          : state === "err"
          ? "Doğrulama başarısız — tekrar denemek için tıklayın"
          : "Doğrulanıyor…"}
      </span>
      <input type="hidden" name={name} value={token} />
    </div>
  );
}
