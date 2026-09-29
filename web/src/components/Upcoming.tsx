import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../lib/auth";

type Row = {
  id: string;
  userId: string;
  courseTitle: string;
  status: string;
  dueDate?: Timestamp | null;
};

const DAY = 86400000;
const isDone = (s: string) => s === "COMPLETED" || s === "EXAM_PASSED";

/**
 * Yaklaşan eğitimler — tamamlanmamış atamalar, vadesi en yakın olan üstte.
 * Kapsam role göre: çalışan kendini, müdür departmanını, eğitmen ve admin herkesi.
 */
export function Upcoming() {
  const { profile, role } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [err, setErr] = useState<string | null>(null);

  const scope: "self" | "team" | "all" =
    role === "ADMIN" || role === "INSTRUCTOR" ? "all" : role === "MANAGER" ? "team" : "self";

  useEffect(() => {
    if (!profile) return;
    setErr(null);
    const onErr = (e: { message: string }) => setErr(e.message);
    const base = collection(db, "assignments");

    // Kural dosyası kapsamsız sorguyu reddeder; her rol yalnızca okuyabildiğini sorar.
    let aq = query(base, where("userId", "==", profile.uid));
    if (scope === "all") aq = query(base);
    else if (scope === "team") {
      if (!profile.departmentId) {
        setRows([]);
        return;
      }
      aq = query(base, where("userDepartmentId", "==", profile.departmentId));
    }

    const u1 = onSnapshot(
      aq,
      (s) => setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Row, "id">) }))),
      onErr
    );

    let u2: () => void = () => {};
    if (scope !== "self") {
      const uq =
        scope === "all"
          ? query(collection(db, "users"))
          : query(collection(db, "users"), where("departmentId", "==", profile.departmentId));
      u2 = onSnapshot(
        uq,
        (s) => setNames(new Map(s.docs.map((d) => [d.id, (d.data() as any).name]))),
        onErr
      );
    }
    return () => {
      u1();
      u2();
    };
  }, [profile, scope]);

  const items = useMemo(() => {
    const now = Date.now();
    return rows
      .filter((r) => !isDone(r.status) && r.dueDate?.toMillis?.())
      .map((r) => ({
        ...r,
        due: r.dueDate!.toDate(),
        days: Math.round((r.dueDate!.toMillis() - now) / DAY),
      }))
      .sort((a, b) => a.days - b.days)
      .slice(0, 8);
  }, [rows]);

  const overdueCount = items.filter((i) => i.days < 0).length;

  return (
    <div className="card">
      <div className="px-5 py-3 flex items-center justify-between gap-3 border-b border-slate-100">
        <div>
          <div className="text-[13px] font-bold text-slate-900">Upcoming</div>
          <div className="text-[11px] text-slate-500">
            {scope === "self"
              ? "Your training deadlines"
              : scope === "team"
              ? "Deadlines in your department"
              : "Deadlines across all staff"}
          </div>
        </div>
        {overdueCount > 0 && (
          <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold ring-1 bg-red-50 text-red-700 ring-red-200">
            {overdueCount} overdue
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="p-8 text-center text-slate-400 text-sm">
          Nothing coming up — no open training with a deadline.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-slate-900 truncate">
                  {i.courseTitle}
                </div>
                <div className="text-[11px] text-slate-500">
                  {scope !== "self" && (
                    <>
                      {i.userId === profile?.uid ? "You" : names.get(i.userId) || "—"}
                      {" · "}
                    </>
                  )}
                  Due {i.due.toLocaleDateString("tr-TR")}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <DaysBadge days={i.days} />
                {i.userId === profile?.uid && (
                  <Link to={`/learn/${i.id}`} className="btn-secondary text-[11px] py-1 px-2.5">
                    Open
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="px-5 py-3 text-xs text-brand-700 border-t border-slate-100">{err}</p>}
    </div>
  );
}

function DaysBadge({ days }: { days: number }) {
  // Eşikler takip formuyla aynı: 30 ve 90 gün.
  const cls =
    days < 0
      ? "bg-red-100 text-red-800 ring-red-300"
      : days <= 30
      ? "bg-red-50 text-red-700 ring-red-200"
      : days <= 90
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : "bg-slate-100 text-slate-600 ring-slate-200";
  const label =
    days < 0 ? `${-days}d overdue` : days === 0 ? "due today" : `${days}d left`;
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ring-1 tabular-nums ${cls}`}>
      {label}
    </span>
  );
}
