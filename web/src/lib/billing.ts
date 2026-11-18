import { sql } from './db';

export const PRICE = { pro: 1990, proNetwork: 1190, priority: 3000 } as const;
/** Скидка за оплату вперёд: от 6 мес — 15%, от 12 мес — 25% */
export const discountFor = (months: number) => (months >= 12 ? 25 : months >= 6 ? 15 : 0);
/** Пакет для сетей: от 2 филиалов в одном заказе — 1 190 ₽/мес за филиал */
export const NETWORK_MIN = 2;
export function proQuote(months: number, branches = 1) {
  const per = branches >= NETWORK_MIN ? PRICE.proNetwork : PRICE.pro;
  const disc = discountFor(months);
  const full = per * months * branches;
  const total = Math.round((full * (100 - disc)) / 100);
  return { per, disc, full, total, monthly: Math.round(total / months / branches) };
}
export const PRO_PERIODS = [1, 3, 6, 12] as const;
export const PRIORITY_SLOTS = 3;
export const SELLER = {
  name: 'ИП Галиуллин Марат Рамилевич',
  inn: '165710584907',
  ogrnip: '310169034800140',
  email: 'mail@top-barbershop.com',
};

export const isPro = (s: { pro_until?: Date | string | null }) => Boolean(s.pro_until && new Date(s.pro_until).getTime() > Date.now());

/** Понедельник недели (UTC-дата, строка YYYY-MM-DD) */
export function monday(d = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const wd = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - wd);
  return x.toISOString().slice(0, 10);
}
export const addDays = (iso: string, n: number) => { const x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const weekLabel = (iso: string) => {
  const a = new Date(iso + 'T00:00:00Z'), b = new Date(addDays(iso, 6) + 'T00:00:00Z');
  const f = (d: Date, m: boolean) => d.toLocaleDateString('ru-RU', { day: 'numeric', ...(m ? { month: 'long' } : {}), timeZone: 'UTC' });
  return `${f(a, a.getUTCMonth() !== b.getUTCMonth())} — ${f(b, true)}`;
};

/** Ближайшие недели (со следующего понедельника) и сколько мест свободно в городе */
export async function priorityCalendar(locationId: number, shopId: number, weeks = 10) {
  const first = addDays(monday(), 7);
  const list = Array.from({ length: weeks }, (_, i) => addDays(first, i * 7));
  const busy = await sql`select week_start::text w, taken from priority_busy where location_id = ${locationId} and week_start >= ${first}`;
  const mine = await sql`select week_start::text w, status from priority_slots where barbershop_id = ${shopId} and status <> 'cancelled' and week_start >= ${monday()}`;
  const b = Object.fromEntries(busy.map((r) => [r.w, r.taken]));
  const m = Object.fromEntries(mine.map((r) => [r.w, r.status]));
  return list.map((w) => ({ week: w, label: weekLabel(w), free: Math.max(0, PRIORITY_SLOTS - (b[w] || 0)), mine: m[w] || null }));
}

export async function createProOrder(userId: number, shopIds: number[], months: number) {
  const m = (PRO_PERIODS as readonly number[]).includes(months) ? months : 1;
  const ids = [...new Set(shopIds)].filter(Boolean);
  const q = proQuote(m, ids.length);
  const [o] = await sql`insert into orders (user_id, barbershop_id, shop_ids, kind, months, amount, discount)
    values (${userId}, ${ids[0]}, ${ids.length > 1 ? ids : null}, 'pro', ${m}, ${q.total}, ${q.disc}) returning id, amount`;
  return o;
}

/** Бронь места в городе на неделю: не больше 3 на город, атомарно (advisory lock на город+неделю). */
export async function reservePriority(userId: number, shopId: number, locationId: number, week: string) {
  if (week !== monday(new Date(week + 'T12:00:00Z')) || week <= monday()) return { error: 'Выберите неделю из календаря.' };
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${locationId}, ${Number(week.replace(/-/g, '')) % 2147483647})`;
    const [{ taken }] = await tx`select coalesce((select taken from priority_busy where location_id = ${locationId} and week_start = ${week}), 0)::int taken`;
    if (taken >= PRIORITY_SLOTS) return { error: 'На эту неделю все 3 места в городе уже заняты.' };
    const [dup] = await tx`select id from priority_slots where barbershop_id = ${shopId} and week_start = ${week} and status <> 'cancelled'
      and (status = 'paid' or created_at > now() - interval '48 hours')`;
    if (dup) return { error: 'Этот барбершоп уже забронировал эту неделю.' };
    await tx`delete from priority_slots where barbershop_id = ${shopId} and week_start = ${week}`; // сгоревшие брони
    const [o] = await tx`insert into orders (user_id, barbershop_id, kind, week_start, amount) values (${userId}, ${shopId}, 'priority', ${week}, ${PRICE.priority}) returning id, amount`;
    await tx`insert into priority_slots (location_id, week_start, barbershop_id, order_id) values (${locationId}, ${week}, ${shopId}, ${o.id})`;
    return { order: o };
  });
}

// ---- ЮKassa: включается, когда заданы YOOKASSA_SHOP_ID и YOOKASSA_SECRET ----
const SHOP = process.env.YOOKASSA_SHOP_ID, SECRET = process.env.YOOKASSA_SECRET;
export const paymentsEnabled = Boolean(SHOP && SECRET);
const auth = () => 'Basic ' + Buffer.from(`${SHOP}:${SECRET}`).toString('base64');

export async function startPayment(order: { id: number; amount: number }, description: string, email: string) {
  if (!paymentsEnabled) return null;
  const r = await fetch('https://api.yookassa.ru/v3/payments', {
    method: 'POST',
    headers: { Authorization: auth(), 'Idempotence-Key': `order-${order.id}-${Date.now()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: { value: order.amount.toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: `https://top-barbershop.com/billing/?paid=${order.id}` },
      description: description.slice(0, 128),
      metadata: { order_id: String(order.id) },
      receipt: { customer: { email }, items: [{ description: description.slice(0, 128), quantity: '1.00', amount: { value: order.amount.toFixed(2), currency: 'RUB' }, vat_code: 1, payment_mode: 'full_payment', payment_subject: 'service' }] },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const j: any = await r.json();
  if (!r.ok) { console.error('yookassa', j); return null; }
  await sql`update orders set payment_id = ${j.id} where id = ${order.id}`;
  return j.confirmation?.confirmation_url as string;
}

/** Проверяем платёж запросом в ЮKassa (вебхуку на слово не верим) и отмечаем заказ оплаченным. */
export async function syncPayment(paymentId: string) {
  if (!paymentsEnabled || !paymentId) return false;
  const r = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: auth() }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return false;
  const p: any = await r.json();
  const id = Number(p.metadata?.order_id);
  if (!id) return false;
  if (p.status === 'succeeded') await sql`update orders set status = 'paid', payment_id = ${p.id} where id = ${id} and status = 'pending'`;
  if (p.status === 'canceled') await sql`update orders set status = 'cancelled' where id = ${id} and status = 'pending'`;
  return true;
}
