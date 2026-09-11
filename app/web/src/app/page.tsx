import { connection } from "next/server";
import { CheckCircle, Target } from "@phosphor-icons/react/ssr";
import styles from "./page.module.css";
import { submitTrialRequestAction } from "./trial-request-actions";

/**
 * pomateshe.ru's own landing page — the platform owner's personal tutoring marketing page,
 * NOT the generic per-teacher public profile (`/t/[slug]`, already built). Redesign-preserve
 * of the old index.html prototype's public section (see repo root index.html for the original
 * content this ports): same brand (indigo, Inter, dark mode — docs/DESIGN_SYSTEM.md §6), same
 * facts (diplomas, reviews, subjects offered), new markup/styling, no more dependency on the
 * old Google Apps Script backend (docs/THREAT_MODEL.md T-002 — this page's form goes through
 * a real Server Action, src/app/trial-request-actions.ts, not a public write-anywhere URL).
 */

const LESSON_TRACKS = [
  {
    tag: "9 класс",
    title: "ОГЭ по математике",
    desc: "Разбираем все модули экзамена по порядку, от практической части до геометрии. Пробники раз в месяц, чтобы видеть реальный прогресс, а не только теорию.",
  },
  {
    tag: "10-11 класс",
    title: "ЕГЭ база",
    desc: "Уверенная пятёрка без лишнего стресса: типовые номера, разбор ошибок прошлых лет, финальная неделя интенсивной практики перед экзаменом.",
  },
  {
    tag: "7-8 класс",
    title: "Подготовка к ОГЭ и геометрия",
    desc: "Закрываем пробелы заранее, пока есть время, а не в последний год перед экзаменом.",
  },
  {
    tag: "5-6 класс",
    title: "Повышение успеваемости",
    desc: "Понятное объяснение базовых тем, чтобы дроби и уравнения не превращались в проблему на годы вперёд.",
  },
] as const;

const DIPLOMAS = [
  {
    tag: "МГПУ 2026",
    title: "Высшее образование",
    desc: "Московский Городской Педагогический Университет, прикладные исследования и анализ данных.",
  },
  {
    tag: "МГПУ 2023",
    title: "Диплом о профессиональной переподготовке",
    desc: "Московский Городской Педагогический Университет, педагог дополнительного образования.",
  },
  {
    tag: "МГПУ 2024",
    title: "Диплом о профессиональной переподготовке",
    desc: "Московский Городской Педагогический Университет, советник директора по воспитанию.",
  },
  {
    tag: "Фоксфорд 2025",
    title: "Сертификат о повышении квалификации",
    desc: "Методика подготовки к экзаменам по математике.",
  },
] as const;

const REVIEWS = [
  {
    initial: "И",
    name: "Иван К.",
    context: "9 класс",
    score: "ОГЭ на «5» (30 баллов)",
    text: "До занятий с Артёмом геометрию вообще не понимал, пробники писал на тройку. За 4 месяца закрыли все пробелы, получил уверенную пятёрку.",
  },
  {
    initial: "Е",
    name: "Елена",
    context: "мама Софии, 9 класс",
    score: "ОГЭ на «5»",
    text: "Артём оказался замечательным преподавателем и снял весь страх перед экзаменом у дочки. Спасибо за ежемесячные отчёты: всегда знала, как идут дела.",
  },
  {
    initial: "А",
    name: "Алина М.",
    context: "11 класс",
    score: "ЕГЭ база на «5» (20 из 21)",
    text: "Математика нужна была для аттестата и поступления в мед. С Артёмом разобрали все типовые номера, сдала на высший балл без стресса.",
  },
  {
    initial: "М",
    name: "Максим Д.",
    context: "8 класс",
    score: "Выход на «5» в четверти",
    text: "В 8 классе начались проблемы с алгеброй и дробями. Уже через месяц занятий начал сам решать контрольные без решебников.",
  },
  {
    initial: "С",
    name: "Светлана",
    context: "мама Артёма, 7 класс",
    score: "Устранили пробелы за 5-6 класс",
    text: "Очень удобный личный кабинет: сын сам заходит, видит расписание и домашние задания. Оценки в школе заметно выросли всего за 5 недель.",
  },
  {
    initial: "Д",
    name: "Дарья П.",
    context: "10 класс",
    score: "Уверенная «5» по алгебре",
    text: "Артём объясняет очень понятно и наглядно на онлайн-доске. Конспекты уроков сохраняются, перед контрольными удобно повторять.",
  },
  {
    initial: "К",
    name: "Кирилл В.",
    context: "9 класс",
    score: "ОГЭ на «4» (была слабая «3»)",
    text: "Спасибо Артёму за терпение и чёткую систему. Первая часть и практические задачи стали понятными и простыми.",
  },
] as const;

