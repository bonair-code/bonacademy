import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/** Kalite sisteminin form kunyesi. Yalnizca denetime giden belgelerde. */
export type FormRef = { no: string; rev: string };

type Head = {
  title: string;
  subtitle?: string;
  /** Baskida kullanilacak baslik; verilmezse `title`. Ekranda "Training
   *  Follow-Up" yazarken kagitta "Training Follow-Up Form" yazmasi icin. */
  printTitle?: string;
  /** Verilirse antete Form No / Rev. blogu basilir. */
  form?: FormRef;
};

const Ctx = createContext<{
  head: Head;
  setHead: (h: Head) => void;
} | null>(null);

/** Sayfa başlığını üst bara taşır — Shell içinde tüm düzeni sarar. */
export function PageHeadProvider({ children }: { children: ReactNode }) {
  const [head, setHead] = useState<Head>({ title: "" });
  return <Ctx.Provider value={{ head, setHead }}>{children}</Ctx.Provider>;
}

/** Üst barın okuduğu değer. */
export function usePageHead(): Head {
  return useContext(Ctx)?.head ?? { title: "" };
}

/**
 * Sayfalar bunu render eder; görünür bir çıktısı yok, başlığı üst bara bildirir.
 * Örn: <PageHead title="Users" subtitle="Staff accounts, roles and departments." />
 */
export function PageHead({ title, subtitle, printTitle, form }: Head) {
  const ctx = useContext(Ctx);
  const set = ctx?.setHead;
  // `form` her render'da yeni nesne olmasin diye alanlarina bagli.
  const fno = form?.no;
  const frev = form?.rev;
  useEffect(() => {
    set?.({ title, subtitle, printTitle, form: fno && frev ? { no: fno, rev: frev } : undefined });
  }, [set, title, subtitle, printTitle, fno, frev]);
  return null;
}
