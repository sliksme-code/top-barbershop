import { sql } from './db';

export const PER_PAGE = 24;

export type Card = {
  id: number; slug: string; title: string; cover: string | null; rating: number | null; reviews_count: number;
  closed: boolean; featured: boolean; address: string | null; price: string | null; city: string | null; city_path: string | null; metro: string | null;
  lat: number | null; lng: number | null; prio?: boolean;
};

const cardSelect = sql`
  b.id, b.slug, b.title, coalesce(b.cover_image, b.gallery->>0) as cover, b.rating::float as rating, coalesce(b.reviews_count,0) as reviews_count,
  coalesce(b.closed,false) as closed, coalesce(b.featured,false) as featured, b.address, b.services->>'strizh' as price,
  l.name as city, l.path as city_path, b.lat, b.lng,
  exists (select 1 from priority_slots ps where ps.barbershop_id = b.id and ps.status = 'paid' and current_date between ps.week_start and ps.week_start + 6) as prio,
  (select string_agg(m.name, ', ' order by m.name) from barbershop_metro bm join metro m on m.id = bm.metro_id where bm.barbershop_id = b.id) as metro`;

const prioFirst = sql`exists (select 1 from priority_slots ps where ps.barbershop_id = b.id and ps.status = 'paid' and current_date between ps.week_start and ps.week_start + 6) desc,`;
const orderBy = (prio: boolean) => sql`order by ${prio ? prioFirst : sql``} coalesce(b.closed,false), coalesce(b.featured,false) desc, b.rating desc nulls last, b.reviews_count desc nulls last, b.views desc nulls last, b.id desc`;

/** Список карточек с пагинацией. where — фрагмент sql`...` без слова WHERE. */
/** prio = поднимать оплаченный приоритет (страницы города и метро) */
export async function listShops(where: any, page = 1, perPage = PER_PAGE, prio = false) {
  const [{ n }] = await sql`select count(*)::int as n from barbershops b left join locations l on l.id = b.location_id where b.status = 'published' and ${where}`;
  const items = await sql<Card[]>`select ${cardSelect} from barbershops b left join locations l on l.id = b.location_id
    where b.status = 'published' and ${where} ${orderBy(prio)} limit ${perPage} offset ${(page - 1) * perPage}`;
  if (!prio) for (const it of items) it.prio = false; // метка «Топ города» — только там, где он реально поднят
  return { total: n as number, items, pages: Math.max(1, Math.ceil(n / perPage)) };
}

export async function mapPoints(where: any) {
  return sql<{ slug: string; title: string; lat: number; lng: number; address: string | null }[]>`
    select b.slug, b.title, b.lat, b.lng, b.address from barbershops b left join locations l on l.id = b.location_id
    where b.status = 'published' and b.lat is not null and b.lng is not null and ${where} limit 1500`;
}

export const inLocation = (path: string) => sql`(l.path = ${path} or l.path like ${path + '/%'})`;
export const TRUE = sql`true`;

/** Разбор хвоста /page/N/ у пути. */
export function splitPage(rest: string | undefined) {
  const parts = (rest || '').split('/').filter(Boolean);
  let page = 1;
  if (parts.length >= 2 && parts[parts.length - 2] === 'page' && /^\d+$/.test(parts[parts.length - 1])) {
    page = Number(parts.pop());
    parts.pop();
  }
  return { parts, page };
}

export async function locationCounts() {
  return sql<{ id: number; name: string; path: string; parent_id: number | null; n: number }[]>`
    select l.id, l.name, l.path, l.parent_id, count(b.id)::int as n
    from locations l left join barbershops b on b.location_id = l.id and b.status = 'published'
    group by l.id order by n desc, l.name`;
}

export async function featureLabels() {
  const rows = await sql<{ key: string; label: string; kind: string }[]>`select key, label, kind from features order by sort nulls last, label`;
  return Object.fromEntries(rows.map((r) => [r.key, r]));
}
