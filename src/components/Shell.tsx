import Link from "next/link";
import { signOut } from "@/lib/auth";
import type { Role } from "@prisma/client";

type IconTone = "teal" | "violet" | "amber" | "red" | "green" | "sky" | "slate";

type NavItem = {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  iconTone: IconTone;
  count?: number;
  tone?: "teal" | "muted";
};

const ICON_TONE_CLASSES: Record<IconTone, string> = {
  teal: "bg-teal-100 text-teal-600",
  violet: "bg-violet-100 text-violet-600",
  amber: "bg-amber-100 text-amber-600",
  red: "bg-red-100 text-red-600",
  green: "bg-emerald-100 text-emerald-600",
  sky: "bg-sky-100 text-sky-600",
  slate: "bg-slate-100 text-slate-600",
};

const ICONS = {
  dashboard:
    "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 9h8V3h-8z",
  calendar:
    "M8 2v4M16 2v4M3 10h18M5 6h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
  clipboard:
    "M9 4h6a1 1 0 0 1 1 1v2H8V5a1 1 0 0 1 1-1zM6 7h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z",
  alert:
    "M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
  checklist:
    "M9 11l2 2 4-4M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  users:
    "M17 20h5v-2a4 4 0 0 0-3-3.87M9 20H2v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2zM13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  building:
    "M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M4 21h12M4 21H2m14 0h6V11a2 2 0 0 0-2-2h-4M8 7h2M8 11h2M8 15h2",
  book:
    "M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4zM4 4v12",
  report:
    "M3 3v18h18M7 14l4-4 4 4 6-6",
  cert:
    "M9 12l2 2 4-4M5 4h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-4l-3 4-3-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
  cog:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  logout:
    "M15 17l5-5-5-5M20 12H9M12 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h7",
} as const;

function Icon({ d, className = "h-5 w-5 shrink-0" }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}

export function Shell({
  user,
  children,
  title,
  subtitle,
}: {
  user: { name?: string | null; role: Role };
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}) {
  const main: NavItem[] = [
    { href: "/dashboard", label: "Gösterge Paneli", icon: "dashboard", iconTone: "teal" },
    { href: "/certificates", label: "Sertifikalarım", icon: "cert", iconTone: "green" },
  ];
  if (user.role === "MANAGER" || user.role === "ADMIN") {
    main.push({ href: "/manager/team", label: "Ekibim", icon: "users", iconTone: "green" });
  }
  // MANAGER için salt okunur Kurslar sekmesi — /courses Excel dışa aktarımını
  // da sağlar. ADMIN'in "Kurslar" sekmesi /admin/courses'a gittiği için burada
  // tekrar eklemiyoruz.
  if (user.role === "MANAGER") {
    main.push({ href: "/courses", label: "Kurslar", icon: "book", iconTone: "amber" });
  }
  if (user.role === "ADMIN") {
    main.push(
      { href: "/admin/plans", label: "Eğitim Planları", icon: "calendar", iconTone: "violet" },
      { href: "/admin/courses", label: "Kurslar", icon: "book", iconTone: "amber" }
    );
  }

  const org: NavItem[] = [];
  if (user.role === "ADMIN") {
    org.push(
      { href: "/admin/users", label: "Kullanıcılar", icon: "users", iconTone: "sky" },
      { href: "/admin/reports", label: "Raporlar", icon: "report", iconTone: "red" },
      { href: "/admin/audit", label: "Denetim Kayıtları", icon: "report", iconTone: "slate" },
      { href: "/admin/settings", label: "Ayarlar", icon: "cog", iconTone: "slate" }
    );
  }

  const roleLabel =
    user.role === "ADMIN"
      ? "Admin"
      : user.role === "MANAGER"
      ? "Yönetici"
      : "Kullanıcı";

  const initials = (user.name || "")
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const renderItem = (it: NavItem) => (
    <Link key={it.href} href={it.href} className="nav-item group">
      <span
        className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${ICON_TONE_CLASSES[it.iconTone]}`}
      >
        <Icon d={ICONS[it.icon]} className="h-[18px] w-[18px]" />
      </span>
      <span className="font-medium">{it.label}</span>
      {typeof it.count === "number" && (
        <span className={it.tone === "muted" ? "nav-count-muted" : "nav-count"}>
          {it.count}
        </span>
      )}
    </Link>
  );

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col">
        {/* Logo card */}
        <div className="px-5 pt-5 pb-4">
          <div className="border border-slate-200 rounded-xl px-4 py-4 flex flex-col items-center shadow-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/Logo.png" alt="Bon Air" className="h-9 w-auto mb-2" />
            <p className="text-[10px] text-slate-400 tracking-[0.14em] uppercase text-center leading-tight">
              BonAcademy
              <br />
              Eğitim Yönetim Sistemi
            </p>
          </div>
        </div>

        <nav className="flex-1 px-3 pb-3 overflow-y-auto">
          <div className="nav-section">Ana Modüller</div>
          <div className="space-y-1">{main.map(renderItem)}</div>
          {org.length > 0 && (
            <>
              <div className="nav-section">Kurulum</div>
              <div className="space-y-1">{org.map(renderItem)}</div>
            </>
          )}
        </nav>

        <div className="p-3 border-t border-slate-200">
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="w-full flex items-center justify-center gap-2 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg px-3 py-2.5 text-sm font-medium transition">
              <Icon d={ICONS.logout} className="h-4 w-4" />
              Çıkış
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        {/* Top bar */}
        <div className="bg-slate-50 px-8 pt-8 pb-2 flex items-start justify-between gap-6">
          <div>
            {title && (
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                {title}
              </h1>
            )}
            {subtitle && (
              <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-full pl-1.5 pr-4 py-1.5">
              <div className="h-8 w-8 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-semibold">
                {initials || "?"}
              </div>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-slate-900">
                  {user.name || "Kullanıcı"}
                </div>
                <div className="text-[11px] text-slate-500">{roleLabel}</div>
              </div>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                className="h-10 w-10 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 flex items-center justify-center transition"
                title="Çıkış"
              >
                <Icon d={ICONS.logout} className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>

        <div className="px-8 pb-10 pt-4">{children}</div>
      </main>
    </div>
  );
}
