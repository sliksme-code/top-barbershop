#!/usr/bin/env node
// Заполнение районов городов обратным геокодированием координат барбершопов.
//
// Запуск на сервере (перед этим применить migration/app/009_districts.sql):
//   cd /opt/top-barbershop && set -a && . ./.env && set +a
//   docker compose exec -T web node scripts/fill-districts.mjs --cities 30 --limit 500
//   # или снаружи: DATABASE_URL=postgres://... node scripts/fill-districts.mjs
//
// Ключ: YANDEX_GEOCODER_KEY, иначе YANDEX_MAPS_KEY. Ключ должен быть активирован
// для «API Геокодера» (HTTP) в кабинете developer.tech.yandex.ru — у бесплатного
// тарифа лимит 1000 запросов/сутки, поэтому скрипт дозирует: --limit за прогон.
//
// Параметры:
//   --cities N   сколько топ-городов по числу барбершопов брать (по умолчанию 30)
//   --limit N    максимум запросов к геокодеру за прогон (по умолчанию 500)
//   --delay MS   пауза между запросами (по умолчанию 220)
//   --dry        только показать план, без запросов и записи
//
// Барбершопы, по которым геокодер не нашёл район, остаются с district_id = null
// и будут повторно обходиться при следующих запусках.

import postgres from 'postgres';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]) : a, a), [])
);
const CITIES = Number(args.cities || 30);
const LIMIT = Number(args.limit || 500);
const DELAY = Number(args.delay || 220);
const DRY = 'dry' in args;

const KEY = process.env.YANDEX_GEOCODER_KEY || process.env.YANDEX_MAPS_KEY;
const DSN = process.env.DATABASE_URL || process.env.PG_DSN;
if (!KEY) { console.error('Нет YANDEX_GEOCODER_KEY/YANDEX_MAPS_KEY'); process.exit(1); }
if (!DSN) { console.error('Нет DATABASE_URL/PG_DSN'); process.exit(1); }

const sql = postgres(DSN, { max: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const norm = (s) =>
  s.replace(/^район\s+/i, '').replace(/\s+район$/i, '').replace(/^микрорайон\s+/i, '').trim();

async function geocode(lng, lat) {
  const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${KEY}&format=json&kind=district&results=1&geocode=${lng},${lat}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const fm = j?.response?.GeoObjectCollection?.featureMember || [];
  const name = fm[0]?.GeoObject?.name;
  return name ? norm(name) : null;
}

try {
  const cities = await sql`
    select l.id, l.name, count(b.id)::int n
    from locations l join barbershops b on b.location_id = l.id
      and b.status = 'published' and b.district_id is null and b.lat is not null and b.lng is not null
    group by l.id order by n desc limit ${CITIES}`;
  console.log(`Городов к обработке: ${cities.length}`);
  if (DRY) {
    for (const c of cities) console.log(`  ${c.name}: ${c.n} без района`);
    process.exit(0);
  }

  let used = 0, done = 0, empty = 0, failed = 0;
  for (const city of cities) {
    if (used >= LIMIT) break;
    const shops = await sql`
      select b.id, b.lat, b.lng from barbershops b
      where b.location_id = ${city.id} and b.status = 'published'
        and b.district_id is null and b.lat is not null and b.lng is not null
      limit ${LIMIT - used}`;
    console.log(`\n${city.name}: ${shops.length} к обработке`);
    for (const s of shops) {
      if (used >= LIMIT) break;
      used++;
      try {
        const district = await geocode(s.lng, s.lat);
        if (district) {
          await sql`
            with d as (
              insert into districts (location_id, name) values (${city.id}, ${district})
              on conflict (location_id, name) do update set name = excluded.name
              returning id
            )
            update barbershops set district_id = (select id from d) where id = ${s.id}`;
          done++;
        } else {
          empty++;
        }
      } catch (e) {
        failed++;
        console.error(`  #${s.id}: ${e.message}`);
        if (/HTTP 4(03|29)/.test(e.message)) { console.error('Лимит/доступ ключа — останавливаюсь'); used = LIMIT; break; }
      }
      if (done % 50 === 0 && done > 0) console.log(`  …${done} записано`);
      await sleep(DELAY);
    }
  }
  console.log(`\nГотово. Запросов: ${used}, записано: ${done}, без района: ${empty}, ошибок: ${failed}`);
} finally {
  await sql.end();
}
