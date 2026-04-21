import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BonAcademy — Bon Air Eğitim Yönetim Sistemi",
  description: "Şirket içi eğitim planlama, gerçekleştirme ve takip sistemi.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={inter.variable}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
