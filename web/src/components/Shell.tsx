import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth, type Role } from "../lib/auth";
import { PageHeadProvider, usePageHead } from "./PageHead";
import { ReportFootnote, ReportLetterhead } from "./ReportSheet";

/**
 * Menü ikonları. Tek çizgi kalınlığı (1.8) ve aynı 24'lük kutu — SF Symbols
 * gibi hepsi aynı optik ağırlıkta dursun diye. Dolgu yok; renk aktif duruma
 * göre CSS'ten gelir.
 */
const Icon = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  certificate: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="9" r="5" />
      <path d="M8.5 13.5 7 21l5-2.5L17 21l-1.5-7.5" />
    </svg>
  ),
  matrix: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 5h18M3 12h18M3 19h18" />
      <circle cx="7" cy="5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="14" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="10" cy="19" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  register: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  ),
  course: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5" />
    </svg>
  ),
  classes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9.5" r="2.3" />
      <path d="M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5" />
      <path d="M16 14.2c2.7.2 5 1.8 5 4.8" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" />
    </svg>
  ),
};

/** Menü grubu — düz liste yerine işe göre kümelenmiş başlıklar. */
type NavGroup = "General" | "Tracking" | "Training" | "Management";
type NavItem = { to: string; label: string; roles: Role[]; group: NavGroup; icon: ReactNode };
const GROUP_ORDER: NavGroup[] = ["General", "Tracking", "Training", "Management"];

const ALL: Role[] = ["ADMIN", "MANAGER", "INSTRUCTOR", "USER", "CUSTOMER"];

/**
 * Müşteri yalnızca kendi eğitimini ve sertifikasını görür. Menüde başka
 * hiçbir şey yok; sayfalar da kendi içinde rol kontrolü yapıyor, adresi elle
 * yazsa da içerik açılmaz.
 */
const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", roles: ALL, group: "General", icon: Icon.dashboard },
  {
    to: "/certificates",
    label: "My Certificates",
    roles: ALL,
    group: "General",
    icon: Icon.certificate,
  },
  {
    to: "/follow-up",
    label: "Training Follow-Up",
    roles: ["ADMIN", "MANAGER", "INSTRUCTOR"],
    group: "Tracking",
    icon: Icon.matrix,
  },
  {
    to: "/register",
    label: "Certificate Register",
    roles: ["ADMIN", "INSTRUCTOR"],
    group: "Tracking",
    icon: Icon.register,
  },
  {
    to: "/courses",
    label: "Courses",
    roles: ["ADMIN", "INSTRUCTOR"],
    group: "Training",
    icon: Icon.course,
  },
  {
    to: "/sessions",
    label: "Classes",
    roles: ["ADMIN", "INSTRUCTOR"],
    group: "Training",
    icon: Icon.classes,
  },
  {
    to: "/users",
    label: "Users",
    roles: ["ADMIN", "MANAGER"],
    group: "Management",
    icon: Icon.users,
  },
  {
    to: "/settings",
    label: "Settings",
    roles: ["ADMIN"],
    group: "Management",
    icon: Icon.settings,
  },
];

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  INSTRUCTOR: "Instructor",
  USER: "Employee",
  CUSTOMER: "Customer",
};

export function Shell({ children }: { children: ReactNode }) {
  return (
    <PageHeadProvider>
      <ShellLayout>{children}</ShellLayout>
    </PageHeadProvider>
  );
}

function ShellLayout({ children }: { children: ReactNode }) {
  const { profile, role, signOut } = useAuth();
  const head = usePageHead();
  const r = role ?? "USER";
  const items = NAV.filter((n) => n.roles.includes(r));
  const initials = (profile?.name || "")
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen flex bg-[#f4f6f9]">
      {/* Uzun listelerde menü yukarıda kalmasın — ekranda sabit durur, yalnızca
          içerik kayar. Menünün kendisi taşarsa kendi içinde kayar. */}
      {/* Nötr grafit zemin. Marka kırmızısı menünün tamamını kaplamak yerine
          yalnızca aktif maddeyi işaretliyor; böylece tablolardaki kırmızı
          uyarılarla yarışmıyor. */}
      <aside
        className="w-[212px] shrink-0 flex flex-col sticky top-0 h-screen"
        style={{ background: "#1c1c1e", borderRight: "1px solid rgba(255,255,255,.07)" }}
      >
        <div className="px-3 pt-4 pb-2">
          {/* Logo koyu metinli, o yüzden beyaz zemine oturuyor — ama artık
              koca bir kart değil, ince bir künye. */}
          <div className="bg-white rounded-[10px] px-3 py-2 flex items-center justify-center">
            <img src="/Logo.png" alt="Bon Air" className="h-6 w-auto" />
          </div>
          <p
            className="mt-2 text-center text-[9.5px] uppercase leading-tight"
            style={{ color: "#98989d", letterSpacing: "0.12em" }}
          >
            Training Management System
          </p>
        </div>

        <nav className="flex-1 pb-3 overflow-y-auto">
          {GROUP_ORDER.map((g) => {
            const inGroup = items.filter((n) => n.group === g);
            if (inGroup.length === 0) return null;
            return (
              <div key={g}>
                <div className="nav-section">{g}</div>
                {inGroup.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
                  >
                    {it.icon}
                    {it.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        {/* Kimlik bloğu buraya taşındı — üst barda ikinci kez göstermek
            gereksizdi. Çıkış da kimliğin yanında duruyor. */}
        <div className="px-2 py-2" style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
          <div className="flex items-center gap-[9px] px-2 py-1.5 rounded-[10px]">
            <div
              className="h-[26px] w-[26px] rounded-full grid place-items-center text-[10.5px] font-bold shrink-0"
              style={{ background: "rgba(227,30,36,.22)", color: "#ff6b6f" }}
            >
              {initials || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold text-white leading-tight truncate">
                {profile?.name || "User"}
              </div>
              <div className="text-[10.5px] leading-tight truncate" style={{ color: "#98989d" }}>
                {ROLE_LABEL[r]}
              </div>
            </div>
            <button
              onClick={() => signOut()}
              title="Sign out"
              aria-label="Sign out"
              className="shrink-0 h-7 w-7 grid place-items-center rounded-lg text-white/55 hover:text-white hover:bg-white/10 transition"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="h-4 w-4"
              >
                <path d="M15 17l5-5-5-5M20 12H9M12 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h6" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <div className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-30 px-8 h-16 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[15px] font-bold text-slate-900 leading-tight truncate">
              {head.title}
            </h1>
            {head.subtitle && (
              <p className="text-[11px] text-slate-500 leading-tight truncate">{head.subtitle}</p>
            )}
          </div>
          {/* Kimlik kenar çubuğunun dibinde; burada tekrar etmiyor. */}
        </div>
        <div className="px-8 pb-10 pt-6">
          <ReportLetterhead
            title={head.title}
            subtitle={head.subtitle}
            userName={profile?.name}
            role={r}
            scope={
              role === "MANAGER"
                ? "Own department only"
                : role === "CUSTOMER"
                ? "Own training records only"
                : role === "USER"
                ? "Own training records only"
                : "All records visible to this account"
            }
          />
          {children}
          <ReportFootnote />
        </div>
      </main>
    </div>
  );
}
