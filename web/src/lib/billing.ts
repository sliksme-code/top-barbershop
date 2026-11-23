import { sql } from './db';

export const PRICE = { pro: 990, proNetwork: 690, priority: 3000 } as const;
/** Скидка за оплату вперёд: от 6 мес — 15%, от 12 мес — 25% (пакет для сетей на год — 30%) */
export const discountFor = (months: number, network = false) => (months >= 12 ? (network ? 30 : 25) : months >= 6 ? 15 : 0);
/** Пакет для сетей: от 3 филиалов в одном заказе — 690 ₽/мес за филиал */
export const NETWORK_MIN = 3;
export function proQuote(months: number, branches = 1) {
  const net = branches >= NETWORK_MIN;
  const per = net ? PRICE.proNetwork : PRICE.pro;
  const disc = discountFor(months, net);
  const full = per * months * branches;
  const total = Math.round((full * (100 - disc)) / 100);
  return { per, disc, full, total, monthly: Math.round(total / months / branches) };
}
/** Минимальный срок размещения PRO — 3 месяца */
export const PRO_PERIODS = [3, 6, 12] as const;
export const MIN_MONTHS = PRO_PERIODS[0];
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
  const m = (PRO_PERIODS as readonly number[]).includes(months) ? months : MIN_MONTHS;
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

// ---- Эквайринг Точка Банк: включается, когда заданы TOCHKA_JWT и TOCHKA_CUSTOMER_CODE ----
// Документация: https://developers.tochka.com/docs/tochka-api (платёжные ссылки, /uapi/acquiring/v1.0)
const TK_JWT = process.env.TOCHKA_JWT, CUSTOMER = process.env.TOCHKA_CUSTOMER_CODE;
export const paymentsEnabled = Boolean(TK_JWT && CUSTOMER);
const API = (process.env.TOCHKA_API_BASE || 'https://enter.tochka.com/uapi').replace(/\/$/, '');
const PAYMENT_MODES = (process.env.TOCHKA_PAYMENT_MODES || 'card,sbp,tinkoff').split(',').map((s) => s.trim()).filter(Boolean);
const TAX_SYSTEM = process.env.TOCHKA_TAX_SYSTEM || 'usn_income_outcome'; // osn | usn_income | usn_income_outcome | esn | patent
const VAT = process.env.TOCHKA_VAT || 'none'; // none | vat0 | vat5 | vat7 | vat10 | vat22 | vat105 | vat107 | vat110 | vat122

async function tk(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TK_JWT}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const j: any = await r.json().catch(() => null);
  if (!r.ok) { console.error('tochka', method, path, j?.code, j?.message, j?.Errors?.[0]?.message); return null; }
  return j?.Data ?? j;
}

// merchantId: из env, иначе первая активная торговая точка (кэш на процесс)
let merchantCache: string | null = null;
async function merchantId() {
  if (process.env.TOCHKA_MERCHANT_ID) return process.env.TOCHKA_MERCHANT_ID;
  if (merchantCache) return merchantCache;
  const j = await tk(`/acquiring/v1.0/retailers?customerCode=${CUSTOMER}`).catch(() => null);
  const arr = j?.Retailer || [];
  const active = arr.find((x: any) => x.isActive === true) || arr.find((x: any) => x.status === 'REG');
  merchantCache = active?.merchantId || null;
  return merchantCache;
}

export const SITE = 'https://top-barbershop.com';
export const payUrl = (orderId: number) => `${SITE}/billing/pay/?order=${orderId}`;
const returnUrl = (orderId: number) => `${SITE}/billing/?paid=${orderId}`;
const failUrl = (orderId: number) => `${SITE}/billing/pay/?order=${orderId}&retry=1`;

/** Создаёт платёжную ссылку в Точке. С чеком 54-ФЗ (payments_with_receipt), если не отключено TOCHKA_RECEIPT=0. */
async function tkCreate(order: { id: number; amount: number }, description: string, email: string) {
  const purpose = description.slice(0, 140);
  const data: any = {
    customerCode: CUSTOMER,
    amount: Number(order.amount).toFixed(2),
    purpose,
    redirectUrl: returnUrl(order.id),
    failRedirectUrl: failUrl(order.id),
    paymentMode: PAYMENT_MODES,
    paymentLinkId: `order-${order.id}`,
  };
  const m = await merchantId();
  if (m) data.merchantId = m;
  let j: any = null;
  if (process.env.TOCHKA_RECEIPT !== '0') {
    j = await tk('/acquiring/v1.0/payments_with_receipt', 'POST', {
      Data: {
        ...data,
        taxSystemCode: TAX_SYSTEM,
        Client: { email },
        Items: [{ name: purpose.slice(0, 128), amount: data.amount, quantity: 1, paymentMethod: 'full_payment', paymentObject: 'service', vatType: VAT }],
      },
    });
  }
  if (!j) j = await tk('/acquiring/v1.0/payments', 'POST', { Data: data }); // чек не приняли — оплата важнее, чек вышлем из кассы
  if (!j?.paymentLink || !j?.operationId) return null;
  await sql`update orders set payment_id = ${j.operationId} where id = ${order.id}`;
  return j.paymentLink as string;
}

/** Статус операции в Точке: CREATED / APPROVED / ON-REFUND / REFUNDED / EXPIRED. */
async function tkStatus(operationId: string) {
  const j = await tk(`/acquiring/v1.0/payments/${encodeURIComponent(operationId)}`);
  const op = (j?.Operation || [])[0];
  return op ? { status: op.status as string, link: op.paymentLink as string | undefined, linkId: op.paymentLinkId as string | undefined } : null;
}

