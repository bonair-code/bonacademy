"use client";

import { type ReactNode } from "react";

type Props = {
  message: string;
  className?: string;
  children: ReactNode;
};

/**
 * Submit button that shows a native confirm() dialog before allowing its
 * parent form to submit. Intended for destructive server actions like
 * deleting courses or plans.
 */
export function ConfirmButton({ message, className, children }: Props) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
