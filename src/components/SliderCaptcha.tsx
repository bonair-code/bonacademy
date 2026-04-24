"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Drag-to-verify slider. Kullanıcı topu sağ uca sürüklemeden token alınmaz.
// Bot için sıradan bir form auto-fill yetmez: pointer event akışı + sürükleme
// süresi gerekir. Tamamlandığında /api/captcha/issue çağrılır.
export function SliderCaptcha({ name = "captchaToken" }: { name?: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0); // knob offset px
  const [maxX, setMaxX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<"idle" | "verifying" | "ok" | "err">("idle");
  const [token, setToken] = useState("");
  const startTimeRef = useRef<number>(0);
  const startXRef = useRef<number>(0);
  const movedRef = useRef<boolean>(false);

  const KNOB = 40;

  const measure = useCallback(() => {
    const w = trackRef.current?.clientWidth ?? 0;
    setMaxX(Math.max(0, w - KNOB));
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  async function issueToken(durationMs: number) {
    setState("verifying");
    try {
      const r = await fetch("/api/captcha/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationMs }),
      });
      const d = await r.json();
      if (d?.token) {
        setToken(d.token);
        setState("ok");
      } else {
        setState("err");
      }
    } catch {
      setState("err");
    }
  }

  function reset() {
    setToken("");
    setX(0);
    setState("idle");
    movedRef.current = false;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (state === "ok" || state === "verifying") return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setDragging(true);
    startTimeRef.current = performance.now();
    startXRef.current = e.clientX - x;
    movedRef.current = false;
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const next = Math.max(0, Math.min(maxX, e.clientX - startXRef.current));
    if (next > 2) movedRef.current = true;
    setX(next);
  }

  function onPointerUp() {
    if (!dragging) return;
    setDragging(false);
    const duration = performance.now() - startTimeRef.current;
    // Bitire çok yakınsa snap, ve insan-benzeri minimum süre ara
    if (x >= maxX - 4 && movedRef.current && duration > 150) {
      setX(maxX);
      issueToken(Math.round(duration));
    } else {
      // tamamlanmadı — başa döndür
      setX(0);
      if (movedRef.current) setState("err");
    }
  }

  const pct = maxX > 0 ? Math.round((x / maxX) * 100) : 0;

  const trackBg =
    state === "ok"
      ? "bg-emerald-50 border-emerald-400"
      : state === "err"
      ? "bg-red-50 border-red-300"
      : "bg-slate-100 border-slate-300";

  const fillBg = state === "ok" ? "bg-emerald-400/40" : "bg-teal-400/40";

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        className={`relative h-10 rounded-lg border ${trackBg} overflow-hidden`}
      >
        {/* Fill */}
        <div
          className={`absolute inset-y-0 left-0 ${fillBg} transition-[width] ${
            dragging ? "" : "duration-150"
          }`}
          style={{ width: `${x + KNOB / 2}px` }}
        />
        {/* Hint text */}
        <div
          className="absolute inset-0 flex items-center justify-center text-xs text-slate-600 pointer-events-none"
          aria-hidden
        >
          {state === "ok"
            ? "Doğrulandı — siz bir insansınız"
            : state === "verifying"
            ? "Doğrulanıyor…"
            : state === "err"
            ? "Tekrar deneyin — topu sağa kadar sürükleyin"
            : "Doğrulamak için topu sağa sürükleyin →"}
        </div>
        {/* Knob */}
        <div
          role="slider"
          aria-label="Doğrulama kaydırıcısı"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          tabIndex={state === "ok" ? -1 : 0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={`absolute top-0 bottom-0 flex items-center justify-center rounded-md border shadow-sm cursor-grab active:cursor-grabbing ${
            state === "ok"
              ? "bg-emerald-500 border-emerald-500 text-white"
              : "bg-white border-slate-300 text-slate-600 hover:border-teal-500"
          }`}
          style={{ width: KNOB, transform: `translateX(${x}px)` }}
        >
          {state === "ok" ? (
            <span className="text-base leading-none">✓</span>
          ) : state === "verifying" ? (
            <span className="h-3 w-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <span className="text-base leading-none">›</span>
          )}
        </div>
      </div>
      {state === "err" && (
        <button
          type="button"
          onClick={reset}
          className="mt-1 text-[11px] text-brand-700 underline"
        >
          Sıfırla ve tekrar dene
        </button>
      )}
      <input type="hidden" name={name} value={token} />
    </div>
  );
}
