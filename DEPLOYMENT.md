# DataForge — Руководство по развёртыванию

## Требования

- Ubuntu 22.04+ / Debian 12+ (или любой Linux с поддержкой Docker)
- Docker 24+ и Docker Compose v2
- Домен с настроенным DNS (A-запись на IP сервера)
- Сервер: минимум 4 ГБ RAM, 2 ядра CPU, 20 ГБ диска
- Root или sudo доступ

---

## Шаг 0: Установка Docker (Debian 12)

Если Docker ещё не установлен на сервере:

```bash
# Обновляем пакеты
sudo apt update && sudo apt upgrade -y


# Устанавливаем зависимости
sudo apt install -y ca-certificates curl gnupg

# Добавляем GPG-ключ Docker
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Добавляем репозиторий Docker
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Устанавливаем Docker Engine + Compose
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Добавляем текущего пользователя в группу docker (чтобы не писать sudo)
sudo usermod -aG docker $USER

# Применяем изменение группы (или перелогиньтесь)
newgrp docker

# Проверяем
docker --version
docker compose version
```

Для **Ubuntu** — замените `debian` на `ubuntu` в строке репозитория.

---

## Быстрый старт

Панель разворачивается из готовых Docker-образов — ничего собирать не нужно.

### 1. Скачиваем конфигурацию

```bash
# Клонируем репо (нужен GitHub токен для приватного репо)
git clone --depth 1 https://github.com/dvernoff/dataforge.git /tmp/df-setup

# Создаём директорию и копируем только конфиги
mkdir -p /var/www/dataforge/config /var/www/dataforge/control-plane
cp /tmp/df-setup/docker-compose.yml /var/www/dataforge/
cp /tmp/df-setup/.env.example /var/www/dataforge/.env
cp /tmp/df-setup/config/postgres-control.conf /var/www/dataforge/config/
cp /tmp/df-setup/config/redis.conf /var/www/dataforge/config/
cp /tmp/df-setup/control-plane/nginx.conf /var/www/dataforge/control-plane/

# Удаляем исходники — они не нужны
rm -rf /tmp/df-setup
cd /var/www/dataforge
```

### 2. Генерируем секреты и настраиваем .env

Все секреты генерируются автоматически одной командой:

```bash
cd /var/www/dataforge

# Генерируем все секреты разом
sed -i "s|^POSTGRES_CONTROL_PASSWORD=.*|POSTGRES_CONTROL_PASSWORD=$(openssl rand -hex 16)|" .env
sed -i "s|^POSTGRES_WORKER_PASSWORD=.*|POSTGRES_WORKER_PASSWORD=$(openssl rand -hex 16)|" .env
sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^SECRETS_ENCRYPTION_KEY=.*|SECRETS_ENCRYPTION_KEY=$(openssl rand -hex 16)|" .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 16)|" .env
sed -i "s|^WORKER_NODE_API_KEY=.*|WORKER_NODE_API_KEY=$(openssl rand -hex 32)|" .env
sed -i "s|^INTERNAL_SECRET=.*|INTERNAL_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(openssl rand -hex 16)|" .env
```

Затем вручную задаём email, пароль и домен:

```bash
nano .env
# Изменить:
#   ADMIN_EMAIL=admin@yourdomain.com
#   ADMIN_PASSWORD=НадёжныйПароль123!
#   CORS_ORIGIN=https://app.yourdomain.com
#   WORKER_CORS_ORIGIN=https://app.yourdomain.com
```

### 3. Логинимся в GitHub Container Registry

Образы CP хранятся в приватном реестре. Нужен GitHub Personal Access Token с правами `read:packages`, `write:packages`.

Создать токен: https://github.com/settings/tokens/new

```bash
docker login ghcr.io -u dvernoff
# Ввести Personal Access Token
```

### 4. Настраиваем файрвол

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 5. Запускаем

```bash
docker compose up -d
```

Docker сам скачает готовые образы из ghcr.io и запустит все сервисы.

echo "CP_FRONTEND_PORT=3000" >> .env
echo "CP_BACKEND_PORT=4000" >> .env

### 6. Проверяем

```bash
docker compose ps
# Все контейнеры должны быть healthy

docker compose logs -f control-backend
# Должно быть: "PostgreSQL connected successfully", "Redis connected successfully"
```

### 7. Настраиваем SSL (см. раздел ниже)

Панель доступна на `http://IP_СЕРВЕРА`. Для HTTPS — см. раздел "SSL/TLS".

---

## Архитектура

