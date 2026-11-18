import type { APIRoute } from 'astro';
import { syncPayment } from '../../lib/billing';
// Уведомления ЮKassa (payment.succeeded / payment.canceled). Адрес для кабинета ЮKassa: https://top-barbershop.com/api/yookassa/
export const POST: APIRoute = async ({ request }) => {
  const j: any = await request.json().catch(() => null);
  if (j?.object?.id) await syncPayment(j.object.id).catch((e) => console.error('yookassa hook', e));
  return new Response('ok');
};
