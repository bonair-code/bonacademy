"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText = "Kaydediliyor...",
  savedText = "Kaydedildi ✓",
  className = "btn-primary",
}: {
  children: React.ReactNode;
  pendingText?: string;
  savedText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const prevPending = useRef(false);
  const [justSaved, setJustSaved] = useState(false);

  // pending true→false geçişini yakala: aksiyon bitti, 2sn "Kaydedildi ✓" göster.
  useEffect(() => {
    if (prevPending.current && !pending) {
      setJustSaved(true);
      const t = setTimeout(() => setJustSaved(false), 2000);
      return () => clearTimeout(t);
    }
    prevPending.current = pending;
  }, [pending]);

  const label = pending ? pendingText : justSaved ? savedText : children;
  const cls = justSaved
    ? className.replace("btn-primary", "btn-primary") + " !bg-emerald-600"
    : className;

  return (
    <button type="submit" disabled={pending} className={cls}>
      {label}
    </button>
  );
}
