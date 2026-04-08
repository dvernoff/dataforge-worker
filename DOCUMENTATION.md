# DataForge Documentation / Документация DataForge

> **DataForge** — open-source Backend-as-a-Service (BaaS) platform for building data-driven applications. Create databases, REST APIs, real-time connections, and integrations — all from a visual interface.
>
> **DataForge** — платформа с открытым исходным кодом для создания приложений на основе данных. Базы данных, REST API, real-time подключения и интеграции — через визуальный интерфейс.

---

## Table of Contents / Оглавление

1. [Getting Started / Начало работы](#1-getting-started--начало-работы)
2. [Projects / Проекты](#2-projects--проекты)
3. [Database & Tables / База данных и таблицы](#3-database--tables--база-данных-и-таблицы)
4. [Data Management / Управление данными](#4-data-management--управление-данными)
5. [API Builder / Конструктор API](#5-api-builder--конструктор-api)
6. [Authentication & Security / Аутентификация и безопасность](#6-authentication--security--аутентификация-и-безопасность)
7. [SQL Console & Query Builder / SQL Консоль и конструктор запросов](#7-sql-console--query-builder--sql-консоль-и-конструктор-запросов)
8. [Analytics / Аналитика](#8-analytics--аналитика)
9. [Plugins / Плагины](#9-plugins--плагины)
   - 9.1 [Views / Представления](#91-views--представления)
   - 9.2 [Modules / Модули](#92-modules--модули)
   - 9.3 [Integrations / Интеграции](#93-integrations--интеграции)
10. [System Administration / Администрирование](#10-system-administration--администрирование)
11. [Examples / Примеры](#11-examples--примеры)

---

## 1. Getting Started / Начало работы

### Registration & Login / Регистрация и вход

DataForge supports email-based authentication with optional two-factor authentication (2FA).

DataForge поддерживает аутентификацию по email с опциональной двухфакторной аутентификацией (2FA).

- **Register** (`/register`) — Create an account with email and password / Создайте аккаунт с email и паролем
- **Login** (`/login`) — Sign in with credentials / Войдите с учётными данными
- **2FA** (`/2fa`) — Optional TOTP-based two-factor auth / Опциональная двухфакторная аутентификация

### First Steps / Первые шаги

1. Create a project / Создайте проект
2. Create tables / Создайте таблицы
3. Add data / Добавьте данные
4. Generate API endpoints / Сгенерируйте API-эндпоинты
5. Get API tokens / Получите API-токены
6. Use the API / Используйте API

---

## 2. Projects / Проекты

A **project** is an isolated workspace with its own database schema, API endpoints, and settings.

**Проект** — изолированное рабочее пространство с собственной схемой базы данных, API-эндпоинтами и настройками.

### Features / Возможности

| Feature | Description (EN) | Описание (RU) |
|---------|-----------------|---------------|
| Create project | Set name, slug, description | Задайте имя, slug, описание |
| Dashboard | Overview with table count, API requests chart, recent activity | Обзор: кол-во таблиц, график запросов, последние действия |
| User management | Invite users with roles (admin, editor, viewer) | Приглашайте пользователей с ролями |
| Project settings | Change name, slug, assigned worker node | Изменяйте имя, slug, привязанную ноду |

### Roles / Роли

- **Admin** — Full access to project settings, data, and API / Полный доступ
- **Editor** — Can modify data and endpoints / Может изменять данные и эндпоинты
- **Viewer** — Read-only access / Только чтение

---

## 3. Database & Tables / База данных и таблицы

### Table Management / Управление таблицами

Path: `/projects/:slug/tables`

Create and manage PostgreSQL tables through a visual interface.

Создавайте и управляйте таблицами PostgreSQL через визуальный интерфейс.

#### Supported Column Types / Поддерживаемые типы

| Type | Description (EN) | Описание (RU) |
|------|-----------------|---------------|
| `uuid` | Unique identifier (auto-generated) | Уникальный идентификатор |
| `text` | Variable-length string | Строка переменной длины |
| `varchar` | String with max length | Строка с ограничением длины |
| `integer` | Whole number | Целое число |
| `bigint` | Large whole number | Большое целое число |
| `boolean` | True/false | Истина/ложь |
| `timestamp` | Date and time with timezone | Дата и время |
| `jsonb` | JSON data | JSON-данные |
| `float` | Decimal number | Десятичное число |
| `uuid[]`, `text[]` | Arrays | Массивы |

#### Column Options / Опции колонок

- **Primary Key** — Unique row identifier / Уникальный идентификатор строки
- **Nullable** — Allow NULL values / Разрешить NULL
- **Default** — Default value expression / Значение по умолчанию
- **Unique** — Enforce uniqueness / Уникальность
- **Foreign Key** — Reference to another table / Ссылка на другую таблицу

### DB Map / Карта базы данных

Path: `/projects/:slug/db-map` (plugin: `feature-db-map`)

Interactive 2D visualization of your database schema — tables as nodes, foreign keys as connections. Zoom, search, click to inspect columns and indexes.

Интерактивная 2D-визуализация схемы базы данных — таблицы как узлы, внешние ключи как связи. Зум, поиск, клик для просмотра колонок и индексов.

### Schema History / История схемы

Path: `/projects/:slug/tables/history`

View all schema changes (CREATE, ALTER, DROP) with timestamps and authors.

Просмотр всех изменений схемы с датами и авторами.

---

## 4. Data Management / Управление данными

### Data Browser / Браузер данных

Path: `/projects/:slug/tables/:name/data`

Browse, search, create, edit, and delete records in any table.

Просматривайте, ищите, создавайте, редактируйте и удаляйте записи.

#### Features / Возможности

- **Pagination** — Navigate through large datasets / Навигация по большим данным
- **Search** — Full-text search across all columns / Полнотекстовый поиск
- **Sort** — Click column headers to sort / Сортировка по клику на заголовок
- **Export** — Download as CSV or JSON / Экспорт в CSV или JSON
- **Import** — Upload CSV/JSON files / Импорт CSV/JSON файлов
- **Bulk operations** — Select and delete multiple rows / Массовые операции
- **Inline editing** — Edit cells directly in the table / Редактирование прямо в таблице
- **Test data generation** — Generate fake data for testing / Генерация тестовых данных

### Data Views / Представления данных

| View | Plugin | Description (EN) | Описание (RU) |
|------|--------|-----------------|---------------|
| Table | default | Standard grid view | Стандартная таблица |
| Kanban | `feature-kanban` | Group by status column, drag & drop | Группировка по статусу, перетаскивание |
| Calendar | `feature-calendar` | Records on a date grid | Записи на сетке дат |
| Gallery | `feature-gallery` | Image cards with thumbnails | Карточки с изображениями |

### Record Form / Форма записи

Path: `/projects/:slug/tables/:name/records/new`

Create or edit a single record with a form UI.

Создание или редактирование записи через форму.

---

## 5. API Builder / Конструктор API

### REST Endpoints / REST-эндпоинты

Path: `/projects/:slug/endpoints`

Auto-generate or manually create REST API endpoints for your tables.

Автоматическая генерация или ручное создание REST API эндпоинтов.

#### Supported Operations / Поддерживаемые операции

| Method | Path | Description (EN) | Описание (RU) |
|--------|------|-----------------|---------------|
| GET | `/api/v1/:slug/:table` | List records with pagination | Список записей |
| GET | `/api/v1/:slug/:table/:id` | Get single record | Одна запись |
| POST | `/api/v1/:slug/:table` | Create record | Создать запись |
| PUT | `/api/v1/:slug/:table/:id` | Update record | Обновить запись |
| DELETE | `/api/v1/:slug/:table/:id` | Delete record | Удалить запись |

#### Authentication / Аутентификация

Endpoints support two auth modes:
- **public** — No authentication required / Без аутентификации
- **api_token** — Requires `X-API-Key` header / Требует заголовок `X-API-Key`

### GraphQL

Path: `/projects/:slug/graphql` (plugin: `feature-graphql`)

Auto-generated GraphQL schema from your database tables. Supports queries, mutations, filtering, pagination.

Автоматически генерируемая GraphQL-схема из таблиц. Запросы, мутации, фильтрация, пагинация.

```graphql
{
  users(limit: 10) {
    id
    nickname
    createdAt
  }
}
```

### SDK Generation / Генерация SDK

Path: `/projects/:slug/sdk` (plugin: `feature-sdk`)

Auto-generated client SDKs in three languages:

Автоматическая генерация клиентских SDK на трёх языках:

- **TypeScript** — Full typed client class with methods for each endpoint
- **Python** — Client class using `requests` library
- **cURL** — Copy-paste command examples

### API Documentation / API Документация

Path: `/projects/:slug/api-docs`

Auto-generated OpenAPI/Swagger documentation for all endpoints.

Автоматическая документация OpenAPI/Swagger для всех эндпоинтов.

### API Playground / API Песочница

Path: `/projects/:slug/api-playground` (plugin: `feature-api-playground`)

Interactive API testing environment. Send requests, inspect responses, manage collections.

Интерактивная среда тестирования API. Отправка запросов, просмотр ответов, управление коллекциями.

- HTTP method selector (GET, POST, PUT, PATCH, DELETE)
- Custom headers
- Request body editor (JSON)
- Bearer token authentication
- Response viewer with formatted JSON
- Request history

---

## 6. Authentication & Security / Аутентификация и безопасность

### API Tokens / API-токены

Path: `/projects/:slug/settings/tokens`

Generate API keys for programmatic access. Features:

Генерация API-ключей для программного доступа. Возможности:

- Token prefix for identification / Префикс для идентификации
- Scopes: `read`, `write` / Области: чтение, запись
- Optional expiration date / Опциональная дата истечения
- IP whitelist / Белый список IP
- Revocation / Отзыв

### Invite Keys / Ключи приглашений

Path: `/projects/:slug/settings/invites`

Generate invite codes for adding users to projects.

Генерация кодов приглашений для добавления пользователей.

### Security Settings / Настройки безопасности

Path: `/projects/:slug/settings/security`

Configure security policies for the project.

Настройка политик безопасности проекта.

### WebSocket / Веб-сокеты

Path: `/projects/:slug/websocket` (plugin: `feature-websocket`)

Real-time data subscriptions via WebSocket.

Подписки на данные в реальном времени через WebSocket.

**Connection URL:**
```
ws[s]://worker-host/ws/v1/{project-slug}?token=YOUR_API_KEY
```

**Client Protocol:**
```json
// Subscribe to table changes
{ "action": "subscribe", "channel": "table:users" }

// Receive data change
{ "type": "data_change", "table": "users", "action": "INSERT", "record": { ... } }

// Ping/pong keepalive
{ "action": "ping" }
```

**Limits:**
- Max 100 connections per project / Макс. 100 подключений на проект
- Max 50 channels per client / Макс. 50 каналов на клиента
- Rate limit: 20 messages/sec / Лимит: 20 сообщений/сек

---

## 7. SQL Console & Query Builder / SQL Консоль и конструктор запросов

### SQL Console / SQL-консоль

Path: `/projects/:slug/sql`

Execute raw SQL queries against your project database.

Выполнение SQL-запросов к базе данных проекта.

```sql
SELECT nickname, COUNT(*) as play_count
FROM users
GROUP BY nickname
ORDER BY play_count DESC
LIMIT 10;
```

### Query Builder / Конструктор запросов

Path: `/projects/:slug/query-builder` (plugin: `feature-query-builder`)

Visual query builder — create SELECT, INSERT, UPDATE, DELETE queries without writing SQL.

Визуальный конструктор запросов — SELECT, INSERT, UPDATE, DELETE без написания SQL.

Steps: Table -> Columns -> Joins -> Filters -> Sort -> Limit

---

## 8. Analytics / Аналитика

Path: `/projects/:slug/analytics` (plugin: `feature-analytics`)

Track API usage, performance, and errors.

Отслеживание использования API, производительности и ошибок.

### Metrics (7-day window) / Метрики (окно 7 дней)

| Metric | Description (EN) | Описание (RU) |
|--------|-----------------|---------------|
| Total Requests | Number of API calls | Количество API-запросов |
| Avg Response Time | Mean response duration | Среднее время ответа |
| Error Rate | Percentage of 4xx/5xx responses | Процент ошибок |
| Unique IPs | Distinct client IP addresses | Уникальные IP-адреса |

### Sections / Разделы

- **Top Endpoints** — Most frequently called endpoints with avg response time
- **Slow Requests** — Requests taking > 100ms
- **Request Log** — Full paginated log of all API requests

---

## 9. Plugins / Плагины

DataForge uses a plugin system to enable/disable features per project.

DataForge использует систему плагинов для включения/выключения функций проекта.

Path: `/projects/:slug/settings/plugins`

Three categories / Три категории:

### 9.1 Views / Представления

UI features that add new data visualization modes.

Функции интерфейса, добавляющие новые режимы визуализации данных.

| Plugin | ID | Description (EN) | Описание (RU) |
|--------|-----|-----------------|---------------|
| Dashboards | `feature-dashboards` | Drag-and-drop dashboard builder with charts, counters, and SQL widgets | Конструктор дашбордов с графиками и виджетами |
| Kanban | `feature-kanban` | Kanban board view — drag records between status columns | Канбан-доска — перетаскивание записей |
| Calendar | `feature-calendar` | Calendar view for tables with date columns | Календарное представление |
| Gallery | `feature-gallery` | Card view with image thumbnails | Карточки с изображениями |
| DB Map | `feature-db-map` | Interactive database schema visualization | Визуализация схемы БД |
| Query Builder | `feature-query-builder` | Visual SQL query builder | Визуальный конструктор SQL |
| Analytics | `feature-analytics` | API usage analytics (default: ON) | Аналитика API (вкл. по умолчанию) |
| API Playground | `feature-api-playground` | Interactive API testing environment | Среда тестирования API |
| SDK | `feature-sdk` | Auto-generated client SDKs | Автоматическая генерация SDK |

### 9.2 Modules / Модули

Backend functionality modules.

Модули бэкенд-функционала.

| Plugin | ID | Description (EN) | Описание (RU) |
|--------|-----|-----------------|---------------|
| Cron Jobs | `feature-cron` | Schedule recurring SQL queries (default: ON) | Планирование SQL-запросов по расписанию |
| Webhooks | `feature-webhooks` | HTTP callbacks on data changes | HTTP-колбеки при изменениях данных |
| GraphQL | `feature-graphql` | Auto-generated GraphQL API | Автоматический GraphQL API |
| WebSocket | `feature-websocket` | Real-time data subscriptions | Подписки на данные в реальном времени |
| Backups | `feature-backups` | Database backup and restore (default: ON) | Бэкапы и восстановление БД |

### 9.3 Integrations / Интеграции

External service integrations. Each integration gets its own page in the sidebar when enabled.

Интеграции с внешними сервисами. Каждая интеграция получает свою страницу в сайдбаре при включении.

---

#### 9.3.1 Discord Webhook

Path: `/projects/:slug/integrations/discord`

**Purpose / Назначение:** Send notifications to Discord channels when data changes in your tables.

Отправка уведомлений в Discord при изменении данных.

**Features / Возможности:**
- Multiple webhooks per project / Несколько вебхуков на проект
- Select tables and events (INSERT, UPDATE, DELETE) / Выбор таблиц и событий
- Customizable message template with Discord markdown / Настраиваемый шаблон сообщения
- Embed customization (title, description, color) / Настройка embed
- Variable substitution: `{event}`, `{table}`, `{data.column_name}` / Подстановка переменных
- Conditional rules: send only when conditions match / Условия отправки
- Live preview in Discord style / Живое превью в стиле Discord
- Color presets (auto by event type, custom) / Пресеты цветов
- Auto-record fields display / Автоматические поля записи

**Conditions / Условия:**
| Operator | Description (EN) | Описание (RU) |
|----------|-----------------|---------------|
| `=` | Equals | Равно |
| `!=` | Not equals | Не равно |
| `contains` | Contains substring | Содержит |
| `>`, `>=`, `<`, `<=` | Numeric comparison | Числовое сравнение |
| `is_empty` | Value is empty | Значение пустое |
| `is_not_empty` | Value is not empty | Значение не пустое |

---

#### 9.3.2 Telegram Bot

Path: `/projects/:slug/integrations/telegram`

**Purpose / Назначение:** Send notifications via Telegram Bot API when data changes.

Отправка уведомлений через Telegram Bot API при изменениях данных.

**Features / Возможности:**
- Multiple notifications per project / Несколько уведомлений на проект
- Per-notification Bot Token and Chat ID / Свой токен бота и Chat ID
- Select tables and events / Выбор таблиц и событий
- HTML message template with Telegram formatting / HTML-шаблон с форматированием
- Variable substitution: `{event}`, `{table}`, `{data.*}` / Подстановка переменных
- Conditional rules / Условия отправки
- Auto-record fields with emoji status (green/yellow/red) / Автополя с emoji
- Formatting toolbar (bold, italic, strike, code) / Тулбар форматирования
- Live preview in Telegram style / Превью в стиле Telegram
- Disable link preview option / Отключение превью ссылок

**Telegram HTML Tags / HTML-теги Telegram:**
```html
<b>bold</b>  <i>italic</i>  <s>strikethrough</s>
<code>inline code</code>  <u>underline</u>
```

---

#### 9.3.3 Uptime Monitor / Мониторинг доступности

Path: `/projects/:slug/integrations/uptime`

**Purpose / Назначение:** Monitor HTTP endpoints availability with automatic health checks, logging, and alerts.

Мониторинг доступности HTTP-эндпоинтов с автоматическими проверками, логированием и алертами.

**Features / Возможности:**
- Multiple monitors per project with categories / Несколько мониторов с категориями
- Configurable intervals: 1 min, 5 min, 15 min, 1 hour, 12 hours / Интервалы проверки
- HTTP method: GET, POST, HEAD / HTTP метод
- Expected status code validation / Проверка кода ответа
- Response body substring check / Проверка содержимого ответа
- Configurable timeout (5s, 10s, 30s) / Настраиваемый таймаут
- Auto log retention (1-7 days) / Автоочистка логов
- Uptime bar visualization (24h timeline) / Визуализация аптайма
- Statistics: uptime %, avg/min/max response time / Статистика
- Logs stored in project schema (`uptime_logs` table) / Логи в схеме проекта
- System table protection (cannot delete via UI) / Защита системной таблицы
- Integration with Discord/Telegram via table subscriptions / Интеграция через подписки

**Sidebar Layout:**
- Left panel: monitors grouped by category with status indicators / Мониторы по категориям
- Right panel: selected monitor details, uptime bar, stats, logs / Детали выбранного монитора

**HTTP Status Reasons (auto-generated):**
```
200 OK | 201 Created | 204 No Content
301 Moved Permanently | 302 Found | 304 Not Modified
400 Bad Request | 401 Unauthorized | 403 Forbidden | 404 Not Found
408 Request Timeout | 429 Too Many Requests
500 Internal Server Error | 502 Bad Gateway | 503 Service Unavailable
```

---

#### 9.3.4 S&box Authentication

Path: `/projects/:slug/integrations/sbox-auth`

**Purpose / Назначение:** Authenticate S&box game players via Facepunch token validation. Maps Steam IDs to database records.

Аутентификация игроков S&box через Facepunch API. Маппинг Steam ID в записи БД.

**Features / Возможности:**
- Token validation via Facepunch API / Валидация токенов
- Session-based authentication / Сессионная аутентификация
- Configurable session table and columns / Настраиваемая таблица сессий
- Steam ID mapping / Маппинг Steam ID

---

## 10. System Administration / Администрирование

### Superadmin Panel / Панель суперадмина

Available only to superadmin users. / Доступно только суперадминам.

| Page | Path | Description (EN) | Описание (RU) |
|------|------|-----------------|---------------|
| Nodes | `/system/nodes` | Manage worker nodes | Управление воркер-нодами |
| All Projects | `/system/projects` | View all projects across all users | Все проекты всех пользователей |
| All Users | `/system/users` | Manage all users | Управление пользователями |
| Roles | `/system/roles` | Configure roles and permissions | Роли и разрешения |
| Project Plans | `/system/project-plans` | Manage project quotas and plans | Планы и квоты проектов |
| System Logs | `/system/logs` | View system-wide audit logs | Системный журнал действий |
| Health | `/system/health` | Monitor system health | Мониторинг здоровья системы |
| Errors | `/system/errors` | View and manage error logs | Просмотр ошибок |
| Settings | `/system/settings` | Global system configuration | Глобальные настройки |

### Worker Nodes / Воркер-ноды

DataForge uses a distributed architecture. Projects are assigned to worker nodes that handle database operations and API requests.

DataForge использует распределённую архитектуру. Проекты привязываются к воркер-нодам.

---

## 11. Examples / Примеры

### Example 1: Simple Game Server Backend / Пример 1: Простой бэкенд для игрового сервера

**Scenario / Сценарий:** You're building a game server and need to store player data, leaderboards, and game settings.

Вы строите игровой сервер и нужно хранить данные игроков, таблицы лидеров и настройки.

#### Step 1: Create project / Создание проекта
- Name: `my-game`
- Create tables: `players`, `scores`, `settings`

#### Step 2: Define tables / Определение таблиц

**players:**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| nickname | varchar(50) | |
| steam_id | text | unique |
| level | integer | default: 1 |
| created_at | timestamp | auto |

**scores:**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto |
| player_id | uuid | FK → players.id |
| score | integer | |
| map | varchar(100) | |
| created_at | timestamp | auto |

#### Step 3: Generate API / Генерация API
- Go to API Endpoints → auto-generate for `players` and `scores`
- Set auth to `api_token`
- Create an API token with `read` + `write` scopes

#### Step 4: Use from game / Использование из игры
```typescript
const SDK = new DataForgeClient('df_live_xxx...');

// Register player
await SDK.createPlayers({ nickname: 'Player1', steam_id: '76561198...' });

// Submit score
await SDK.createScores({ player_id: 'uuid...', score: 1500, map: 'de_dust2' });

// Get leaderboard
const top = await SDK.getScores(); // sorted by score desc
```

---

### Example 2: Advanced Monitoring System / Пример 2: Продвинутая система мониторинга

**Scenario / Сценарий:** You need a full monitoring setup for your microservices with alerts, dashboards, and data automation.

Полноценная система мониторинга микросервисов с алертами, дашбордами и автоматизацией.

#### Plugins Used / Используемые плагины:
- **Uptime Monitor** — health checks / Проверки доступности
- **Discord Webhook** — instant alerts / Мгновенные алерты
- **Telegram Bot** — mobile notifications / Мобильные уведомления
- **Webhooks** — external system integration / Интеграция с внешними системами
- **Cron Jobs** — scheduled reports / Отчёты по расписанию
- **Analytics** — API monitoring / Мониторинг API
- **Dashboards** — visual overview / Визуальный обзор
- **WebSocket** — real-time updates / Обновления в реальном времени

#### Step 1: Set up monitors / Настройка мониторов

Enable **Uptime Monitor** plugin. Create monitors with categories:

| Category | Monitor | URL | Interval |
|----------|---------|-----|----------|
| Production | API Gateway | https://api.example.com/health | 1 min |
| Production | Auth Service | https://auth.example.com/ping | 1 min |
| Staging | Staging API | https://staging-api.example.com/health | 5 min |
| External | Stripe API | https://api.stripe.com/v1 | 15 min |

#### Step 2: Set up Discord alerts / Настройка алертов Discord

Enable **Discord Webhook** plugin. Create webhook:
- Tables: `uptime_logs`
- Events: INSERT
- Condition: `is_up` = `false`
- Embed title: `{data.monitor_name} is DOWN`
- Embed description: `URL: {data.url}\nStatus: {data.status_code}\nReason: {data.reason}`
- Color: red

Now you get instant Discord notifications when any service goes down.

Теперь вы получаете мгновенные Discord-уведомления о падении любого сервиса.

#### Step 3: Telegram for mobile / Telegram для мобильных

Enable **Telegram Bot** plugin. Create notification:
- Bot Token from @BotFather
- Tables: `uptime_logs`
- Events: INSERT
- Condition: `is_up` = `false`
- Template:
```html
<b>{data.monitor_name}</b> is <b>DOWN</b>

Status: <code>{data.status_code}</code>
Reason: {data.reason}
URL: {data.url}
```

#### Step 4: Cron job for daily report / Cron-задача для ежедневного отчёта

Enable **Cron Jobs** plugin. Create cron job:
- Schedule: `0 9 * * *` (every day at 9:00 AM)
- SQL:
```sql
SELECT monitor_name,
  COUNT(*) as total_checks,
  COUNT(*) FILTER (WHERE is_up) as up_checks,
  ROUND(100.0 * COUNT(*) FILTER (WHERE is_up) / COUNT(*), 2) as uptime_pct,
  ROUND(AVG(response_time_ms)) as avg_response_ms
FROM uptime_logs
WHERE checked_at >= NOW() - INTERVAL '24 hours'
GROUP BY monitor_name
ORDER BY uptime_pct ASC;
```

#### Step 5: WebSocket for live dashboard / WebSocket для живого дашборда

Enable **WebSocket** plugin. Connect from frontend:
```javascript
const ws = new WebSocket('ws://worker/ws/v1/my-monitoring?token=API_KEY');
ws.onopen = () => {
  ws.send(JSON.stringify({ action: 'subscribe', channel: 'table:uptime_logs' }));
};
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'data_change' && !data.record.is_up) {
    showAlert(`${data.record.monitor_name} is DOWN!`);
  }
};
```

#### Result / Результат:
- Real-time monitoring of all services / Мониторинг всех сервисов в реальном времени
- Instant alerts in Discord and Telegram / Мгновенные алерты
- Daily summary reports via cron / Ежедневные отчёты через cron
- Live dashboard updates via WebSocket / Живые обновления через WebSocket
- Full logs in `uptime_logs` table with 7-day retention / Полные логи с хранением 7 дней
- Historical analytics in the Analytics page / Историческая аналитика

---

## Architecture / Архитектура

```
┌────────────────────────────────────────────────────┐
│                    Frontend (React)                  │
│  Vite + React + TypeScript + Tailwind + shadcn/ui   │
└─────────────────────┬──────────────────────────────┘
                      │ /api/*
┌─────────────────────▼──────────────────────────────┐
│              Control Plane (Fastify)                 │
│  Auth, Projects, Users, Proxy, API Tokens, Quotas   │
└─────────────────────┬──────────────────────────────┘
                      │ proxy
┌─────────────────────▼──────────────────────────────┐
│               Worker Node (Fastify)                  │
│  Data CRUD, Schema, APIs, Webhooks, Cron, Plugins   │
│  GraphQL, WebSocket, Analytics, Integrations        │
├─────────────┬───────────────────┬──────────────────┤
│  PostgreSQL │      Redis        │   Plugin System   │
│  (per-project│  (cache, tokens, │  Discord, Telegram│
│   schemas)  │   sessions)      │  Uptime, S&box    │
└─────────────┴───────────────────┴──────────────────┘
```

---

*DataForge v1.0 — Built with Fastify, React, PostgreSQL, Redis*