/**
 * Ссылка на оплату заказа. Живую ссылку (CREATED) переиспользуем, оплаченный заказ → { paid: true },
 * протухшую (EXPIRED/REFUNDED) — создаём заново. Иначе { url } или null при ошибке API.
 */
export async function startPayment(order: { id: number; amount: number; payment_id?: string | null }, description: string, email: string) {
  if (!paymentsEnabled) return null;
  if (order.payment_id) {
    const op = await tkStatus(order.payment_id).catch(() => null);
    if (op?.status === 'APPROVED') { await syncPayment(order.payment_id); return { paid: true }; }
    if (op?.status === 'CREATED' && op.link) return { url: op.link };
  }
  const url = await tkCreate(order, description, email);
  return url ? { url } : null;
}

/** Человекочитаемое название заказа — для чека, страницы оплаты и писем. */
export function orderTitle(o: { kind: string; months?: number | null; n?: number | null; week?: string | null; title: string; city?: string | null }) {
  if (o.kind === 'pro') return (o.n || 1) > 1 ? `Пакет PRO для сети: ${o.n} филиалов на ${o.months} мес` : `PRO для «${o.title}» на ${o.months} мес`;
  return `Топ города${o.city ? ` (${o.city})` : ''} для «${o.title}», неделя ${weekLabel(o.week || '')}`;
}

/** Заказ пользователя со всем нужным для оплаты. */
export async function loadOrder(id: number) {
  const [o] = await sql`select o.id, o.user_id, o.kind, o.months, o.amount, o.discount, o.status, o.payment_id, o.created_at, o.week_start::text week,
      coalesce(array_length(o.shop_ids, 1), 1) n, b.title, l.name city, ps.status slot_status, ps.created_at slot_at
    from orders o join barbershops b on b.id = o.barbershop_id left join locations l on l.id = b.location_id
    left join priority_slots ps on ps.order_id = o.id where o.id = ${id}`;
  return o || null;
}

/** Бронь топа ещё действует? (неоплаченная сгорает через 48 часов) */
export const priorityAlive = (o: any) => o.kind !== 'priority' || (o.slot_status === 'reserved' && Date.now() - new Date(o.slot_at).getTime() < 48 * 3600e3);

/** Проверяем платёж запросом в Точку (вебхуку на слово не верим) и отмечаем заказ оплаченным. */
export async function syncPayment(paymentId: string) {
  if (!paymentsEnabled || !paymentId) return false;
  const op = await tkStatus(paymentId);
  if (!op) return false;
  // Заказ находим по paymentLinkId (order-123); запасной вариант — по payment_id в orders
  const id = Number(String(op.linkId || '').replace(/^order-/, '')) ||
    (await sql`select id from orders where payment_id = ${paymentId}`)[0]?.id;
  if (!id) return false;
  if (op.status === 'APPROVED') await sql`update orders set status = 'paid', payment_id = ${paymentId} where id = ${id} and status = 'pending'`;
  // EXPIRED / REFUNDED заказ не отменяют — можно оплатить снова
  return true;
}

// ---- Напоминание об оплате: через час после неоплаченного заказа, одно письмо ----
export function startPaymentReminders() {
  const g = globalThis as any;
  if (g.__tbReminders || process.env.SITE_ENV !== 'production') return;
  g.__tbReminders = true;
  const tick = async () => {
    const { sendMail, mailEnabled } = await import('./mail');
    if (!mailEnabled) return;
    const rows = await sql`select o.id, u.email from orders o join site_users u on u.id = o.user_id
      where o.status = 'pending' and o.reminded_at is null and u.email is not null
        and o.created_at < now() - interval '1 hour' and o.created_at > now() - interval '3 days'
        and not exists (select 1 from orders p where p.user_id = o.user_id and p.barbershop_id = o.barbershop_id and p.kind = o.kind and p.status = 'paid' and p.id > o.id)
      order by o.id limit 20`;
    for (const r of rows) {
      const [claim] = await sql`update orders set reminded_at = now() where id = ${r.id} and reminded_at is null returning id`;
      if (!claim) continue;
      let o = await loadOrder(r.id);
      if (o?.payment_id) { await syncPayment(o.payment_id).catch(() => false); o = await loadOrder(r.id); }
      if (!o || o.status !== 'pending' || !priorityAlive(o)) continue;
      const what = orderTitle(o);
      const left = o.kind === 'priority' ? Math.max(1, Math.round((48 * 3600e3 - (Date.now() - new Date(o.slot_at).getTime())) / 3600e3)) : 0;
      const text = [
        'Здравствуйте!', '',
        `Вы оформили заказ №${o.id} на TOP BARBERSHOP: ${what}.`,
        `Сумма: ${o.amount.toLocaleString('ru-RU')} ₽. Оплата пока не поступила.`, '',
        'Оплатить можно в личном кабинете по ссылке:',
        payUrl(o.id), '',
        ...(o.kind === 'priority' ? [`Место в топе города держится за вами ещё около ${left} ч, потом бронь снимается и место может занять другой барбершоп.`, ''] : []),
        'Если вы уже оплатили или передумали — просто не обращайте внимания на это письмо.', '',
        `TOP BARBERSHOP · ${SELLER.name}, ИНН ${SELLER.inn}`, SITE + '/',
      ].join('\n');
      const ok = await sendMail(r.email, `Заказ №${o.id} ждёт оплаты — TOP BARBERSHOP`, text);
      if (!ok) await sql`update orders set reminded_at = null where id = ${o.id}`;
    }
  };
  const run = () => tick().catch((e) => console.error('reminders', e?.message));
  setTimeout(run, 60_000);
  setInterval(run, 10 * 60_000);
}
