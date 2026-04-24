"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";

export function SubmitButton({
  children,
  pendingText,
  savedText,
  className = "btn-primary",
}: {
  children: React.ReactNode;
  pendingText?: string;
  savedText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const tr = useTranslations("ui.submit");
  const effectivePending = pendingText ?? tr("pending");
  const effectiveSaved = savedText ?? tr("saved");
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

  const label = pending ? effectivePending : justSaved ? effectiveSaved : children;
  const cls = justSaved
    ? className.replace("btn-primary", "btn-primary") + " !bg-emerald-600"
    : className;

  return (
    <button type="submit" disabled={pending} className={cls}>
      {label}
    </button>
  );
}
