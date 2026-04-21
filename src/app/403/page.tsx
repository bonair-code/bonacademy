export default function Forbidden() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-semibold mb-2">403 — Yetkisiz</h1>
        <p className="text-slate-500">Bu sayfaya erişim yetkiniz yok.</p>
      </div>
    </div>
  );
}
