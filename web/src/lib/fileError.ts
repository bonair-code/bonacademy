/**
 * Dosya indirilemediğinde kullanıcıya SEBEBİNİ söyle.
 *
 * "Failed to fetch" tarayıcının CORS reddini de kapsıyor: Storage kovası
 * sitenin adresini tanımıyorsa dosya hiç gelmiyor ve ekranda yalnızca bu
 * anlamsız metin kalıyor — sebebi görmek için konsola bakmak gerekiyordu.
 * Bu tam olarak bir kez oldu: yeni alan adı bağlandı, kovanın izin listesine
 * eklenmedi, bütün PDF'ler açılmaz hâle geldi ve ekranda hiçbir ipucu yoktu.
 */
export type FileError = { title: string; detail: string; hint?: string };

export function fileLoadError(e: unknown): FileError {
  const err = e as Error;
  const msg = err?.message || String(e);
  const network =
    /failed to fetch|networkerror|load failed|err_failed|cors/i.test(msg) ||
    err?.name === "TypeError";

  if (network)
    return {
      title: "This file could not be downloaded.",
      detail: msg,
      hint:
        `The browser was blocked from reading it. Most often this address (${location.origin}) ` +
        "is not on the storage allow-list — the file itself is fine. Send this message to your " +
        "administrator.",
    };

  if (/permission|unauthorized|403/i.test(msg))
    return {
      title: "You are not allowed to open this file.",
      detail: msg,
      hint: "Your account does not have access to this material. Ask your administrator.",
    };

  if (/not found|404/i.test(msg))
    return {
      title: "This file is missing.",
      detail: msg,
      hint: "It is no longer in storage — the training needs its content uploaded again.",
    };

  return { title: "This file could not be displayed.", detail: msg };
}
