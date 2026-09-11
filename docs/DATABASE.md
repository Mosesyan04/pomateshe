# Pomateshe — Схема данных (PostgreSQL)

Статус: проектная схема (Prisma-style), реализация не создавалась в рамках этой задачи.
Пересмотрена во втором архитектурном review — изменения помечены **[review-2]**.

## 1. Принципы схемы

- Каждая tenant-таблица (принадлежащая конкретному преподавателю) содержит `teacherId`
  как обязательное indexed foreign key поле — это единственный источник правды для изоляции
  данных на уровне приложения (см. `docs/MULTI_TENANCY.md`).
- Первичные ключи — `cuid2`, кроме публичного идентификатора преподавателя (`slug`).
- Мягкое удаление (`deletedAt`) применяется только там, где действительно нужна история
  (`Lesson` — для отчётности по доходам). **[review-2]** Для `MaterialFile` мягкое удаление
  убрано (было расхождение с `docs/FILE_STORAGE.md`, который описывал немедленное атомарное
  удаление файла и записи — расхождение исправлено в пользу простой модели: файлы удаляются
  жёстко, без "мусорной корзины", т.к. это не заявленное требование ТЗ).
- Все денежные суммы — `Decimal`, не `Float`. Все временные метки — `timestamptz`, UTC.
- **[review-2]** Двусторонние foreign key между одной и той же парой таблиц (когда обе стороны
  хранят ссылку друг на друга) избегаются — единственный источник истины у каждой связи
  (см. §2 `Whiteboard`/`Lesson`, было расхождение в первой версии).

## 2. Основные сущности

### User (базовая identity-таблица, кастомная — не управляется внешним auth-фреймворком, см. `docs/AUTH.md`)
- `id`, `email` (unique), `emailVerifiedAt`, `passwordHash` (Argon2id), `role`
  (`admin` | `teacher` | `student`), `createdAt`, `disabledAt`.
- `teacherProfileId` (nullable, unique) **[Phase 1: добавлено при реализации]** — денормализованный
  указатель на `TeacherProfile.id` для пользователей с `role=teacher`, проставляется один раз
  при регистрации. Не было в первой версии схемы — понадобилось, потому что RLS-политика
  `teacher_profiles` завязана на её собственный `id` (`docs/MULTI_TENANCY.md` §2.3), а значит
  запрос "дан `userId`, найди его `teacherId`" не может пройти через саму `teacher_profiles`:
  контекст, который должна установить RLS-проверка, — это и есть то, что запрос пытается
  найти. `User` без RLS, поэтому поле здесь и решает то, что не может решить запрос к
  тенантной таблице. Подробности и как этот баг реально проявился в Phase 1 — `docs/MULTI_TENANCY.md`
  §4.2.

### Session **[review-2: схема больше не привязана к Auth.js Adapter]**
- `id`, `userId` (FK → User), `tokenHash` (unique — SHA-256 хэш случайного токена сессии,
  сырой токен никогда не хранится в БД, только в httpOnly cookie клиента), `expiresAt`,
  `createdAt`, `lastUsedAt`.
- Индекс: `Session(tokenHash)` unique, `Session(userId)` — для "выйти со всех устройств".
- Не tenant-scoped, RLS не применяется (принадлежит платформе, не преподавателю).
- Retention: истёкшие записи (`expiresAt < now() - 30 дней`) удаляются плановой задачей —
  без этого таблица растёт неограниченно (пропуск в первой версии документа).

### PasswordResetToken **[review-2: добавлено, было implicit в AUTH.md без схемы]**
- `id`, `userId` (FK → User), `tokenHash` (unique), `expiresAt`, `usedAt` (nullable), `createdAt`.
- Одноразовый (`usedAt` проставляется при использовании, повторное использование отклоняется).

### TeacherProfile (1:1 с User, где role = teacher)
- `id`, `userId` (unique FK → User), `slug` (unique), `displayName`, `bio`, `subjects` (string[]),
  `avatarStorageKey`, `timezone`, `publicPageSettings` (jsonb),
  `zoomPersonalLink` (nullable, см. `docs/ZOOM.md`), `defaultLessonPriceCents`, `currency`, `createdAt`.

### TeacherStudentLink **[review-2: заменяет `StudentProfile`, снимает ограничение "1 ученик = 1 преподаватель"]**

