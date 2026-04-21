"use client";

import { useState } from "react";

type Props = {
  name: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  defaultValue?: string;
  className?: string;
};

export function PasswordField({
  name,
  placeholder = "••••••••",
  required = false,
  autoComplete = "current-password",
  defaultValue,
  className = "input mt-1",
}: Props) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        name={name}
        type={show ? "text" : "password"}
        required={required}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={className + " pr-20"}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 hover:text-teal-700 px-2 py-1 rounded"
        tabIndex={-1}
      >
        {show ? "Gizle" : "Göster"}
      </button>
    </div>
  );
}
