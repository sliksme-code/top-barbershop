import { createHmac } from 'node:crypto';

// Картинки: оригиналы старого сайта лежат как /media/YYYY/MM/file.jpg (= /wp-content/uploads/...).
// Миниатюры режет imgproxy (подписанные URL), без ключей — отдаём оригинал.
const KEY = process.env.IMGPROXY_KEY;
const SALT = process.env.IMGPROXY_SALT;

export function rel(path?: string | null): string | null {
  if (!path) return null;
  let p = String(path).trim();
  p = p.replace(/^https?:\/\/(www\.)?top-barbershop\.com/, '');
  p = p.replace(/^\/wp-content\/uploads\//, '/media/');
  return p.startsWith('/media/') ? p : null;
}

export function img(path: string | null | undefined, w: number, h = 0, mode: 'fill' | 'fit' = 'fill'): string {
  const r = rel(path);
  if (!r) return '/placeholder.svg';
  if (!KEY || !SALT) return r;
  const src = 'local:///' + r.slice('/media/'.length).split('/').map(encodeURIComponent).join('/');
  const p = `/rs:${mode}:${w}:${h}:0/g:sm/plain/${src}`;
  const hmac = createHmac('sha256', Buffer.from(KEY, 'hex'));
  hmac.update(Buffer.from(SALT, 'hex'));
  hmac.update(p);
  const sig = hmac.digest('base64url');
  return `/img/${sig}${p}`;
}