```
              Интернет
                 |
          [Файрвол: UFW]
         порты 22, 80, 443
                 |
     Host Nginx (80/443)
         |             |
    /api/* → :4000   /* → :3000
         |             |
    ┌────┴─────────────┴──┐
    │   Docker-сеть        │
    │   (backend)          │
    │                      │
    │  control-backend     │  :4000 ← ghcr.io/dvernoff/dataforge/cp-backend
    │  control-frontend    │  :3000 ← ghcr.io/dvernoff/dataforge/cp-frontend
    │       |              │
    │  postgres-control    │
    │  redis               │
    └──────────────────────┘

    Worker-ноды подключаются отдельно через панель (System > Nodes)
```

Nginx устанавливается на хосте (не в Docker) — вы управляете SSL, доменами и конфигурацией напрямую.
Образы скачиваются из GitHub Container Registry — сборка на сервере не требуется.

---

## Шаг 1: Файрвол (UFW)

### Установка и настройка

```bash
# Установить UFW (если не установлен)
sudo apt update && sudo apt install -y ufw

# Сбросить к дефолтам
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Разрешить SSH (ВАЖНО: сделать первым, чтобы не заблокировать себя)
sudo ufw allow 22/tcp comment 'SSH'

# Разрешить HTTP и HTTPS (для SSL и редиректа)
sudo ufw allow 80/tcp comment 'HTTP'
sudo ufw allow 443/tcp comment 'HTTPS'

# Если Worker API должен быть публично доступен на отдельном порту:
# sudo ufw allow 8080/tcp comment 'Worker API'

# Включить файрвол
sudo ufw enable

# Проверить
sudo ufw status verbose
```

Или одной командой:
```bash
sudo bash scripts/setup-firewall.sh
```

Ожидаемый результат:
```
Status: active
Default: deny (incoming), allow (outgoing)

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere        # SSH
80/tcp                     ALLOW IN    Anywhere        # HTTP
443/tcp                    ALLOW IN    Anywhere        # HTTPS
```

### Что заблокировано (не доступно снаружи)

| Порт | Сервис | Статус |
|------|--------|--------|
| 5432 | PostgreSQL Control | Заблокирован (только внутри Docker) |
| 5433 | PostgreSQL Worker | Заблокирован (только внутри Docker) |
| 6379 | Redis | Заблокирован (только внутри Docker) |
| 4000 | CP Backend | Заблокирован (только внутри Docker) |
| 4001 | Worker Backend | Заблокирован (только внутри Docker) |
| 3000 | Frontend | Заблокирован (только внутри Docker) |

### Совместимость Docker + UFW

Docker по умолчанию обходит UFW, добавляя свои правила iptables. Чтобы это предотвратить:

```bash
# Создать/отредактировать конфиг Docker
sudo nano /etc/docker/daemon.json
```

Добавить:
```json
{
  "iptables": false
}
```

Перезапустить Docker:
```bash
sudo systemctl restart docker
docker compose up -d
```

**Важно:** После этого контейнеры общаются только через Docker-сети. Так как мы используем `expose` (а не `ports`) для всех внутренних сервисов, они остаются недоступны снаружи.

---

## Шаг 2: Домен и DNS

### Настройка DNS

Создайте A-записи в DNS вашего домена:

```
Тип   Имя                 Значение        TTL
A     app.yourdomain.com  IP_СЕРВЕРА      300
A     api.yourdomain.com  IP_СЕРВЕРА      300
```

- `app.yourdomain.com` — панель управления (Control Plane)
- `api.yourdomain.com` — публичный API (Worker Node)

### Обновить .env

```bash
CORS_ORIGIN=https://app.yourdomain.com
WORKER_CORS_ORIGIN=https://app.yourdomain.com
```

---

## Шаг 3: Nginx на хосте

Nginx устанавливается на хосте (не в Docker) — так вы управляете SSL, доменами и конфигурацией напрямую.

### 1. Установить Nginx

```bash
sudo apt update
sudo apt install -y nginx
```

### 2. Создать конфигурацию

```bash
sudo nano /etc/nginx/sites-available/dataforge
```

Вставить (замените `app.yourdomain.com` на ваш домен):

```nginx
server {
    listen 80;
    server_name app.yourdomain.com;

    client_max_body_size 100M;

    # API → backend (:4000)
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    # Скрипты установки
    location /scripts/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Internal API (heartbeat, node registration)
    location /internal/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Frontend → frontend (:3000)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. Активировать сайт

```bash
sudo ln -s /etc/nginx/sites-available/dataforge /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Панель доступна на `http://app.yourdomain.com`.

---

