import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicTeacherProfile } from "../../../server/teacher-profile";

/**
 * Public marketing page for one teacher — docs/DESIGN_SYSTEM.md §2: distinct character from
 * the cabinet UI (plain, functional forms everywhere else in this app), but still built with
 * the project's existing plain-CSS convention rather than a new UI dependency (Tailwind/Motion
 * etc. aren't installed here and adding them for one page would be a real architecture change,
 * not a design decision). Registration stays invite-only (docs/AUTH.md §3) — this page's CTA
 * is "contact the teacher", not a self-serve signup button.
 */

const ACCENT = "#4f46e5"; // docs/DESIGN_SYSTEM.md §3 — reused brand indigo, not reinvented

function formatMoney(cents: number, currency: string): string {
  const symbol = currency === "RUB" ? "₽" : currency;
  return `${(cents / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0 })} ${symbol}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const profile = await getPublicTeacherProfile(slug);
  if (!profile) return { title: "Преподаватель не найден — Pomateshe" };
  return {
    title: `${profile.displayName} — Pomateshe`,
    description: profile.bio ?? `${profile.displayName} на платформе Pomateshe`,
  };
}

export default async function PublicTeacherPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const profile = await getPublicTeacherProfile(slug);
  if (!profile) notFound();

  const initials = profile.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "3rem 1.5rem" }}>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: "2rem",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatarUrl}
              alt={profile.displayName}
              width={112}
              height={112}
              style={{ borderRadius: "50%", objectFit: "cover", width: 112, height: 112, flexShrink: 0 }}
            />
          ) : (
            <div
              aria-hidden
              style={{
                width: 112,
                height: 112,
                borderRadius: "50%",
                background: ACCENT,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "2.25rem",
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {initials || "?"}
            </div>
          )}
          <div>
            <h1 style={{ margin: 0, fontSize: "2rem", lineHeight: 1.2 }}>{profile.displayName}</h1>
            {profile.subjects.length > 0 && (
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
                {profile.subjects.map((subject) => (
                  <span
                    key={subject}
                    style={{
                      fontSize: "0.85rem",
                      padding: "0.2rem 0.65rem",
                      borderRadius: 999,
                      border: `1px solid ${ACCENT}`,
                      color: ACCENT,
                    }}
                  >
                    {subject}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {profile.bio && (
          <p style={{ fontSize: "1.05rem", lineHeight: 1.65, maxWidth: "65ch", color: "#333" }}>
            {profile.bio}
          </p>
        )}

        <div
          style={{
            display: "flex",
            gap: "1.5rem",
            flexWrap: "wrap",
            padding: "1.25rem",
            borderTop: "1px solid #eee",
            borderBottom: "1px solid #eee",
          }}
        >
          {profile.defaultLessonPriceCents != null && (
            <div>
              <div style={{ fontSize: "0.8rem", color: "#666" }}>Стоимость занятия</div>
              <div style={{ fontSize: "1.15rem", fontWeight: 600 }}>
                от {formatMoney(profile.defaultLessonPriceCents, profile.currency)}
              </div>
            </div>
          )}
          {profile.contactInfo && (
            <div>
              <div style={{ fontSize: "0.8rem", color: "#666" }}>Как связаться</div>
              <div style={{ fontSize: "1.05rem" }}>{profile.contactInfo}</div>
            </div>
          )}
        </div>

        {!profile.contactInfo && (
          <p style={{ color: "#666" }}>
            Преподаватель пока не указал контакты для связи на этой странице.
          </p>
        )}
      </section>
    </main>
  );
}
