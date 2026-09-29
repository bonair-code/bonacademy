import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Head = { title: string; subtitle?: string };

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
export function PageHead({ title, subtitle }: Head) {
  const ctx = useContext(Ctx);
  const set = ctx?.setHead;
  useEffect(() => {
    set?.({ title, subtitle });
  }, [set, title, subtitle]);
  return null;
}
