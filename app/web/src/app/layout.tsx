import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CookieBanner } from "./_components/cookie-banner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pomateshe",
  description: "Платформа для преподавателей и учеников",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1 }}>{children}</div>
        <footer
          style={{
            padding: "1rem",
            textAlign: "center",
            fontSize: "0.85rem",
            color: "#666",
            borderTop: "1px solid #eee",
          }}
        >
          <a href="/legal/offer">Пользовательское соглашение</a> ·{" "}
          <a href="/legal/privacy">Политика обработки персональных данных</a> ·{" "}
          <a href="/legal/cookies">Политика cookie</a>
        </footer>
        <CookieBanner />
      </body>
    </html>
  );
}
