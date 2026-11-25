#!/usr/bin/env node
// Синхронизация услуг (актуальные цены) и мастеров из онлайн-записи YClients.
//
// Запуск на сервере (перед этим применить migration/app/010_yclients.sql):
//   cd /opt/top-barbershop && set -a && . ./.env && set +a
//   docker compose exec -T web node scripts/sync-yclients.mjs
//   # или снаружи: DATABASE_URL=postgres://... node scripts/sync-yclients.mjs
//
// Как это работает: из booking_url вида https://nNNNNN.yclients.com берём id
// виджета, через platform.yclients.com находим company_id, затем забираем
// book_services (услуги + цены + категории) и book_staff (мастера).
// API отдаёт данные по гостевому токену виджета записи (публичные данные,
// которые видит любой посетитель формы онлайн-записи).
//
// Параметры:
//   --limit N    максимум барбершопов за прогон (по умолчанию 200)
//   --delay MS   пауза между компаниями (по умолчанию 400)
//   --force      синхронизировать заново даже свежие (иначе — раз в 7 дней)
//   --slug SLUG  только один барбершоп по slug (для отладки)
//   --dry        только показать план, без запросов и записи

import postgres from 'postgres';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]) : a, a), [])
);
const LIMIT = Number(args.limit || 200);
const DELAY = Number(args.delay || 400);
const FORCE = 'force' in args;
const DRY = 'dry' in args;
const ONLY_SLUG = args.slug || null;

// Гостевой токен виджета онлайн-записи YClients (публичный, из фронтенда формы записи)
const TOKEN = process.env.YCLIENTS_GUEST_TOKEN || 'gtcwf654agufy25gsadh';
const API = 'https://platform.yclients.com/api/v1';
const DSN = process.env.DATABASE_URL || process.env.PG_DSN;
if (!DSN) { console.error('Нет DATABASE_URL/PG_DSN'); process.exit(1); }

const sql = postgres(DSN, { max: 2 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, auth) {
  const r = await fetch(`${API}${path}`, {
    headers: auth ? { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' } : { Accept: 'application/json' },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return r.json();
}

try {
  const shops = await sql`
    select b.id, b.slug, b.title, b.booking_url, b.yclients_company_id
    from barbershops b
    where b.status = 'published'
      and b.booking_url ~ 'n[0-9]+\\.yclients\\.com'
      ${FORCE ? sql`` : sql`and (b.yclients_synced_at is null or b.yclients_synced_at < now() - interval '7 days')`}
      ${ONLY_SLUG ? sql`and b.slug = ${ONLY_SLUG}` : sql``}
    order by b.yclients_synced_at nulls first
    limit ${LIMIT}`;
  console.log(`Барбершопов к синхронизации: ${shops.length}`);
  if (DRY) {
    for (const s of shops) console.log(`  ${s.slug}: ${s.booking_url}`);
    process.exit(0);
  }

  let ok = 0, empty = 0, failed = 0;
  for (const s of shops) {
    const m = String(s.booking_url).match(/n(\d+)\.yclients\.com/);
    if (!m) continue;
    const widgetId = m[1];
    try {
      // 1. company_id по id виджета
      const form = await api(`/b2c/channel/widget/booking-form/${widgetId}/`);
      const companyId = form?.company_id || null;
      if (!companyId) {
        await sql`update barbershops set yclients_synced_at = now(), yclients_company_id = null where id = ${s.id}`;
        empty++;
        console.log(`  ${s.slug}: виджет ${widgetId} не найден (закрыт?)`);
        await sleep(DELAY);
        continue;
      }
      // 2. услуги и мастера
      const [svc, staff] = await Promise.all([
        api(`/b2c/booking/availability/book_services/${companyId}?without_seances=1`, true),
        api(`/b2c/booking/availability/book_staff/${companyId}?without_seances=1`, true),
      ]);
      const cats = new Map((svc?.category || []).map((c) => [c.id, c.title]));
      const services = (svc?.services || [])
        .filter((x) => x.active !== 0 && x.title && (x.price_min > 0 || x.price_max > 0))
        .map((x) => ({ ext: x.id, title: String(x.title).trim(), category: cats.get(x.category_id) || null, min: x.price_min || null, max: x.price_max || null }));
      const masters = (Array.isArray(staff) ? staff : [])
        .filter((x) => x.name && !x.fired && !x.hidden)
        .map((x) => ({ ext: x.id, name: String(x.name).trim(), spec: x.specialization || null, rating: x.show_rating ? x.rating || null : null, reviews: x.comments_count || 0, avatar: x.avatar_big || x.avatar || null }));

      await sql.begin(async (t) => {
        await t`delete from yclients_services where barbershop_id = ${s.id}`;
        await t`delete from yclients_staff where barbershop_id = ${s.id}`;
        for (const x of services) {
          await t`insert into yclients_services (barbershop_id, ext_id, title, category, price_min, price_max)
                  values (${s.id}, ${x.ext}, ${x.title}, ${x.category}, ${x.min}, ${x.max})
                  on conflict (barbershop_id, ext_id) do update set title = excluded.title, category = excluded.category,
                    price_min = excluded.price_min, price_max = excluded.price_max, synced_at = now()`;
        }
        for (const x of masters) {
          await t`insert into yclients_staff (barbershop_id, ext_id, name, specialization, rating, reviews, avatar)
                  values (${s.id}, ${x.ext}, ${x.name}, ${x.spec}, ${x.rating}, ${x.reviews}, ${x.avatar})
                  on conflict (barbershop_id, ext_id) do update set name = excluded.name, specialization = excluded.specialization,
                    rating = excluded.rating, reviews = excluded.reviews, avatar = excluded.avatar, synced_at = now()`;
        }
        await t`update barbershops set yclients_synced_at = now(), yclients_company_id = ${companyId} where id = ${s.id}`;
      });
      ok++;
      console.log(`  ${s.slug}: ${services.length} услуг, ${masters.length} мастеров (company ${companyId})`);
    } catch (e) {
      failed++;
      console.error(`  ${s.slug}: ${e.message}`);
      if (/HTTP 4(01|03|29)/.test(e.message)) { console.error('Доступ/лимит — останавливаюсь'); break; }
    }
    await sleep(DELAY);
  }
  console.log(`\nГотово. Обновлено: ${ok}, без виджета: ${empty}, ошибок: ${failed}`);
} finally {
  await sql.end();
}
