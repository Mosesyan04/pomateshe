import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { CookieBanner } from "./_components/cookie-banner";
import "./globals.css";

/**
 * Inter — the brand typeface fixed by docs/DESIGN_SYSTEM.md §3/§6 (carried over from the
 * original index.html prototype), not the Next.js starter's default Geist. Found during
 * landing-page work: Geist was scaffolded in but never actually applied (globals.css's `body`
 * fell back to plain Arial), so switching here doesn't disturb any page's already-shipped
 * look — it's the first time this documented decision is actually wired up.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Pomateshe",
  description: "Платформа для преподавателей и учеников",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={inter.variable}>
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
