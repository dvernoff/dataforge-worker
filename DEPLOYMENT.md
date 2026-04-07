# DataForge -- Руководство по развёртыванию

## Архитектура

DataForge состоит из трёх компонентов:

- **Control Plane (CP)** -- панель управления (backend + frontend)
- **Worker Node** -- обработчик данных, может быть несколько штук
- **База данных + Redis** -- у каждого компонента своя PostgreSQL, Redis общий

```
[Пользователь] --> [CP Frontend :80] --> [CP Backend :4000] --> [Worker Node :4001]
                                              |                       |
                                         [PostgreSQL CP]         [PostgreSQL Worker]
                                              |                       |
                                              +------- [Redis] -------+
```

---

## 1. Развёртывание Control Plane (VDS #1)

### Требования

- Docker + Docker Compose v2
- 2+ GB RAM, 2+ CPU
- Открытые порты: 80 (HTTP), 443 (HTTPS, опционально)

### Установка

```bash
# Клонируем репозиторий
git clone https://github.com/YOUR_ORG/dataforge.git
cd dataforge

# Создаём .env файл
cp .env.example .env
# Редактируем .env -- ОБЯЗАТЕЛЬНО меняем:
#   JWT_ACCESS_SECRET, JWT_REFRESH_SECRET -- случайные строки (openssl rand -hex 32)
#   ADMIN_PASSWORD -- пароль суперадмина
#   SECRETS_ENCRYPTION_KEY -- ключ шифрования (openssl rand -hex 32)
#   WORKER_NODE_API_KEY -- ключ для локального воркера (openssl rand -hex 32)
#   CORS_ORIGIN -- домен фронтенда (https://panel.example.com)

# Запускаем
docker compose up -d

# Запускаем миграции (только первый раз)
docker compose --profile migrate up migrate-control-plane migrate-worker
```

### Проверка

```bash
# Health check Control Plane
curl http://localhost:4000/api/health
# Ожидаемый ответ: {"status":"ok","service":"dataforge-control-plane",...}

# Health check Worker
curl http://localhost:4001/api/health
# Ожидаемый ответ: {"status":"healthy",...}

# Фронтенд
curl -I http://localhost:80
```

### Доступ

- Панель: `http://YOUR_IP:80`
- Логин: `admin@dataforge.local` / пароль из `.env` (`ADMIN_PASSWORD`)

---

## 2. Добавление удалённого Worker Node (VDS #2, #3, ...)

Worker-ноды устанавливаются автоматически через скрипт, который генерируется в панели.

### Шаг 1: Создать ноду в панели

1. Войти в панель как суперадмин или обычный пользователь
2. Перейти в **Настройки > Мои ноды** (или **Система > Worker Ноды** для суперадмина)
3. Нажать **"Добавить ноду"**
4. Указать имя и регион
5. Скопировать команду установки

### Шаг 2: Запустить на сервере

**Linux / macOS:**
```bash
curl -fsSL https://panel.example.com/scripts/install-worker.sh | bash -s -- --token=ТОКЕН --cp=https://panel.example.com
```

**Windows (PowerShell):**
```powershell
irm https://panel.example.com/scripts/install-worker.ps1 -OutFile install-worker.ps1
.\install-worker.ps1 -Token "ТОКЕН" -CpUrl "https://panel.example.com"
```

Скрипт автоматически:
- Устанавливает Docker-контейнеры (PostgreSQL, Redis, Worker, Watchtower)
- Регистрирует ноду в Control Plane
- Генерирует все пароли и ключи
- Запускает сервисы

### Шаг 3: Проверить

В панели нода должна появиться со статусом **"Online"** в течение 30 секунд.

```bash
# На сервере воркера:
curl http://localhost:4001/api/health
```

### Требования к серверу воркера

- Docker + Docker Compose v2
- 1+ GB RAM, 1+ CPU (зависит от нагрузки)
- Открытый порт 4001 (или другой, указанный в конфиге)
- Доступ к Control Plane по сети

---

## 3. Обновление

### Обновление Control Plane

```bash
cd /path/to/dataforge

# Остановить сервисы
docker compose down

# Получить обновления
git pull origin main

# Пересобрать и запустить
docker compose up -d --build

# Миграции (если есть новые)
docker compose --profile migrate up migrate-control-plane migrate-worker
```

### Обновление Worker Node (через панель)

1. Войти в панель
2. Перейти в **Настройки > Мои ноды**
3. Нажать кнопку **"Обновить"** рядом с нодой
4. Дождаться, пока статус вернётся в **"Online"** (обычно 1-2 минуты)

