// Защита форм: проверка источника (CSRF), простой лимит частоты, honeypot, Яндекс SmartCaptcha (если задан серверный ключ).
const hits = new Map<string, number[]>();
export function rateLimited(key: string, max = 10, windowSec = 600) {
  const now = Date.now(), arr = (hits.get(key) || []).filter((t) => now - t < windowSec * 1000);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}
export const ipOf = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
export function sameOrigin(req: Request) {
  const o = req.headers.get('origin');
  if (!o) return true; // старые браузеры/формы без Origin
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim();
  try { return new URL(o).host === host; } catch { return false; }
}
export async function captchaOk(form: FormData, req: Request) {
  const key = process.env.SMARTCAPTCHA_SERVER_KEY;
  if (!key) return true;
  const t = String(form.get('smart-token') || '');
  if (!t) return false;
  try {
    const r = await fetch(`https://smartcaptcha.yandexcloud.net/validate?secret=${encodeURIComponent(key)}&token=${encodeURIComponent(t)}&ip=${encodeURIComponent(ipOf(req))}`, { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    return j.status === 'ok';
  } catch { return true; } // сервис капчи недоступен — не блокируем людей
}
export const str = (f: FormData, k: string, max = 500) => String(f.get(k) ?? '').trim().slice(0, max);
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
