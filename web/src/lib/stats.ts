import { createHash } from 'node:crypto';
import { sql } from './db';

// Статистика карточек: события копятся в памяти и раз в 30 секунд одним запросом пишутся в shop_stats.
// Каждое событие считаем один раз на посетителя (IP + браузер) в сутки — повторные обновления страницы не накручивают цифры.
export const KINDS = ['impressions', 'views', 'booking', 'phone', 'site', 'social'] as const;
export type Kind = (typeof KINDS)[number];
const ALIAS: Record<string, Kind> = { imp: 'impressions', view: 'views', booking: 'booking', phone: 'phone', site: 'site', social: 'social' };
export const BOT = /bot|crawl|spider|slurp|yandex(?!browser)|googleother|bingpreview|headless|lighthouse|pagespeed|preview|facebookexternalhit|vkshare|telegram|whatsapp|curl|wget|python|node-fetch|axios|go-http/i;

const g = globalThis as any;
const st: { day: string; seen: Set<string>; buf: Map<string, number> } = (g.__tbStats ||= { day: '', seen: new Set(), buf: new Map() });
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // сутки по Москве

export function track(kindRaw: string, ids: number[], visitor: string) {
  const kind = ALIAS[kindRaw];
  if (!kind) return 0;
  const d = today();
  if (st.day !== d) { st.day = d; st.seen.clear(); }
  const v = createHash('sha1').update(visitor).digest('base64url').slice(0, 12);
  let n = 0;
  for (const id of ids) {
    const key = `${v}|${kind}|${id}`;
    if (st.seen.has(key)) continue;
    st.seen.add(key);
    const b = `${id}|${d}|${kind}`;
    st.buf.set(b, (st.buf.get(b) || 0) + 1);
    n++;
  }
  if (st.seen.size > 500_000) st.seen.clear(); // защита памяти
  return n;
}

export async function flush() {
  if (!st.buf.size) return;
  const rows = [...st.buf.entries()];
  st.buf.clear();
  const agg = new Map<string, Record<Kind, number>>();
  for (const [k, n] of rows) {
    const [id, day, kind] = k.split('|');
    const key = `${id}|${day}`;
    const r = agg.get(key) || { impressions: 0, views: 0, booking: 0, phone: 0, site: 0, social: 0 };
    r[kind as Kind] += n;
    agg.set(key, r);
  }
  const list = [...agg.entries()].map(([k, r]) => { const [id, day] = k.split('|'); return { id: Number(id), day, ...r }; });
  try {
    await sql`insert into shop_stats (barbershop_id, day, impressions, views, booking, phone, site, social)
      select x.id, x.day::date, x.impressions, x.views, x.booking, x.phone, x.site, x.social
      from jsonb_to_recordset(${sql.json(list)}) as x(id int, day text, impressions int, views int, booking int, phone int, site int, social int)
      where exists (select 1 from barbershops b where b.id = x.id)
      on conflict (barbershop_id, day) do update set
        impressions = shop_stats.impressions + excluded.impressions, views = shop_stats.views + excluded.views,
        booking = shop_stats.booking + excluded.booking, phone = shop_stats.phone + excluded.phone,
        site = shop_stats.site + excluded.site, social = shop_stats.social + excluded.social`;
  } catch (e) {
    console.error('stats flush', (e as Error).message);
    for (const [k, n] of rows) st.buf.set(k, (st.buf.get(k) || 0) + n); // вернём в буфер, попробуем позже
  }
}

export function startStatsFlusher() {
  if (g.__tbStatsTimer) return;
  g.__tbStatsTimer = setInterval(() => flush().catch(() => {}), 30_000);
  const stop = () => { flush().finally(() => process.exit(0)); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

/** Суммы и ряд по дням для барбершопа за период (включая сегодняшний несброшенный буфер). */
export async function shopStats(id: number, days: number) {
  await flush();
  const rows = await sql`select d::date::text as day, coalesce(s.impressions,0) impressions, coalesce(s.views,0) views, coalesce(s.booking,0) booking,
      coalesce(s.phone,0) phone, coalesce(s.site,0) site, coalesce(s.social,0) social
    from generate_series((now() at time zone 'Europe/Moscow')::date - ${days - 1}::int, (now() at time zone 'Europe/Moscow')::date, interval '1 day') d
    left join shop_stats s on s.barbershop_id = ${id} and s.day = d::date order by d`;
  const [prev] = await sql`select coalesce(sum(impressions),0)::int impressions, coalesce(sum(views),0)::int views,
      coalesce(sum(booking + phone + site + social),0)::int contacts
    from shop_stats where barbershop_id = ${id}
      and day between (now() at time zone 'Europe/Moscow')::date - ${2 * days - 1}::int and (now() at time zone 'Europe/Moscow')::date - ${days}::int`;
  const sum = (k: Kind) => rows.reduce((a: number, r: any) => a + Number(r[k]), 0);
  const tot = Object.fromEntries(KINDS.map((k) => [k, sum(k)])) as Record<Kind, number>;
  return { rows, tot, contacts: tot.booking + tot.phone + tot.site + tot.social, prev };
}

export const STATS_SINCE = '2026-11-18';
