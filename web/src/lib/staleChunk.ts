/**
 * Yeni bir yayından sonra AÇIK KALAN sekme.
 *
 * Firebase Hosting her yayında eski dosyaları kaldırıyor; derleme parçalarının
 * adları içerik özetiyle değişiyor. Uzun süredir açık bir sekme, ilk kez
 * gereken bir parçayı (ör. giriş ekranındaki 3D uçak) eski adıyla isteyince
 * 404 alıyor. Çözüm: sayfayı bir kez yenileyip güncel sürümü almak.
 * index.html önbelleğe alınmıyor (firebase.json), yenileme yeni sürümü getirir.
 *
 * Döngüye girmesin diye dakikada en fazla bir kez; ikinci hatada yenilemez,
 * çağıran kendi yedeğine düşer.
 */
const KEY = "stale-chunk-reload-at";

export function reloadOnceForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false; // depolama kapalı: döngü riski, yenileme yok
  }
  window.location.reload();
  return true;
}