Что происходит при обновлении:
- Control Plane отправляет команду обновления на воркер
- Воркер передаёт запрос Watchtower
- Watchtower скачивает новый Docker-образ из реестра
- Старый контейнер останавливается (graceful shutdown, 30 секунд)
- Новый контейнер запускается
- Автоматически выполняются миграции базы данных
- Воркер отправляет heartbeat с новой версией
- В панели обновляется версия

### Обновление Worker Node (вручную, через SSH)

```bash
cd ~/dataforge-worker

# Скачать новый образ
docker compose pull worker

# Перезапустить
docker compose up -d worker
```

### Обновление Worker Node (автоматически)

Watchtower проверяет наличие обновлений раз в 24 часа.
Если в реестре появился новый образ, он автоматически обновит воркер.

---

## 4. Резервное копирование

### Control Plane

```bash
# Бэкап базы данных CP
docker exec df-postgres-control pg_dump -U dataforge dataforge_control > backup_cp_$(date +%Y%m%d).sql

# Бэкап базы данных Worker (локального)
docker exec df-postgres-worker pg_dump -U dataforge dataforge_worker > backup_worker_$(date +%Y%m%d).sql
```

### Worker Node (удалённый)

```bash
cd ~/dataforge-worker

# Бэкап базы данных
docker compose exec postgres pg_dump -U dataforge dataforge_worker > backup_$(date +%Y%m%d).sql
```

### Восстановление

```bash
# Восстановить бэкап CP
cat backup_cp_20260407.sql | docker exec -i df-postgres-control psql -U dataforge dataforge_control

# Восстановить бэкап Worker
cat backup_worker_20260407.sql | docker exec -i df-postgres-worker psql -U dataforge dataforge_worker
```

---

## 5. Мониторинг

### Health-эндпоинты

| Компонент | URL | Описание |
|-----------|-----|----------|
| CP Backend | `GET /api/health` | Базовый статус |
| CP Backend | `GET /api/health/detailed` | CPU, RAM, диск, статус нод (суперадмин) |
| Worker | `GET /api/health` | Статус, БД, Redis, метрики |

### Heartbeat

Каждый воркер отправляет heartbeat в CP каждые **30 секунд** с метриками:
- CPU, RAM, диск
- Текущая версия
- Количество подключений

Если heartbeat не приходит более 2 минут, нода считается **Offline**.

---

## 6. Структура файлов

### Control Plane (основной сервер)

```
/path/to/dataforge/
  .env                          # Переменные окружения
  docker-compose.yml            # Production compose
  docker-compose.dev.yml        # Development compose
  control-plane/
    backend/                    # CP Backend (Fastify)
    frontend/                   # CP Frontend (React + Vite)
  worker-node/
    backend/                    # Worker Backend (Fastify)
```

### Worker Node (удалённый сервер)

```
~/dataforge-worker/
  .env                          # Автогенерируется при установке
  docker-compose.yml            # Автогенерируется при установке
```

---

## 7. Переменные окружения

### Control Plane (.env)

| Переменная | Описание | Обязательно |
|-----------|----------|:-----------:|
| `JWT_ACCESS_SECRET` | Секрет для access-токенов | Да |
| `JWT_REFRESH_SECRET` | Секрет для refresh-токенов | Да |
| `ADMIN_EMAIL` | Email суперадмина | Да |
| `ADMIN_PASSWORD` | Пароль суперадмина | Да |
| `SECRETS_ENCRYPTION_KEY` | Ключ шифрования секретов | Да |
| `WORKER_NODE_API_KEY` | Ключ локального воркера | Да |
| `CORS_ORIGIN` | Разрешённые домены | Да |

### Worker Node (.env)

| Переменная | Описание | Обязательно |
|-----------|----------|:-----------:|
| `DATABASE_URL` | URL PostgreSQL | Да |
| `REDIS_URL` | URL Redis | Да |
| `NODE_API_KEY` | Ключ авторизации (генерируется при установке) | Да |
| `CONTROL_PLANE_URL` | URL панели управления | Да |
| `WATCHTOWER_TOKEN` | Токен для Watchtower API (генерируется при установке) | Да |
| `NODE_ID` | Идентификатор ноды | Нет |
| `PORT` | Порт (по умолчанию 4001) | Нет |

---

## 8. Устранение проблем

### Нода не подключается

```bash
# Проверить логи воркера
docker compose logs -f worker

# Проверить доступность CP с сервера воркера
curl https://panel.example.com/api/health

# Проверить, что порт 4001 открыт
curl http://WORKER_IP:4001/api/health
```

### Обновление зависло

```bash
# Проверить статус Watchtower
docker compose logs -f watchtower

# Принудительно обновить вручную
docker compose pull worker
docker compose up -d worker
```

### Миграции не прошли