const ERROR_MESSAGES: Record<string, string> = {
  missing_consent: "Нужно согласиться с политикой обработки персональных данных.",
  rate_limited: "Слишком много заявок подряд. Попробуйте ещё раз чуть позже.",
  invalid: "Проверьте, пожалуйста, поля формы и отправьте заявку ещё раз.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  await connection();
  const { sent: sentParam, error: errorParam } = await searchParams;
  const sent = sentParam === "1";
  const errorMessage = errorParam ? (ERROR_MESSAGES[errorParam] ?? ERROR_MESSAGES.invalid) : null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={`${styles.container} ${styles.headerRow}`}>
          <div className={styles.brand}>
            <span className={styles.logoMark} aria-hidden="true">
              А
            </span>
            <span className={styles.brandNames}>
              <span className={styles.brandName}>Уроки с Артёмом</span>
              <span className={styles.brandSub}>pomateshe</span>
            </span>
          </div>
          <nav className={styles.nav} aria-label="Разделы страницы">
            <a href="#about">Обо мне</a>
            <a href="#lessons">Уроки</a>
            <a href="#diplomas">Дипломы</a>
            <a href="#reviews">Отзывы</a>
          </nav>
          <div className={styles.headerActions}>
            <a className={styles.loginLink} href="/login">
              Войти
            </a>
            <a className={styles.btnPrimary} href="#trial-form">
              Записаться
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={`${styles.container} ${styles.heroGrid}`}>
            <div>
              <span className={styles.heroBadge}>
                <Target size={14} weight="bold" aria-hidden="true" />
                Первый результат заметен уже через месяц
              </span>
              <h1 className={styles.heroHeadline}>
                Понятная математика: <em>ОГЭ</em>, <em>ЕГЭ база</em> и уверенность в школе
              </h1>
              <p className={styles.heroSubtext}>
                Закрываем пробелы с 5 по 11 класс, объясняем логику предмета без зубрёжки.
                Онлайн-доска, личный кабинет и понятные отчёты для родителей.
              </p>
              <div className={styles.heroCtas}>
                <a className={styles.btnPrimary} href="#trial-form">
                  Записаться на диагностику
                </a>
                <a className={styles.btnSecondary} href="/login">
                  Войти в кабинет
                </a>
              </div>
            </div>

            <div className={styles.resultsCard}>
              <p className={styles.resultsTitle}>Результаты моих учеников</p>
              <div className={styles.statGrid}>
                <div className={styles.statCard}>
                  <span className={styles.statNumber}>97%</span>
                  <span className={styles.statLabel}>Сдали ОГЭ на «4» и «5»</span>
                </div>
                <div className={styles.statCard}>
                  <span className={`${styles.statNumber} ${styles.statNumberAlt}`}>98%</span>
                  <span className={styles.statLabel}>Сдали ЕГЭ базу на «5»</span>
                </div>
              </div>
              <ul className={styles.factList}>
                <li>
                  <CheckCircle size={16} weight="fill" className={styles.factIcon} aria-hidden="true" />
                  <span>
                    <b>Рост оценки на 1.5-2 балла:</b> выход из троек в уверенные отличники.
                  </span>
                </li>
                <li>
                  <CheckCircle size={16} weight="fill" className={styles.factIcon} aria-hidden="true" />
                  <span>
                    <b>Интерактивная доска:</b> конспект каждого занятия сохраняется.
                  </span>
                </li>
                <li>
                  <CheckCircle size={16} weight="fill" className={styles.factIcon} aria-hidden="true" />
                  <span>
                    <b>Ежемесячные отчёты для родителей</b> с прозрачным графиком прогресса.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section id="about" className={styles.section}>
          <div className={styles.container}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Обо мне</h2>
            </div>
            <div className={styles.aboutBody}>
              <p>
                Меня зовут Артём. Я закончил Московский Городской Педагогический Университет и
                продолжаю учиться сам: диплом о профессиональной переподготовке как педагог
                дополнительного образования, отдельная переподготовка на советника директора по
                воспитанию и сертификат Фоксфорда по методике подготовки к экзаменам.
              </p>
              <p>
                Занимаюсь математикой с учениками 5-11 класса: от закрытия текущих пробелов до
                полноценной подготовки к ОГЭ и ЕГЭ базе. Веду занятия на интерактивной онлайн-доске,
                сохраняю конспект каждого урока и раз в месяц присылаю родителям понятный отчёт о
                прогрессе, без педагогического жаргона.
              </p>
            </div>
          </div>
        </section>

        <section id="lessons" className={styles.section}>
          <div className={styles.container}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Уроки</h2>
              <p className={styles.sectionLead}>Четыре направления, каждое под конкретный класс и цель.</p>
            </div>
            <div className={styles.lessonsGrid}>
              {LESSON_TRACKS.map((track) => (
                <div className={styles.lessonCard} key={track.title}>
                  <span className={styles.lessonTag}>{track.tag}</span>
                  <h3 className={styles.lessonTitle}>{track.title}</h3>
                  <p className={styles.lessonDesc}>{track.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="diplomas" className={styles.section}>
          <div className={styles.container}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Дипломы и образование</h2>
              <p className={styles.sectionLead}>
                Профильное педагогическое образование и регулярное повышение квалификации.
              </p>
            </div>
          </div>
          <div className={`${styles.container} ${styles.scrollStrip}`}>
            {DIPLOMAS.map((d) => (
              <div className={styles.diplomaCard} key={d.title + d.tag}>
                <span className={styles.diplomaTag}>{d.tag}</span>
                <div>
                  <h3 className={styles.diplomaTitle}>{d.title}</h3>
                  <p className={styles.diplomaDesc}>{d.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="reviews" className={styles.section}>
          <div className={styles.container}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Отзывы учеников и родителей</h2>
              <p className={styles.sectionLead}>Реальные отзывы по ОГЭ, ЕГЭ базе и успеваемости в школе.</p>
            </div>
            <div className={styles.reviewsGrid}>
              {REVIEWS.map((r) => (
                <div className={styles.reviewCard} key={r.name + r.context}>
                  <div className={styles.reviewHead}>
                    <span className={styles.reviewAvatar} aria-hidden="true">
                      {r.initial}
                    </span>
                    <div>
                      <span className={styles.reviewName}>
                        {r.name} <span style={{ fontWeight: 500 }}>({r.context})</span>
                      </span>
                      <span className={styles.reviewScore}>{r.score}</span>
                    </div>
                  </div>
                  <p className={styles.reviewText}>&laquo;{r.text}&raquo;</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="trial-form" className={styles.formSection}>
          <div className={`${styles.container} ${styles.formWrap}`}>
            <div className={styles.sectionHead} style={{ margin: "0 auto 1.5rem" }}>
              <h2 className={styles.sectionTitle}>Запишитесь на бесплатную диагностику</h2>
              <p className={styles.sectionLead}>
                Определим текущий уровень, разберём непонятные темы и составим план подготовки.
              </p>
            </div>

            {sent && <p className={`${styles.formNotice} ${styles.formNoticeSuccess}`}>Заявка отправлена, скоро свяжусь с вами.</p>}
            {errorMessage && <p className={`${styles.formNotice} ${styles.formNoticeError}`}>{errorMessage}</p>}

            <form className={styles.form} action={submitTrialRequestAction}>
              <input type="text" name="website" tabIndex={-1} autoComplete="off" className={styles.honeypot} aria-hidden="true" />

              <div className={styles.field}>
                <label htmlFor="lead-name">Имя ученика или родителя</label>
                <input id="lead-name" name="name" type="text" required maxLength={200} placeholder="Например, Ольга" />
              </div>

              <div className={styles.field}>
                <label htmlFor="lead-contact">Телефон или Telegram для связи</label>
                <input
                  id="lead-contact"
                  name="contact"
                  type="text"
                  required
                  maxLength={200}
                  placeholder="+7 999 000-00-00 или @username"
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="lead-goal">Цель и класс</label>
                <select id="lead-goal" name="goal" required defaultValue="ОГЭ Математика (9 класс)">
                  <option value="ОГЭ Математика (9 класс)">ОГЭ по математике (9 класс)</option>
                  <option value="ЕГЭ Базовая математика (10–11 класс)">ЕГЭ базовая математика (10-11 класс)</option>
                  <option value="7–8 класс (подготовка к ОГЭ и геометрия)">7-8 класс (подготовка к ОГЭ и геометрия)</option>
                  <option value="Повышение успеваемости (5–6 класс)">Повышение успеваемости (5-6 класс)</option>
                </select>
              </div>

              <div className={`${styles.field} ${styles.consentField}`}>
                <input id="lead-consent" name="consent" type="checkbox" required />
                <label htmlFor="lead-consent">
                  Согласен(на) с <a href="/legal/privacy">политикой обработки персональных данных</a>
                </label>
              </div>

              <button type="submit" className={styles.btnPrimary}>
                Отправить заявку
              </button>
            </form>
          </div>
        </section>

        <section className={styles.landingFooter}>
          <p className={`${styles.container} ${styles.landingFooterText}`}>
            Вы сами преподаёте и хотите такой же личный кабинет для своих учеников?{" "}
            <a href="/register">Зарегистрируйтесь на платформе pomateshe</a>.
          </p>
        </section>
      </main>
    </div>
  );
}
