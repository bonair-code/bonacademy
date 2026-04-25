import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { CookieBanner } from "@/components/CookieBanner";
import { Toaster } from "@/components/Toaster";
import { readAndClearFlash } from "@/lib/flash";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

// Metadata kullanıcı dilinde (cookie → getTranslations üzerinden).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const flash = await readAndClearFlash();
  return (
    <html lang={locale} className={inter.variable}>
      <body className="min-h-screen font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          <CookieBanner />
          <Toaster initial={flash} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
