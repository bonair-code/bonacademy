import { addMonths, addYears } from "date-fns";
import type { Recurrence } from "@prisma/client";

/** Given the completion date and a recurrence, return the next due date. null = no repeat. */
export function nextDueDate(completedAt: Date, r: Recurrence, dueInDays = 30): Date | null {
  let base: Date;
  switch (r) {
    case "SIX_MONTHS":
      base = addMonths(completedAt, 6);
      break;
    case "ONE_YEAR":
      base = addYears(completedAt, 1);
      break;
    case "TWO_YEARS":
      base = addYears(completedAt, 2);
      break;
    case "NONE":
    default:
      return null;
  }
  // give `dueInDays` grace window after the cycle date
  const due = new Date(base);
  due.setDate(due.getDate() + dueInDays);
  return due;
}
