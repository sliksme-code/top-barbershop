#!/usr/bin/env node
// Настройка эквайринга Точка Банк: проверка торговых точек, регистрация вебхука, тестовое уведомление.
//
// Запуск (на сервере в контейнере web или локально):
//   node scripts/tochka-setup.mjs            # проверить точки и зарегистрировать вебхук
//   node scripts/tochka-setup.mjs --test     # + отправить тестовое уведомление на вебхук
//   node scripts/tochka-setup.mjs --status   # только показать текущие настройки вебхука
//
// Переменные окружения: TOCHKA_JWT, TOCHKA_CLIENT_ID, TOCHKA_CUSTOMER_CODE, TOCHKA_ORDER_SECRET.
// Вебхук подписывается на событие acquiringInternetPayment (оплата платёжной ссылки) —
// в интернет-банке Точки раздела вебхуков нет, подписка делается только этим API.
import { readFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ca = readFileSync(path.join(dir, '../certs/russian_trusted_root_ca.pem')); // enter.tochka.com — цепочка Минцифры

const { TOCHKA_JWT: JWT, TOCHKA_CLIENT_ID: CLIENT_ID, TOCHKA_CUSTOMER_CODE: CUSTOMER, TOCHKA_ORDER_SECRET: SECRET } = process.env;
const BASE = (process.env.TOCHKA_API_BASE || 'https://enter.tochka.com/uapi').replace(/\/$/, '');
const HOOK_URL = process.env.TOCHKA_WEBHOOK_URL || `https://top-barbershop.com/api/tochka/${SECRET ? `?key=${SECRET}` : ''}`;

if (!JWT || !CLIENT_ID) {
  console.error('Задайте TOCHKA_JWT и TOCHKA_CLIENT_ID (Интеграции и API в интернет-банке Точки).');
  process.exit(1);
}

function req(method, p, body) {
  const url = new URL(BASE + p);
  return new Promise((resolve, reject) => {
    const r = https.request(
      {
        method,
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        ca,
        headers: { Authorization: `Bearer ${JWT}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let j;
          try { j = JSON.parse(data); } catch { j = data; }
          resolve({ status: res.statusCode, body: j });
        });
      }
    );
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('timeout')));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

const args = process.argv.slice(2);

// 1. Торговые точки: merchantId и статус эквайринга (status REG + isActive true = настройка завершена)
if (!args.includes('--status')) {
  if (!CUSTOMER) { console.error('Задайте TOCHKA_CUSTOMER_CODE (уникальный код клиента — запросите в чате Точки).'); process.exit(1); }
  const retailers = await req('GET', `/acquiring/v1.0/retailers?customerCode=${CUSTOMER}`);
  console.log('Торговые точки:', retailers.status, JSON.stringify(retailers.body, null, 2));
  const list = retailers.body?.Data?.Retailer || [];
  const active = list.find((x) => x.isActive === true) || list.find((x) => x.status === 'REG');
  if (!active) console.warn('⚠ Активной точки нет: эквайринг ещё не подключён или на модерации. Платёжные ссылки создаваться не будут.');
  else console.log(`✓ Активная точка: merchantId=${active.merchantId} (можно задать TOCHKA_MERCHANT_ID=${active.merchantId})`);
}

// 2. Вебхук на acquiringInternetPayment
if (args.includes('--status')) {
  const cur = await req('GET', `/webhook/v1.0/${CLIENT_ID}`);
  console.log('Текущий вебхук:', cur.status, JSON.stringify(cur.body, null, 2));
} else {
  const put = await req('PUT', `/webhook/v1.0/${CLIENT_ID}`, { webhooksList: ['acquiringInternetPayment'], url: HOOK_URL });
  console.log('Регистрация вебхука:', put.status, JSON.stringify(put.body, null, 2));
  if (put.status === 200) console.log(`✓ Вебхук подключён: ${HOOK_URL}`);

  if (args.includes('--test')) {
    const t = await req('POST', `/webhook/v1.0/${CLIENT_ID}/test_send`, { webhookType: 'acquiringInternetPayment' });
    console.log('Тестовое уведомление:', t.status, JSON.stringify(t.body, null, 2));
  }
}
