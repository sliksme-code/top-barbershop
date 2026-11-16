# Перенос данных WordPress → Directus/Postgres

Источник: дамп `untitl_topbs_20260716.sql` (лежит в карантине на старом хостинге, вне веб-корня) — заменить свежим дампом перед финальным переносом.

Шаги (скрипты добавляются по мере работы):
1. `docker run -d --name wp-mysql -e MYSQL_ROOT_PASSWORD=... mysql:5.7` и импорт дампа — изолированно, без сети наружу.
2. `extract.py` — выгрузка в JSON: barbershops (CPT listing + мета Inventor), locations, metro, chains, collections, posts, categories, comments, schools, vacancies, pages, users (с хэшами phpass), reviews, favorites, claims, packages, SEO-мета AIOSEO.
3. `clean.py` — чистка HTML статей (скрипты, iframe, внешние ссылки по белому списку), спам-отзывы, служебные страницы.
4. `load_directus.py` — загрузка в Directus через API, перенос файлов `wp-content/uploads` → том `media` с сохранением путей `/media/YYYY/MM/...`.
5. `build_redirects.py` — `deploy/redirects.caddy` (301/410) + отчёт сверки URL: каждый URL из старого sitemap → 200 или 301.
6. `verify.py` — сверка количеств и выборочно 50 карточек поле-в-поле.

Решения владельца (16.11.2026): пароли — бесшовная проверка старого phpass-хэша при первом входе; закрытые барбершопы — скрыть из каталога, страница остаётся с плашкой «Закрыт»; мусорные страницы — 301.