> Первая версия документа моделировала ученика как строку `StudentProfile` с единственным
> `teacherId` — это делало смену/добавление преподавателя миграцией схемы. По итогам review
> модель изменена на many-to-many между `User(role=student)` и `TeacherProfile`.

- `id`, `teacherId` (FK → TeacherProfile, **tenant key**), `studentUserId` (FK → User,
  role=student), `displayName` (может отличаться от `User.email`/глобального имени —
  например, как преподаватель подписал ученика у себя), `contactPhone`, `contactTelegram`,
  `notes` (видны только этому преподавателю), `status` (`active` | `archived`), `invitedAt`,
  `joinedAt`, `createdAt`.
- **UNIQUE** `(teacherId, studentUserId)` — нельзя привязать одного ученика к одному
  преподавателю дважды (отсутствовало в первой версии).
- Индексы: `TeacherStudentLink(teacherId)`, `TeacherStudentLink(studentUserId)` — второй нужен
  для запроса "мои преподаватели" со стороны ученика.
- RLS — особый случай с двумя политиками (teacher-scope и student-scope), подробности и
  обоснование — `docs/MULTI_TENANCY.md` §3.2.
- Все сущности ниже, которые раньше ссылались на `StudentProfile`, теперь ссылаются на
  `TeacherStudentLink.id` — конкретную связь конкретного ученика с конкретным преподавателем,
  а не на ученика "вообще". Это сохраняет инвариант "один тенант на строку" везде, кроме
  самой `TeacherStudentLink`.

### StudentInvite **[Phase 1: добавлено при реализации, отсутствовало в первой версии схемы]**
- `id`, `teacherId`, `email`, `tokenHash` (unique), `status` (`pending` | `accepted` | `revoked`),
  `expiresAt`, `createdAt`, `acceptedAt`.
- Реализует инвайт-флоу из `docs/AUTH.md` §3 — при проектировании схемы (Phase 0) эта таблица
  не была явно выписана, хотя сам флоу приглашения был описан текстом.
- **Намеренно без RLS**, как `Session`/`PasswordResetToken` — не "просто забыли": ссылку
  принимает человек, ещё не аутентифицированный ни как кто, поэтому защищать доступ через
  `app.current_teacher_id` здесь нечем — секретность обеспечивает сам `tokenHash`, тот же
  принцип, что у сброса пароля. Teacher-facing операции (список/отзыв своих приглашений)
  всё равно фильтруются по `teacherId` в data-access layer явно, тем же паттерном, что уже
  используется для `Session`/`PasswordResetToken`. См. `docs/MULTI_TENANCY.md` §4.1 для
  конкретной ошибки, которую этот выбор один раз всё же создал (RLS-джойн на `teacher_profiles`
  через `include`, без контекста, тихо возвращающий `null`) и как это обойдено.
- Индекс: `StudentInvite(teacherId)`.

### Group (`teacherId` — tenant key)
- `id`, `teacherId`, `name`, `createdAt`, `archivedAt`.

### GroupMember **[review-2: FK изменён на TeacherStudentLink, добавлен unique]**
- `id`, `groupId` (FK → Group), `studentLinkId` (FK → TeacherStudentLink), `joinedAt`, `leftAt`.
- **UNIQUE** `(groupId, studentLinkId)` — отсутствовало в первой версии, допускало дублирование
  членства.
- Инвариант (проверяется на уровне приложения при создании): `TeacherStudentLink.teacherId ===
  Group.teacherId` — членство в группе не может ссылаться на связь с другим преподавателем.

### Lesson (`teacherId` — tenant key)
- `id`, `teacherId`, `studentLinkId` (FK → TeacherStudentLink, nullable, если групповое занятие),
  `groupId` (nullable), `scheduledAt`, `durationMinutes`, `status`
  (`scheduled` | `completed` | `cancelled` | `no_show`), `priceCents`, `currency`,
  `paidAt` (nullable), `zoomLinkSnapshot`, `calendarEventId` (nullable), `notes`,
  `createdAt`, `updatedAt`, `deletedAt`.
- CHECK: ровно один из `studentLinkId`/`groupId` заполнен.
- **[review-2]** Поле `whiteboardId` убрано отсюда — связь с доской теперь только со стороны
  `Whiteboard.lessonId` (см. ниже), чтобы не хранить одну и ту же связь в двух местах.