## Шаг 4: SSL-сертификат

### Вариант А: Certbot (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx

sudo certbot --nginx -d app.dataforge.me \
  --non-interactive --agree-tos --email authtern@gmail.com
```

Certbot автоматически:
- Выпустит сертификат
- Обновит nginx-конфиг (добавит `listen 443 ssl`, редирект 80→443)
- Настроит авто-продление

Проверить:
```bash
sudo certbot renew --dry-run
```

### Вариант Б: CDN (Bunny / Cloudflare)

Если домен проксируется через CDN — SSL уже обеспечен на стороне CDN.
Nginx на хосте остаётся на порту 80, CDN терминирует HTTPS.

Настройки CDN:
- Origin URL: `http://IP_СЕРВЕРА:80`
- SSL: Enabled / Force SSL

### Вариант В: Caddy (вместо Nginx)

Если предпочитаете автоматический SSL без настройки:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

```bash
sudo nano /etc/caddy/Caddyfile
```

```
app.yourdomain.com {
    handle /api/* {
        reverse_proxy localhost:4000
    }
    handle /scripts/* {
        reverse_proxy localhost:4000
    }
    handle /internal/* {
        reverse_proxy localhost:4000
    }
    handle {
        reverse_proxy localhost:3000
    }
}
```

```bash
sudo systemctl stop nginx
sudo systemctl disable nginx
sudo systemctl restart caddy
```

Caddy автоматически получает и продлевает SSL.

---

## Шаг 4: Проверка

```bash
# 1. Контейнеры запущены
docker compose ps

# 2. SSL работает
curl -I https://app.yourdomain.com
# Ожидаемый ответ: HTTP/2 200

# 3. API панели
curl https://app.yourdomain.com/api/health
# Ожидаемый ответ: {"status":"healthy","timestamp":"..."}

# 4. API воркера
curl https://api.yourdomain.com/api/health
# Ожидаемый ответ: {"status":"healthy","timestamp":"..."}

# 5. Файрвол
sudo ufw status

# 6. Проверка, что внутренние порты не торчат наружу
nmap -p 3000,4000,4001,5432,5433,6379 IP_СЕРВЕРА
# Все должны быть "filtered" или "closed"
```

---

## Переменные окружения

### Обязательные (система не запустится без них)

#### База данных

| Переменная | Описание | Как сгенерировать |
|------------|----------|-------------------|
| `POSTGRES_CONTROL_PASSWORD` | Пароль БД Control Plane | `openssl rand -hex 16` |
| `POSTGRES_WORKER_PASSWORD` | Пароль БД Worker Node | `openssl rand -hex 16` |

#### Аутентификация

| Переменная | Описание | Как сгенерировать |
|------------|----------|-------------------|
| `JWT_ACCESS_SECRET` | Ключ подписи JWT (access-токены) | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Ключ подписи JWT (refresh-токены) | `openssl rand -hex 32` |
| `SECRETS_ENCRYPTION_KEY` | AES-256 шифрование секретов (мин. 32 символа) | `openssl rand -hex 16` |

#### Межсервисная связь

| Переменная | Описание | Как сгенерировать |
|------------|----------|-------------------|
| `WORKER_NODE_API_KEY` | Общий секрет между CP и Worker | `openssl rand -hex 32` |

#### Первый суперадмин

| Переменная | Описание | Пример |
|------------|----------|--------|
| `ADMIN_EMAIL` | Email первого админа | `admin@yourdomain.com` |
| `ADMIN_PASSWORD` | Пароль первого админа | Надёжный, 12+ символов |

#### CORS / Домен

| Переменная | Описание | Пример |
|------------|----------|--------|
| `CORS_ORIGIN` | URL панели управления | `https://app.yourdomain.com` |

### Опциональные (рекомендуется для продакшена)

| Переменная | По умолчанию | Описание |
|------------|-------------|----------|
| `INTERNAL_SECRET` | _(пусто)_ | Дополнительная авторизация CP-Worker /internal/ маршрутов |
| `REDIS_PASSWORD` | _(пусто)_ | Пароль Redis |
| `ENCRYPTION_KEY` | _(пусто)_ | Ключ шифрования полей |
| `WORKER_CORS_ORIGIN` | `http://localhost` | Разрешённый origin для публичного API |
| `CP_PORT` | `80` | Порт панели на хосте |
| `WORKER_PORT` | `8080` | Порт воркера на хосте |
| `WORKER_NODE_ID` | `worker-1` | ID воркер-ноды |
| `JWT_ACCESS_EXPIRES` | `15m` | Время жизни access-токена |
| `JWT_REFRESH_EXPIRES` | `7d` | Время жизни refresh-токена |
| `ADMIN_NAME` | `Superadmin` | Имя первого админа |
| `ANTHROPIC_API_KEY` | _(пусто)_ | API-ключ Anthropic для AI-функций |

