/**
 * Beyaz ekran yerine okunabilir hata.
 *
 * React'te render sırasında atılan bir hata bütün ağacı söküyor ve geriye
 * bomboş bir sayfa kalıyor — kullanıcı neyin olduğunu bilmiyor, biz de
 * bilmiyoruz. Burası hatayı yakalayıp mesajı ekranda gösteriyor; bildirilen
 * metinle sorun aranabiliyor.
 *
 * Eski bir sekme açıkken yeni sürüm yayınlandığında da işe yarıyor:
 * "sayfayı yenile" en sık doğru cevap.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

type State = { error: Error | null; where: string | null };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, where: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Konsola da bas: tarayıcı araçlarından yığın izi okunabilsin.
    console.error("Render error:", error, info.componentStack);
    this.setState({ where: info.componentStack?.split("\n").slice(1, 4).join("\n") ?? null });
  }

  render() {
    const { error, where } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen grid place-items-center bg-[#f4f6f9] p-6">
        <div className="card max-w-lg w-full p-6">
          <h1 className="text-[17px] font-semibold text-slate-900">This screen could not load</h1>
          <p className="text-[13px] text-slate-600 mt-1.5">
            Something went wrong while drawing this page. Reloading usually fixes it — especially
            if the tab has been open since before the last update.
          </p>

          <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-slate-900 text-slate-100 text-[11px] p-3 whitespace-pre-wrap break-words">
            {error.message}
            {where ? `\n${where}` : ""}
          </pre>

          <div className="flex items-center gap-3 mt-5">
            <button onClick={() => window.location.reload()} className="btn-primary text-xs py-2">
              Reload
            </button>
            <a href="/dashboard" className="btn-secondary text-xs py-2">
              Go to dashboard
            </a>
          </div>
        </div>
      </div>
    );
  }
}