### Homework (`teacherId` — tenant key)
- `id`, `teacherId`, `lessonId` (nullable), `studentLinkId` (nullable, FK → TeacherStudentLink),
  `groupId` (nullable), `title`, `description`, `dueAt`, `createdAt`.
- Удаляется жёстко при явном действии преподавателя (нет отдельного soft-delete состояния —
  уточнено, в первой версии было не специфицировано).

### MaterialFile (`teacherId` — tenant key) **[review-2: убрано deletedAt]**
- `id`, `teacherId`, `ownerUserId`, `homeworkId` (nullable), `lessonId` (nullable),
  `storageKey`, `originalFileName`, `mimeType`, `sizeBytes`, `createdAt`.
- Удаление — жёсткое, атомарное с удалением объекта в хранилище (см. `docs/FILE_STORAGE.md` §7)
  — было расхождение в первой версии (наличие `deletedAt` подразумевало soft-delete, а
  `FILE_STORAGE.md` описывал немедленное удаление); исправлено в пользу простой модели.
- Индекс: `MaterialFile(homeworkId)` добавлен (отсутствовал в первой версии — частый запрос
  "файлы этого ДЗ").

### Whiteboard (`teacherId` — tenant key) **[review-2: единственный источник связи с Lesson]**
- `id`, `teacherId`, `lessonId` (FK → Lesson, **unique**, not null после создания — доска
  всегда создаётся в контексте конкретного урока, не существует "ничья" доска),
  `snapshotStorageKey` (nullable), `lastActivityAt`, `expiresAt`, `createdAt`.
- `id` генерируется **только сервером** при первом обращении участника к доске конкретного
  урока — никогда не принимается от клиента (см. `docs/WHITEBOARD.md` §3).

### CalendarIntegration (`teacherId` — tenant key, 1:1)
- `id`, `teacherId` (unique), `provider` (`google`), `googleAccountEmail`,
  `accessTokenEncrypted`, `refreshTokenEncrypted`, `tokenExpiresAt`, `calendarId`,
  `watchChannelId` (nullable, **unique** — используется для резолва входящих webhook, см.
  `docs/MULTI_TENANCY.md` §7 "webhook" риск), `watchExpiresAt` (nullable), `createdAt`, `updatedAt`.

### ConsentRecord **[review-2: добавлен unique]**
- `id`, `userId`, `type` (`privacy_policy` | `pdn_processing` | `cookie_analytics` |
  `cookie_marketing` | `offer`), `policyVersion`, `acceptedAt`, `ip`, `userAgent`.
- **UNIQUE** `(userId, type, policyVersion)` — повторное согласие на ту же версию политики
  не создаёт дублирующую строку (upsert-семантика), отсутствовало в первой версии.
- Переживает удаление аккаунта пользователя (см. §7 "Retention", `docs/CONSENTS.md`) — доказательная
  база должна сохраняться даже после того, как остальные персональные данные удалены.

### AuditLog
- `id`, `actorUserId`, `action`, `targetType`, `targetId`, `metadata` (jsonb), `ip`, `createdAt`.
- Переживает удаление актора (запись остаётся, `actorUserId` не каскадно удаляется, а
  обезличивается при удалении пользователя — тот же принцип, что и у `ConsentRecord`).

## 3. Диаграмма связей (текстовая) **[review-2: обновлена под TeacherStudentLink]**

```
User(role=teacher) 1───1 TeacherProfile
User(role=student) 1───N TeacherStudentLink N───1 TeacherProfile
TeacherProfile 1───N Group
Group 1───N GroupMember N───1 TeacherStudentLink
TeacherProfile 1───N Lesson  (Lesson.studentLinkId → TeacherStudentLink ИЛИ Lesson.groupId → Group)
Lesson 1───0..1 Whiteboard        (FK на стороне Whiteboard.lessonId, unique)
Lesson 1───N Homework 1───N MaterialFile
TeacherProfile 1───0..1 CalendarIntegration
TeacherProfile 1───N StudentInvite
User 1───N Session
User 1───N ConsentRecord
User 1───N AuditLog (как actor)
```

## 4. Индексы и уникальные ограничения (сводка) **[review-2: расширено]**

