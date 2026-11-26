export const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};
export const shops = (n: number) => `${n} ${plural(n, 'барбершоп', 'барбершопа', 'барбершопов')}`;
export const strip = (html?: string | null) => (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
export const clip = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);
export const rub = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n.toLocaleString('ru-RU') + ' ₽' : String(v ?? '');
};
export const dateRu = (d?: Date | string | null) => (d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
// Чистка HTML из WordPress: абсолютные ссылки → относительные, картинки → наши пути
export const cleanHtml = (html?: string | null) =>
  (html || '')
    .replace(/https?:\/\/(www\.)?top-barbershop\.com\/wp-content\/uploads\//g, '/media/')
    .replace(/https?:\/\/(www\.)?top-barbershop\.com\//g, '/')
    .replace(/\[\/?[a-z_-]+[^\]]*\]/gi, '')
    .replace(/<(\/?)h1(\s|>)/gi, '<$1h2$2')
    .replace(/<img /g, '<img loading="lazy" ');
export const fillAlt = (html: string, alt: string) =>
  html.replace(/<img\b([^>]*)>/gi, (m, a) => (/\balt="[^"]+"/.test(a) ? m : `<img alt="${alt.replace(/"/g, '&quot;')}"${a.replace(/\salt=""/, '')}>`));
export const phoneHref = (p?: string | null) => (p ? 'tel:' + p.replace(/[^\d+]/g, '') : null);
export const ensureUrl = (u?: string | null) => (!u ? null : /^https?:\/\//.test(u) ? u : 'https://' + u.replace(/^\/+/, ''));
/** Добавляет utm_source=topbarbershop.com и utm_campaign=<тариф> к внешней ссылке барбершопа */
export const withUtm = (u: string | null, campaign: string) => {
  if (!u) return null;
  try {
    const x = new URL(u);
    if (!x.searchParams.has('utm_source')) x.searchParams.set('utm_source', 'topbarbershop.com');
    if (!x.searchParams.has('utm_campaign')) x.searchParams.set('utm_campaign', campaign);
    return x.toString();
  } catch {
    return u;
  }
};
