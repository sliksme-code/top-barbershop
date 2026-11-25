#!/usr/bin/env node
// Проставляет URL-слаги районам (таблица districts) для страниц /rayon/...
//
// Запуск на сервере (перед этим применить migration/app/011_district_slugs.sql):
//   cd /opt/top-barbershop && set -a && . ./.env && set +a
//   docker compose exec -T web node scripts/fill-district-slugs.mjs
//
// Слаг уникален внутри города: при совпадении добавляется суффикс -2, -3…
// Идемпотентен: обрабатывает только районы без слага.

import postgres from 'postgres';

const DSN = process.env.DATABASE_URL || process.env.PG_DSN;
if (!DSN) { console.error('Нет DATABASE_URL/PG_DSN'); process.exit(1); }
const sql = postgres(DSN, { max: 2 });

const TR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
const slugify = (name) =>
  name.toLowerCase().split('').map((ch) => TR[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '') || 'rayon';

try {
  const rows = await sql`select id, location_id, name from districts where slug is null order by location_id, id`;
  console.log(`Районов без слага: ${rows.length}`);
  let done = 0;
  for (const d of rows) {
    const base = slugify(d.name);
    let slug = base;
    for (let i = 2; ; i++) {
      const [x] = await sql`select 1 from districts where location_id = ${d.location_id} and slug = ${slug} and id <> ${d.id}`;
      if (!x) break;
      slug = `${base}-${i}`;
    }
    await sql`update districts set slug = ${slug} where id = ${d.id}`;
    done++;
  }
  console.log(`Готово: ${done}`);
} finally {
  await sql.end();
}