| Таблица | Индекс/ограничение | Назначение |
|---|---|---|
| `TeacherProfile` | UNIQUE `slug` | Публичные страницы |
| `TeacherStudentLink` | UNIQUE `(teacherId, studentUserId)` | Нет дублей связи |
| `TeacherStudentLink` | INDEX `teacherId`, INDEX `studentUserId` | Tenant-запросы + "мои преподаватели" |
| `GroupMember` | UNIQUE `(groupId, studentLinkId)` | Нет дублей членства |
| `Lesson` | INDEX `(teacherId, scheduledAt)`, `(teacherId, paidAt)` | Расписание, отчёт по неоплаченным |
| `Homework` | INDEX `(teacherId, dueAt)` | Дашборд преподавателя |
| `MaterialFile` | INDEX `teacherId`, INDEX `homeworkId` | Tenant-запросы + файлы конкретного ДЗ |
| `Whiteboard` | UNIQUE `lessonId`, INDEX `expiresAt` | 1:0..1 с Lesson, cron удаления |
| `CalendarIntegration` | UNIQUE `teacherId`, UNIQUE `watchChannelId` | 1:1, резолв webhook |
| `ConsentRecord` | UNIQUE `(userId, type, policyVersion)` | Идемпотентность согласия |
| `Session` | UNIQUE `tokenHash`, INDEX `userId` | Лукап по cookie, logout-all |
| `PasswordResetToken` | UNIQUE `tokenHash` | Лукап по ссылке сброса |

## 5. Row-Level Security

Полная стратегия, включая критичный момент с владением таблиц в Prisma-миграциях и
разделением ролей БД (`pomateshe_migrator` / `pomateshe_app` / `pomateshe_admin_support`) —
вынесена в `docs/MULTI_TENANCY.md` §2 как основной документ по теме (в первой версии эта
информация дублировалась здесь не полностью и без критичной детали про `FORCE ROW LEVEL
SECURITY` и владение таблицами — теперь единственный источник истины — `docs/MULTI_TENANCY.md`).

## 6. Резервное копирование

- Ежедневный `pg_dump` + point-in-time recovery, если хостинг БД это поддерживает.
- Бэкапы хранятся зашифрованными, отдельно от продакшен-инстанса, ретеншен ≥ 30 дней.
- **[review-2]** Бэкапы обязаны физически храниться в том же юрисдикционном периметре (РФ),
  что и первичная БД — репликация бэкапов в зарубежное хранилище "для надёжности" нарушила бы
  требование 152-ФЗ так же, как и хранение первичных данных за рубежом (см. `docs/FILE_STORAGE.md`
  §"152-ФЗ", тот же принцип применяется к бэкапам БД, не только к объектному хранилищу).
- Ежеквартальная проверка восстановления бэкапа на staging.

## 7. Retention — сводная таблица **[review-2: новый раздел, ранее было разрознено по документам]**

| Сущность | Политика | Где подробно |
|---|---|---|
| `Lesson` | Soft delete (`deletedAt`), не удаляется физически — нужна для отчётности по доходам | Этот документ §1 |
| `MaterialFile` | Hard delete по явному действию или удалению родителя, атомарно с объектом в хранилище | `docs/FILE_STORAGE.md` §7 |
| `Whiteboard` | Hard delete по `expiresAt` (cron), retention-период — продуктовая константа | `docs/WHITEBOARD.md` §5 |
| `Session` | Hard delete истёкших записей (`expiresAt` в прошлом) плановой задачей | Этот документ §2 |
| `PasswordResetToken` | Hard delete использованных/истёкших токенов плановой задачей | Этот документ §2 |
| `EmailVerificationToken` | Hard delete использованных/истёкших токенов плановой задачей, тот же паттерн, что у `PasswordResetToken` | Этот документ §2 |
| `StudentInvite` **[Phase 1]** | Истёкшие/отменённые приглашения — hard delete плановой задачей, тот же паттерн, что у `PasswordResetToken` | Этот документ §2 |
| `ConsentRecord` | Никогда не удаляется, переживает удаление аккаунта (обезличивается, не стирается) | `docs/CONSENTS.md` §4 |
| `AuditLog` | Никогда не удаляется в рамках обычных процессов, переживает удаление актора | Этот документ §2 |
| БД-бэкапы | ≥ 30 дней, зашифрованы, в РФ-периметре | Этот документ §6 |

Задачи плановой очистки (`Session`, `PasswordResetToken`, `EmailVerificationToken`, `StudentInvite`, `Whiteboard`) — единый список cron-задач
фиксируется в `docs/ARCHITECTURE.md` §7 и `docs/DEPLOYMENT.md`.
