import type { APIRoute } from 'astro';
import { sql } from '../lib/db';
import { BRANCHES, TYPES, COMPARISONS, COLLECTIONS, typeUrl } from '../lib/cosmetics';
import { HAIRCUT_ORDER, FACE_ORDER, haircutUrl, faceUrl } from '../lib/haircuts';
const SITE = 'https://top-barbershop.com';
export const GET: APIRoute = async () => {
  const [shops, locs, metros, chains, colls, posts, pages, scities, vcities, cats, schools, vacs] = await Promise.all([
    sql`select slug, updated_at from barbershops where status='published'`,
    sql`select distinct l.path from locations l join barbershops b on b.status='published' join locations l2 on l2.id=b.location_id where l2.path = l.path or l2.path like l.path || '/%'`,
    sql`select distinct m.slug from metro m join barbershop_metro bm on bm.metro_id=m.id join barbershops b on b.id=bm.barbershop_id and b.status='published'`,
    sql`select distinct c.slug from chains c join barbershops b on b.chain_id=c.id and b.status='published' where c.name ~ '[[:alpha:]]'`,
    sql`select slug from collections`,
    sql`select slug, coalesce(updated_at, published_at) d from posts where status='published' and not coalesce(noindex,false) and slug !~ '^(poin|barbaro)'`,
    sql`select slug, updated_at d from pages where status='published' and not coalesce(noindex,false) and coalesce(template,'') not like 'page-dashboard%' and slug not in ('home','login','register','logout','remove','mc4wp-form-preview','sp','setup','fuck-coronavirus-stay-home','clipperkillah-28-oktyabrya-spb','event-directory','terms-of-use','payment','barbaro','faq','owners','dobavit-vakansiyu','my-watchdogs','invoices','transactions','report-spam-abuse-or-inappropriate-content','add','edit','my','my-favorites','change-password','logout','login','register') and slug !~ '^poin'`,
    sql`select slug from school_cities c where exists (select 1 from schools s where s.city_id = c.id and s.status='published')`,
    sql`select slug from vacancy_cities c where exists (select 1 from vacancies v where v.city_id = c.id and v.status='published')`,
    sql`select slug from categories where slug <> 'bez-rubriki'`,
    sql`select slug from schools where status='published'`,
    sql`select slug from vacancies where status='published'`,
  ]);
  const [prods, kcities] = await Promise.all([
    sql`select slug, updated_at from products where status='published'`,
    sql`select distinct l.path from barbershops b join locations l on l.id=b.location_id where b.status='published' and not coalesce(b.closed,false) and b.amenities ? 'cosmet' and l.path like 'russia/%'`,
  ]);
  const u: [string, any?][] = [['/'], ['/listings/'], ['/goroda/'], ['/samye-krupnye-seti-barbershopov/'], ['/zhurnal/'], ['/school/'], ['/vacancy/'], ['/add/'], ['/tarify/'], ['/oferta/']];
  scities.forEach((x) => u.push([`/school/school-city/${x.slug}/`]));
  vcities.forEach((x) => u.push([`/vacancy/vacancy-city/${x.slug}/`]));
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
  u.push(['/kosmetika/'], ['/kosmetika/podbor/'], ['/kosmetika/podborki/'], ['/kosmetika/gde-kupit/']);
  Object.keys(BRANCHES).forEach((k) => u.push([`/kosmetika/${k}/`]));
  Object.keys(TYPES).forEach((k) => u.push([typeUrl(k)]));
  Object.keys(COMPARISONS).forEach((k) => u.push([`/kosmetika/${k}/`]));
  Object.keys(COLLECTIONS).forEach((k) => u.push([`/kosmetika/podborki/${k}/`]));
  prods.forEach((x) => u.push([`/kosmetika/p/${x.slug}/`, x.updated_at]));
  kcities.forEach((x) => u.push([`/kosmetika/gde-kupit/${x.path}/`]));
  u.push(['/pricheski/'], ['/pricheski/forma-lica/']);
  HAIRCUT_ORDER.forEach((k) => u.push([haircutUrl(k)]));
  FACE_ORDER.forEach((f) => u.push([faceUrl(f)]));
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${u
    .map(([p, d]) => `<url><loc>${esc(SITE + encodeURI(p))}</loc>${d ? `<lastmod>${new Date(d).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`)
    .join('\n')}\n</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
