import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

/**
 * SCORM içeriği serveScormContent'ten kursa özel, süreli bir anahtarla açılır
 * (iframe istekleri kimlik taşımadığı için anahtar adresin içinde). Anahtar
 * kurs başına önbellekte tutulur; süresi bitmeye yakınsa yenisi alınır.
 */
const cache = new Map<string, { token: string; exp: number }>();
/** Bitmesine bundan az kalmışsa yenile — açılan paketin dosyaları yarıda kesilmesin. */
const MIN_LEFT_MS = 60 * 60 * 1000;

async function scormToken(courseId: string): Promise<string> {
  const hit = cache.get(courseId);
  if (hit && hit.exp - Date.now() > MIN_LEFT_MS) return hit.token;
  const r = await httpsCallable<{ courseId: string }, { token: string; exp: number }>(
    functions,
    "scormAccess"
  )({ courseId });
  cache.set(courseId, r.data);
  return r.data.token;
}

/**
 * `basePath` = "content/<courseId>/<sectionId>/scorm/<id>/". Kurs id'si yoldan
 * okunur. Adres: `<base>/a/<anahtar>/<basePath><entryPoint>`.
 */
export function useScormSrc(base: string, basePath: string, entryPoint: string) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    setErr(null);
    const courseId = basePath.split("/")[1] || "";
    scormToken(courseId)
      .then((t) => alive && setSrc(`${base}/a/${t}/${basePath}${entryPoint}`))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [base, basePath, entryPoint]);
  return { src, err };
}