```bash
# Проверить логи
docker compose logs worker | grep -i migrat

# Запустить миграции вручную (dev-режим)
docker compose --profile migrate up migrate-worker

# Откатить последнюю миграцию
docker compose exec worker npx knex migrate:rollback
```

### Сброс пароля суперадмина

```bash
# Перезапустить CP с новым паролем в .env
# Отредактировать ADMIN_PASSWORD в .env
docker compose restart control-backend
```

---

## 9. Публикация обновлений в GitHub

### Процесс разработки

```bash
# 1. Внести изменения в код
# 2. Проверить локально
docker compose -f docker-compose.dev.yml up -d --build

# 3. Закоммитить изменения
git add -A
git commit -m "Описание изменений"

# 4. Отправить в GitHub
git push origin main
```

После пуша в `main` автоматически:
- Запускается CI (проверка типов всех компонентов)
- Собираются Docker-образы с тегом `latest` и пушатся в `ghcr.io`

### Выпуск новой версии (релиз)

```bash
# 1. Убедиться что main актуален
git checkout main
git pull origin main

# 2. Создать тег версии
git tag v1.2.0

# 3. Отправить тег в GitHub
git push origin v1.2.0
```

После пуша тега автоматически:
- Собираются Docker-образы с тегом версии (`v1.2.0`) и `latest`
- Создаётся GitHub Release с автоматическими release notes
- Образы доступны для обновления воркеров

**Собираются 3 образа:**

| Образ | Описание |
|-------|----------|
| `ghcr.io/YOUR_ORG/dataforge/cp-backend:v1.2.0` | CP Backend |
| `ghcr.io/YOUR_ORG/dataforge/cp-frontend:v1.2.0` | CP Frontend |
| `ghcr.io/YOUR_ORG/dataforge/worker:v1.2.0` | Worker Node |

### Обновление только Worker (без CP)

Если изменения затрагивают только воркер:

```bash
# Те же шаги — тег выпускает все 3 образа
# Но обновлять на серверах нужно только воркер:

# На серверах воркеров (вручную):
docker compose pull worker
docker compose up -d worker

# Или через панель — кнопка "Обновить"
```

### Обновление только Control Plane (без воркеров)

```bash
# На сервере CP:
cd /path/to/dataforge
git pull origin main
docker compose up -d --build control-backend control-frontend

# Миграции (если есть новые):
docker compose --profile migrate up migrate-control-plane
```

### Семантическое версионирование

Рекомендуемый формат версий:
- `v1.0.0` → `v1.0.1` — баг-фиксы, мелкие исправления
- `v1.0.0` → `v1.1.0` — новые функции, обратно совместимые
- `v1.0.0` → `v2.0.0` — ломающие изменения (новые миграции, изменение API)

### Проверка перед релизом

```bash
# 1. Запустить dev-среду с нуля
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml --profile migrate up migrate-control-plane migrate-worker

# 2. Проверить health
curl http://localhost:4000/api/health
curl http://localhost:4001/api/health

# 3. Открыть панель и проверить функциональность
# http://localhost:3000

# 4. Если всё работает — создать тег
git tag v1.2.0
git push origin v1.2.0
```

---

## 10. Локальная разработка (dev-режим)

### Запуск с нуля

```bash
# 1. Клонировать репозиторий
git clone https://github.com/YOUR_ORG/dataforge.git
cd dataforge

# 2. Запустить все сервисы
docker compose -f docker-compose.dev.yml up -d

# 3. Выполнить миграции и создать superadmin + локальную ноду
docker compose -f docker-compose.dev.yml --profile migrate up migrate-control-plane migrate-worker

# 4. Перезапустить сервисы (чтобы подхватили БД)
docker compose -f docker-compose.dev.yml restart control-plane worker

# 5. Готово!
# Панель:  http://localhost:3000
# CP API:  http://localhost:4000
# Worker:  http://localhost:4001
# Логин:   admin@dataforge.local / Admin123!@#
```

### Hot-reload

Все сервисы в dev-режиме работают с hot-reload:
- Изменения в `control-plane/backend/` → CP перезапускается автоматически
- Изменения в `worker-node/backend/` → Worker перезапускается автоматически
- Изменения в `control-plane/frontend/` → Vite HMR обновляет браузер

### Полезные команды

```bash
# Логи всех сервисов
docker compose -f docker-compose.dev.yml logs -f

# Логи конкретного сервиса
docker compose -f docker-compose.dev.yml logs -f worker

# Перезапуск одного сервиса
docker compose -f docker-compose.dev.yml restart worker

# Полная остановка с удалением данных
docker compose -f docker-compose.dev.yml down -v

# Остановка без удаления данных
docker compose -f docker-compose.dev.yml down
```
