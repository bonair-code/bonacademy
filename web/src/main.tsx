import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { consumeSsoTicket } from "./lib/sso";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

/* Launcher'dan gelen oturum devri, uygulama MONTE EDİLMEDEN ÖNCE tamamlanır.
 *
 * AuthProvider ilk onAuthStateChanged olayında oturum yoksa giriş ekranını
 * açıyor. Bileti sonra kullansaydık kullanıcı bir anlık "şifreni gir" ekranı
 * görür, ardından ekran kendiliğinden değişirdi.
 *
 * Bilet yoksa fonksiyon anında döner — normal açılışa maliyeti yok.
 * Başarısızlıkta da render edilir (finally): kullanıcı BonAcademy'nin kendi
 * giriş ekranına düşer, uygulama hiç açılmadan takılı kalmaz.
 * Ayrıntı: src/lib/sso.ts */
consumeSsoTicket().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>
  );
});
