import { connection } from "next/server";

export default async function Home() {
  // Forces dynamic rendering — required once nonce-based CSP applies to this route
  // (docs/SECURITY.md §6, wired in src/proxy.ts): a statically-prerendered page's HTML is
  // fixed at build time and can't carry a nonce that's generated fresh per request, so the
  // browser would block Next's own hydration script against the CSP header proxy.ts sends
  // for this exact page. See the content-security-policy guide bundled with this Next.js
  // version (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md) for
  // why — training data predates this API surface for Next 16, per AGENTS.md's own warning.
  await connection();

  return (
    <main style={{ maxWidth: 480, margin: "6rem auto", padding: "0 1rem", textAlign: "center" }}>
      <h1>Pomateshe</h1>
      <p style={{ color: "#666" }}>
        Платформа в разработке (docs/ROADMAP.md). Публичные страницы преподавателей и полноценный
        лендинг — Phase 2.
      </p>
      <p>
        <a href="/register">Регистрация преподавателя</a> · <a href="/login">Вход</a>
      </p>
    </main>
  );
}