---

## База данных

### Миграции

Миграции запускаются автоматически при старте контейнера через `entrypoint.sh`.
Если миграция упадёт, контейнер завершится с ошибкой.

Запустить вручную:

```bash
docker compose exec control-backend npx knex migrate:latest --knexfile knexfile.ts
docker compose exec worker-backend npx knex migrate:latest --knexfile knexfile.ts
```

### Бэкапы

```bash
# Ручной бэкап
docker compose exec -T postgres-control pg_dump -U dataforge dataforge_control | gzip > backup_control_$(date +%Y%m%d).sql.gz
docker compose exec -T postgres-worker pg_dump -U dataforge dataforge_worker | gzip > backup_worker_$(date +%Y%m%d).sql.gz
```

Автоматические ежедневные бэкапы (добавить в `crontab -e`):

```cron
0 3 * * * cd /opt/dataforge && docker compose exec -T postgres-control pg_dump -U dataforge dataforge_control | gzip > /opt/backups/control_$(date +\%Y\%m\%d).sql.gz
0 3 * * * cd /opt/dataforge && docker compose exec -T postgres-worker pg_dump -U dataforge dataforge_worker | gzip > /opt/backups/worker_$(date +\%Y\%m\%d).sql.gz
0 4 * * * find /opt/backups -name "*.sql.gz" -mtime +30 -delete
```

**Примечание:** DataForge также имеет встроенные бэкапы на уровне проектов с настраиваемым сроком хранения (по умолчанию 14 дней). Настраивается в System > Global Settings > Data Retention.

### Восстановление из бэкапа

```bash
docker compose stop control-backend worker-backend
gunzip -c backup_control_20240101.sql.gz | docker compose exec -T postgres-control psql -U dataforge dataforge_control
gunzip -c backup_worker_20240101.sql.gz | docker compose exec -T postgres-worker psql -U dataforge dataforge_worker
docker compose up -d
```

---

## Публикация и обновление

### Структура репозиториев

Проект использует три Git-репозитория:

| Remote | Репозиторий | Что содержит |
|--------|------------|-------------|
| `origin` | `dvernoff/dataforge` | Основной приватный репо (весь проект) |
| `worker` | `dvernoff/dataforge-worker` | Публичный Worker Node (subtree из `worker-node/`) |
| `site` | `dvernoff/dataforge-site` | Сайт документации (subtree из `dataforge-site/`) |

### 1. Обычный push (основной репо)

```bash
# Закоммитить изменения
git add -A
git commit -m "Описание изменений"

# Запушить в основной приватный репо
git push origin main
```

### 2. Обновить публичный Worker (subtree push)

Одна команда — автоматически инкрементирует версию и пушит:

```bash
# Linux / macOS / Git Bash
bash scripts/publish-worker.sh

# Windows (PowerShell) — через Git Bash
& "C:\Program Files\Git\bin\bash.exe" -c "sed -i 's/\r$//' scripts/publish-worker.sh && bash scripts/publish-worker.sh"
```

Автоматически: `v1.0.0` → `v1.0.1` → `v1.0.2` ...

Скрипт сам:
- Находит последний тег (v1.0.X)
- Инкрементирует patch-версию
- Делает subtree split + orphan commit
- Force push в публичный репо
- Создаёт и пушит тег → Actions соберёт Docker-образ + GitHub Release

### 3. Обновить сайт (subtree push)

```bash
git subtree push --prefix=dataforge-site site main
```

Или через split:
```bash
git subtree split --prefix=dataforge-site -b site-split
git push site site-split:main --force
git branch -D site-split
```

### 4. Полный цикл публикации (новая версия)

```bash
# 1. Коммит
git add -A
git commit -m "v1.2.0 — описание"

# 2. Push основного репо
git push origin main

# 3. Создать тег — Actions автоматически соберёт Docker-образы CP
git tag v1.2.0
git push origin v1.2.0
# Ждём ~3-5 мин пока Actions соберёт образы в ghcr.io

# 4. Обновить публичный Worker (subtree)
git subtree split --prefix=worker-node -b worker-tmp
git checkout worker-tmp && git checkout --orphan worker-push
git commit -m "DataForge Worker Node v1.2.0"
git push worker worker-push:main --force
git tag v1.2.0 && git push worker v1.2.0
git checkout main && git branch -D worker-tmp worker-push

# 5. Обновить сайт (если менялся)
git subtree push --prefix=dataforge-site site main
```

