import type { APIRoute } from 'astro';
import { createPublicKey, createVerify } from 'node:crypto';
import { syncPayment } from '../../lib/billing';

// Уведомления Точка Банка (acquiringInternetPayment — оплата платёжной ссылки).
// Тело — подписанный банком JWT (RS256), Content-Type: text/plain, доверять можно только после проверки подписи.
// Адрес регистрируется через API банка (в интернет-банке этого раздела нет): node scripts/tochka-setup.mjs
// URL для подписки: https://top-barbershop.com/api/tochka/?key=<TOCHKA_ORDER_SECRET>
const KEY_URL = 'https://enter.tochka.com/doc/openapi/static/keys/public';
const SECRET = process.env.TOCHKA_ORDER_SECRET || '';

let cachedKey: ReturnType<typeof createPublicKey> | null = null;
let cachedAt = 0;
async function bankKey(force = false) {
  if (!force && cachedKey && Date.now() - cachedAt < 6 * 3600e3) return cachedKey;
  const r = await fetch(KEY_URL, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`tochka key: HTTP ${r.status}`);
  const j: any = await r.json();
  const jwk = j?.keys?.[0] || j;
  cachedKey = createPublicKey({ key: jwk, format: 'jwk' });
  cachedAt = Date.now();
  return cachedKey;
}

/** Проверяем подпись JWT публичным ключом банка; при несовпадении ключ перечитывается (ротация). Возвращает payload или null. */
async function verifyJwt(jwt: string): Promise<any | null> {
  const parts = jwt.trim().split('.');
  if (parts.length !== 3) return null;
  let header: any;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch { return null; }
  if (header?.alg !== 'RS256') return null;
  const data = `${parts[0]}.${parts[1]}`;
  const sig = Buffer.from(parts[2], 'base64url');
  for (const force of [false, true]) {
    try {
      const key = await bankKey(force);
      if (createVerify('RSA-SHA256').update(data).verify(key, sig)) {
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      }
    } catch (e) { console.error('tochka webhook key', (e as Error)?.message); return null; }
  }
  return null;
}

export const POST: APIRoute = async ({ request, url }) => {
  // Секретный суффикс в URL отсекает случайные POST ещё до проверки подписи
  if (SECRET && url.searchParams.get('key') !== SECRET) return new Response('forbidden', { status: 403 });
  const payload = await verifyJwt(await request.text()).catch(() => null);
  if (!payload) return new Response('bad signature', { status: 403 });
  // Статус всё равно перепроверяем запросом в API — syncPayment сам ходит в Точку
  if (payload.webhookType === 'acquiringInternetPayment' && payload.operationId) {
    await syncPayment(String(payload.operationId)).catch((e) => console.error('tochka hook', e));
  }
  return new Response('ok'); // строго 200: на любой другой ответ банк повторяет вебхук 30 раз с интервалом 10 с
};
