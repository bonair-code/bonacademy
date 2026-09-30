import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth, needsOnboarding, type Role } from "./lib/auth";
import { Shell } from "./components/Shell";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Courses } from "./pages/Courses";
import { CourseDetail } from "./pages/CourseDetail";
import { Users } from "./pages/Users";
import { Assignments } from "./pages/Assignments";
import { Settings } from "./pages/Settings";
import { Learn } from "./pages/Learn";
import { Certificates } from "./pages/Certificates";
import { CertificateRegister } from "./pages/CertificateRegister";
import { Verify } from "./pages/Verify";
import { TrainingMatrix } from "./pages/TrainingMatrix";
import { StaffDetail } from "./pages/StaffDetail";
import { ClassSessions, ClassSessionDetail } from "./pages/ClassSessions";
import { JoinSession } from "./pages/JoinSession";
import { CertificateView } from "./pages/CertificateView";
import { Onboarding } from "./pages/Onboarding";
import { Placeholder } from "./pages/Placeholder";

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f4f6f9] text-slate-500 text-sm">
      {children}
    </div>
  );
}

/**
 * Rota seviyesinde rol kontrolü. Eskiden koruma sayfaların içindeydi ve
 * bazılarında (Courses, CourseDetail, Users, Settings) hiç yoktu — adresi elle
 * yazan bir çalışan ya da müşteri o ekranı açabiliyordu. Veriyi Firestore
 * kuralları koruyor, ama ekranın hiç gelmemesi gerekir.
 */
function Only({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { role } = useAuth();
  if (!role) return null;
  if (!roles.includes(role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

const STAFF_VIEW: Role[] = ["ADMIN", "MANAGER", "INSTRUCTOR"];
const TRAINING_ADMIN: Role[] = ["ADMIN", "INSTRUCTOR"];

function AuthedApp() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        {/* Herkes — müşteri dahil: kendi eğitimi ve kendi belgeleri */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/learn/:id" element={<Learn />} />
        <Route path="/certificates" element={<Certificates />} />
        <Route path="/certificate/:certId" element={<CertificateView />} />

        <Route
          path="/courses"
          element={
            <Only roles={TRAINING_ADMIN}>
              <Courses />
            </Only>
          }
        />
        <Route
          path="/courses/:id"
          element={
            <Only roles={TRAINING_ADMIN}>
              <CourseDetail />
            </Only>
          }
        />
        <Route
          path="/sessions"
          element={
            <Only roles={TRAINING_ADMIN}>
              <ClassSessions />
            </Only>
          }
        />
        <Route
          path="/sessions/:sessionId"
          element={
            <Only roles={TRAINING_ADMIN}>
              <ClassSessionDetail />
            </Only>
          }
        />
        <Route
          path="/register"
          element={
            <Only roles={TRAINING_ADMIN}>
              <CertificateRegister />
            </Only>
          }
        />
        <Route
          path="/team/:userId"
          element={
            <Only roles={STAFF_VIEW}>
              <StaffDetail />
            </Only>
          }
        />
        <Route
          path="/follow-up"
          element={
            <Only roles={STAFF_VIEW}>
              <TrainingMatrix />
            </Only>
          }
        />
        <Route
          path="/plans"
          element={
            <Only roles={["ADMIN", "MANAGER"]}>
              <Placeholder title="Planlar" />
            </Only>
          }
        />
        <Route
          path="/assignments"
          element={
            <Only roles={["ADMIN", "MANAGER"]}>
              <Assignments />
            </Only>
          }
        />
        <Route
          path="/users"
          element={
            <Only roles={["ADMIN", "MANAGER"]}>
              <Users />
            </Only>
          }
        />
        <Route
          path="/settings"
          element={
            <Only roles={["ADMIN"]}>
              <Settings />
            </Only>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Shell>
  );
}

export function App() {
  const { user, profile, loading } = useAuth();
  if (loading) return <FullScreen>Loading…</FullScreen>;

  // İlk giriş: şifre ve eksik profil tamamlanmadan uygulamaya girilemez.
  // Herkese açık rotalar (doğrulama, yoklama) bundan etkilenmez.
  const path = window.location.pathname;
  const isPublic = path.startsWith("/verify") || path.startsWith("/join");
  if (user && !isPublic && needsOnboarding(profile)) return <Onboarding />;

  return (
    <Routes>
      {/* Herkese açık — QR sertifika doğrulama */}
      <Route path="/verify/:serialNo" element={<Verify />} />
      <Route path="/verify" element={<Verify />} />
      {/* Yoklama formu — giriş gerektirmez, link parolanın kendisidir */}
      <Route path="/join/:sessionId" element={<JoinSession />} />
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route
        path="/*"
        element={user ? <AuthedApp /> : <Navigate to="/login" replace />}
      />
    </Routes>
  );
}