### 5. Обновление на сервере (продакшен)

Сборка на сервере не нужна — образы скачиваются готовые:

```bash
ssh user@server
cd /var/www/dataforge

# Скачать новые образы
docker compose pull

# Перезапустить — миграции выполнятся автоматически
docker compose up -d

# Проверить логи
docker compose logs -f control-backend
```

Если нужно обновить конфигурацию (nginx.conf и т.д.):
```bash
# Скачать обновлённые конфиги
curl -fsSL https://raw.githubusercontent.com/dvernoff/dataforge/main/control-plane/nginx.conf -o control-plane/nginx.conf
docker compose restart nginx-control
```

---

## Мониторинг

### Health-эндпоинты

```bash
curl https://app.yourdomain.com/api/health
curl https://api.yourdomain.com/api/health
```

### Логи

```bash
docker compose logs -f                           # Все сервисы
docker compose logs -f control-backend            # CP бэкенд
docker compose logs -f worker-backend             # Воркер
docker compose logs --tail 100 control-backend    # Последние 100 строк
```

### Ресурсы

```bash
docker stats
```

---

## Масштабирование (добавление воркеров)

Чтобы добавить воркер на другом сервере:

1. Развернуть `worker-backend` + `postgres-worker` + `redis` на новом сервере
2. Настроить файрвол на новом сервере (те же правила UFW)
3. Указать `CONTROL_PLANE_URL` на адрес основного CP
4. Указать те же `WORKER_NODE_API_KEY` и `INTERNAL_SECRET`
5. Зарегистрировать ноду в панели: System > Nodes

---

## Чек-лист безопасности

Перед запуском в продакшен:

- [ ] Все секреты в `.env` уникальные, случайно сгенерированные
- [ ] `ADMIN_PASSWORD` надёжный (12+ символов)
- [ ] `CORS_ORIGIN` указывает на ваш домен (не `localhost`)
- [ ] SSL/TLS настроен и работает (только HTTPS)
- [ ] HTTP редиректит на HTTPS
- [ ] `.env` НЕ закоммичен в git (проверить `.gitignore`)
- [ ] UFW включён: открыты только порты 22, 80, 443
- [ ] Docker iptables отключён (`/etc/docker/daemon.json`)
- [ ] Порты БД (5432) НЕ торчат наружу
- [ ] Порт Redis (6379) НЕ торчит наружу
- [ ] Порты бэкендов (4000, 4001, 3000) НЕ торчат наружу
- [ ] `REDIS_PASSWORD` задан
- [ ] `INTERNAL_SECRET` задан
- [ ] Сканирование портов подтверждает: внутренние порты не видны
- [ ] Регулярные бэкапы настроены и протестированы
- [ ] Процедура восстановления из бэкапа протестирована
- [ ] Автоматическое продление SSL работает (`certbot renew --dry-run`)

---

## Решение проблем

### Контейнер не запускается

```bash
docker compose logs control-backend 2>&1 | head -50
# Частая причина: не задана переменная → "Set POSTGRES_CONTROL_PASSWORD in .env"
```

### БД отказывает в подключении

```bash
docker compose ps postgres-control
# Дождаться healthcheck, затем перезапустить бэкенды
docker compose restart control-backend worker-backend
```

### Воркер не синхронизирует проекты

```bash
docker compose logs worker-backend 2>&1 | grep -i "sync\|internal\|403\|401"
# Проверить, что WORKER_NODE_API_KEY совпадает в CP и Worker
# Проверить, что INTERNAL_SECRET совпадает (если задан)
```

### Ошибки миграций

```bash
docker compose exec control-backend npx knex migrate:status --knexfile knexfile.ts
docker compose exec control-backend npx knex migrate:rollback --knexfile knexfile.ts
```

### Проблемы с SSL

```bash
# Статус сертификатов
sudo certbot certificates

# Принудительное продление
sudo certbot renew --force-renewal

# Проверка конфига Nginx
sudo nginx -t
sudo systemctl reload nginx
```

### Заблокировал себя после настройки файрвола

```bash
# Зайти через консоль облачного провайдера и выполнить:
sudo ufw allow 22/tcp
sudo ufw enable
```

### Проверка, что порты не утекают

```bash
# С другой машины:
nmap -p 1-65535 IP_СЕРВЕРА

# Должны быть открыты только 22, 80, 443
# Всё остальное — filtered/closed
```
