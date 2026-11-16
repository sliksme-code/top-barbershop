# top-barbershop.com — новая версия

Каталог барбершопов: Astro (SSG + SSR) · Directus · PostgreSQL/PostGIS · Meilisearch · imgproxy · Caddy. Всё в `docker-compose.yml`.

| Каталог | Назначение |
|---|---|
| `web/` | Сайт на Astro, `Dockerfile` (сборка падает при ошибках SEO — `npm run check:html`) |
| `Caddyfile`, `deploy/redirects.caddy` | HTTPS, 301/410 со старых URL, отдача `/media/` и `/logos/` по старым путям |
| `directus/` | Расширения CMS (кабинет владельца, модерация, ЮKassa — этап 2) |
| `migration/` | Перенос данных из WordPress |
| `deploy/backup.sh` | Ежедневный бэкап БД и медиа в S3 |
| `.github/workflows/deploy.yml` | Push в `main` → образ в GHCR → деплой на VPS по SSH |

## Сервер
- Timeweb Cloud, `top-barbershop-prod`, 136.234.232.234, Ubuntu 24.04, 2 vCPU / 4 ГБ / 50 ГБ (Новосибирск).
- Пользователь `deploy`, каталог `/opt/top-barbershop`, файл `.env` (шаблон — `.env.example`).

## Секреты GitHub (Settings → Secrets and variables → Actions)
- `VPS_HOST` = 136.234.232.234
- `VPS_SSH_KEY` = приватный ключ деплоя (ed25519)
- Variables: `DEPLOY_ENABLED=true` (включает деплой), `SITE_DOMAIN` (сейчас `new.top-barbershop.com`), `SITE_ENV` (`staging` до переключения)

## Тестовый домен
`new.top-barbershop.com` — закрыт от индексации (robots Disallow + noindex), пока `SITE_ENV=staging`.
