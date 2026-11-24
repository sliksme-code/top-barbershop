import { sql } from './db';
import { inLocation } from './catalog';
import { plural, shops } from './text';

export type FaqItem = { q: string; a: string };
export type CityFacts = { n: number; lines: string[]; faq: FaqItem[] };

const rub = (n: number) => n.toLocaleString('ru-RU') + ' ₽';
const DATIVE_DAYS = ['понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам', 'воскресеньям'];

type Gen = {
  n: number; with_booking: number; rating_avg: number | null; reviews_total: number;
  new_year: number; chains: number; with_hours: number; sun_open: number; late_open: number;
};
type Prices = { n: number; avg: number | null; med: number | null; mn: number | null; mx: number | null };
type Peak = { wd: number; n: number };

/** SEO-блок «цифры и факты» + FAQ для страницы локации. where — название в предложном падеже («в Казани»). */
export async function cityStats(path: string, where: string): Promise<CityFacts> {
  const loc = inLocation(path);
  const priceFilter = sql`b.services->>'strizh' ~ '^[0-9]+$' and (b.services->>'strizh')::int between 100 and 30000`;

  const [g, p, nat, peaks] = await Promise.all([
    sql<Gen[]>`
      select count(*)::int n,
        count(*) filter (where coalesce(b.booking_url, '') <> '')::int with_booking,
        round(avg(b.rating) filter (where b.rating is not null), 1)::float rating_avg,
        coalesce(sum(coalesce(b.reviews_count, 0)), 0)::int reviews_total,
        count(*) filter (where b.created_at > now() - interval '1 year')::int new_year,
        count(distinct b.chain_id) filter (where b.chain_id is not null)::int chains,
        count(*) filter (where jsonb_typeof(b.opening_hours) = 'array' and b.opening_hours <> '[]'::jsonb)::int with_hours,
        count(*) filter (where case when jsonb_typeof(b.opening_hours) = 'array'
          then exists (select 1 from jsonb_array_elements(b.opening_hours) h where (h->>'day')::int = 7) else false end)::int sun_open,
        count(*) filter (where case when jsonb_typeof(b.opening_hours) = 'array'
          then exists (select 1 from jsonb_array_elements(b.opening_hours) h where h->>'to' >= '21:00') else false end)::int late_open
      from barbershops b join locations l on l.id = b.location_id
      where b.status = 'published' and ${loc}`.then((r) => r[0]),
    sql<Prices[]>`
      select count(*)::int n, round(avg(v))::int avg,
        (percentile_cont(0.5) within group (order by v))::int med, min(v)::int mn, max(v)::int mx
      from (select (b.services->>'strizh')::int v from barbershops b join locations l on l.id = b.location_id
        where b.status = 'published' and ${loc} and ${priceFilter}) t`.then((r) => r[0]),
    sql<{ n: number; avg: number | null }[]>`
      select count(*)::int n, round(avg(v))::int avg
      from (select (b.services->>'strizh')::int v from barbershops b
        where b.status = 'published' and ${priceFilter}) t`.then((r) => r[0]),
    sql<Peak[]>`
      select extract(isodow from s.day)::int wd, sum(s.booking)::int n
      from shop_stats s join barbershops b on b.id = s.barbershop_id join locations l on l.id = b.location_id
      where ${loc} group by wd order by n desc`,
  ]);

  // Сначала собираем факты как данные, из них — строки блока и ответы FAQ
  let priceLine = '', diffLine = '', ratingLine = '', bookingLine = '', hoursLine = '', peakLine = '';

  if (p && p.n >= 5 && p.avg && p.med && p.mn && p.mx) {
    priceLine = `Средняя цена мужской стрижки ${where} — ${rub(p.avg)} (по данным ${shops(p.n)}); медиана ${rub(p.med)}, разброс от ${rub(p.mn)} до ${rub(p.mx)}.`;
    if (nat && nat.n >= 50 && nat.avg) {
      const diff = Math.round(((p.avg - nat.avg) / nat.avg) * 100);
      if (Math.abs(diff) >= 5) {
        diffLine = `Это ${diff > 0 ? 'дороже' : 'дешевле'} среднего по России (${rub(nat.avg)}) на ${Math.abs(diff)}%.`;
      }
    }
  }

  const n = g?.n ?? 0;
  if (g) {
    if (g.rating_avg && g.reviews_total >= 20) {
      ratingLine = `Средний рейтинг барбершопов города — ${String(g.rating_avg).replace('.', ',')}, суммарно ${g.reviews_total.toLocaleString('ru-RU')} ${plural(g.reviews_total, 'отзыв', 'отзыва', 'отзывов')}.`;
    }
    if (n >= 10 && g.with_booking > 0) {
      const pct = Math.round((g.with_booking / n) * 100);
      bookingLine = `Онлайн-запись доступна в ${pct}% барбершопов (${g.with_booking} из ${n}).`;
    }
    if (g.with_hours >= 10) {
      const parts: string[] = [];
      const sun = Math.round((g.sun_open / g.with_hours) * 100);
      const late = Math.round((g.late_open / g.with_hours) * 100);
      if (sun > 0) parts.push(`${sun}% работают в воскресенье`);
      if (late > 0) parts.push(`${late}% принимают после 21:00`);
      if (parts.length) hoursLine = `Из ${shops(g.with_hours)} с указанным расписанием ${parts.join(', ')}.`;
    }
  }

  // Пиковые дни по кликам на запись — только при накопленной статистике (≥30 дней и ≥300 кликов)
  if (peaks.length) {
    const totalClicks = peaks.reduce((a, x) => a + x.n, 0);
    const top = peaks.filter((x) => x.n > 0).slice(0, 2);
    if (totalClicks >= 300 && top.length) {
      const [{ days }] = await sql<{ days: number }[]>`
        select count(distinct s.day)::int days from shop_stats s
        join barbershops b on b.id = s.barbershop_id join locations l on l.id = b.location_id where ${loc}`;
      if (days >= 30) {
        peakLine = `По статистике онлайн-записей чаще всего записываются по ${top.map((x) => DATIVE_DAYS[x.wd - 1]).join(' и ')}.`;
      }
    }
  }

  const lines: string[] = [];
  if (priceLine) lines.push(diffLine ? `${priceLine} ${diffLine}` : priceLine);
  if (ratingLine) lines.push(ratingLine);
  if (bookingLine) lines.push(bookingLine);
  if (hoursLine) lines.push(hoursLine);
  if (peakLine) lines.push(peakLine);
  if (g && g.new_year >= 3) lines.push(`За последний год ${where} добавились ${shops(g.new_year)} — рынок растёт.`);
  if (g && g.chains >= 2) lines.push(`${where[0].toUpperCase() + where.slice(1)} работают ${g.chains} ${plural(g.chains, 'сеть барбершопов', 'сети барбершопов', 'сетей барбершопов')} — есть выбор между локальными мастерами и федеральными брендами.`);

  const faq: FaqItem[] = [];
  if (n > 0) {
    faq.push({
      q: `Сколько барбершопов ${where}?`,
      a: `В каталоге сейчас ${shops(n)} ${where} — с адресами на карте, ценами, фото и отзывами. Актуальный список с фильтрами — на этой странице.`,
    });
  }
  if (priceLine) {
    faq.push({ q: `Сколько стоит мужская стрижка ${where}?`, a: `${priceLine}${diffLine ? ' ' + diffLine : ''} Точную цену смотрите в карточке конкретного барбершопа.` });
  }
  if (bookingLine) {
    faq.push({ q: `Можно ли записаться в барбершоп ${where} онлайн?`, a: `Да. ${bookingLine} Кнопка «Записаться онлайн» есть в карточках таких барбершопов в списке.` });
  }
  if (hoursLine) {
    faq.push({ q: `Работают ли барбершопы ${where} в воскресенье и по вечерам?`, a: `${hoursLine} Расписание конкретного барбершопа указано на его странице.` });
  }
  if (peakLine) {
    faq.push({ q: `В какие дни лучше записываться ${where}?`, a: `${peakLine} Если планируете визит в эти дни — бронируйте заранее, свободных окон меньше.` });
  }

  return { n, lines, faq };
}
