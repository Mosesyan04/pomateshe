export default function Home() {
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
