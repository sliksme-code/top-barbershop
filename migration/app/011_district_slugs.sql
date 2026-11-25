-- URL-слаги районов для SEO-страниц /rayon/<город>/<район>/
-- Заполняется скриптом web/scripts/fill-district-slugs.mjs
alter table districts add column if not exists slug text;
create unique index if not exists districts_slug on districts(location_id, slug) where slug is not null;
