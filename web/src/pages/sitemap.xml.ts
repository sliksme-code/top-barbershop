import type { APIRoute } from 'astro';
import { sql } from '../lib/db';
const SITE = 'https://top-barbershop.com';
export const GET: APIRoute = async () => {
  const [shops, locs, metros, chains, colls, posts, pages, cats, schools, vacs] = await Promise.all([
    sql`select slug, updated_at from barbershops where status='published'`,
    sql`select distinct l.path from locations l join barbershops b on b.status='published' join locations l2 on l2.id=b.location_id where l2.path = l.path or l2.path like l.path || '/%'`,
    sql`select distinct m.slug from metro m join barbershop_metro bm on bm.metro_id=m.id join barbershops b on b.id=bm.barbershop_id and b.status='published'`,
    sql`select distinct c.slug from chains c join barbershops b on b.chain_id=c.id and b.status='published' where c.name ~ '[[:alpha:]]'`,
    sql`select slug from collections`,
    sql`select slug, coalesce(updated_at, published_at) d from posts where status='published' and not coalesce(noindex,false)`,
    sql`select slug, updated_at d from pages where status='published' and not coalesce(noindex,false) and coalesce(template,'') not like 'page-dashboard%' and slug not in ('home','login','register','logout','remove','mc4wp-form-preview','sp','setup','fuck-coronavirus-stay-home','clipperkillah-28-oktyabrya-spb','event-directory','terms-of-use','payment')`,
    sql`select slug from categories where slug <> 'bez-rubriki'`,
    sql`select slug from schools where status='published'`,
    sql`select slug from vacancies where status='published'`,
  ]);
  const u: [string, any?][] = [['/'], ['/listings/'], ['/goroda/'], ['/samye-krupnye-seti-barbershopov/'], ['/zhurnal/'], ['/school/'], ['/vacancy/']];
  shops.forEach((x) => u.push([`/place/${x.slug}/`, x.updated_at]));
  locs.forEach((x) => u.push([`/location/${x.path}/`]));
  metros.forEach((x) => u.push([`/metro/${x.slug}/`]));
  chains.forEach((x) => u.push([`/all/${x.slug}/`]));
  colls.forEach((x) => u.push([`/collection/${x.slug}/`]));
  posts.forEach((x) => u.push([`/${x.slug}/`, x.d]));
  pages.forEach((x) => !['goroda', 'zhurnal', 'samye-krupnye-seti-barbershopov'].includes(x.slug) && u.push([`/${x.slug}/`, x.d]));
  cats.forEach((x) => u.push([`/category/${x.slug}/`]));
  schools.forEach((x) => u.push([`/school/${x.slug}/`]));
  vacs.forEach((x) => u.push([`/vacancy/${x.slug}/`]));
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${u
    .map(([p, d]) => `<url><loc>${esc(SITE + encodeURI(p))}</loc>${d ? `<lastmod>${new Date(d).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`)
    .join('\n')}\n</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
