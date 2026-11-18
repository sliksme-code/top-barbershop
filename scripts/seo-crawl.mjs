// SEO-обход боевого сайта: все URL из sitemap + проверки зеркал, редиректов, 404, пагинации.
const SITE = 'https://top-barbershop.com';
const UA = 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, opts = {}) {
  const t = Date.now();
  try {
    const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': UA, ...(opts.headers || {}) }, method: opts.method || 'GET', signal: AbortSignal.timeout(30000) });
    const body = opts.method === 'HEAD' ? '' : await r.text();
    return { status: r.status, loc: r.headers.get('location'), ct: r.headers.get('content-type'), xrt: r.headers.get('x-robots-tag'), body, ms: Date.now() - t };
  } catch (e) { return { status: 0, err: String(e), ms: Date.now() - t, body: '' }; }
}
const m1 = (re, s) => (s.match(re) || [])[1];
const decode = (s) => (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function parse(html) {
  const head = html.split('</head>')[0];
  const title = decode(m1(/<title>([\s\S]*?)<\/title>/i, head) || '');
  const desc = decode(m1(/<meta name="description" content="([^"]*)"/i, head) || '');
  const canonical = m1(/<link rel="canonical" href="([^"]+)"/i, head);
  const robots = m1(/<meta name="robots" content="([^"]+)"/i, head) || '';
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((x) => x[1].replace(/<[^>]+>/g, '').trim());
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((x) => { try { return JSON.parse(x[1]); } catch { return 'INVALID'; } });
  const og = { title: !!/property="og:title"/.test(head), image: m1(/property="og:image" content="([^"]+)"/, head) };
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((x) => x[0]);
  const noAlt = imgs.filter((i) => !/\balt="[^"]+"/.test(i) && !/\balt=""/.test(i)).length;
  const emptyAlt = imgs.filter((i) => /\balt=""/.test(i)).length;
  const links = [...html.matchAll(/<a\b[^>]*href="([^"#]+)"/gi)].map((x) => decode(x[1])).filter((h) => h.startsWith('/') && !h.startsWith('//'));
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const h2 = [...html.matchAll(/<h([2-6])\b/gi)].map((x) => +x[1]);
  return { title, desc, canonical, robots, h1s, ld, og, imgs: imgs.length, noAlt, emptyAlt, links, words: text.split(' ').length, hlev: h2 };
}
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }

const report = { checks: [], pages: [] };
const chk = (name, ok, info = '') => { report.checks.push({ name, ok, info }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };

// 1. Зеркала и служебные
const mirrors = [
  ['http://top-barbershop.com/', 'https://top-barbershop.com/'],
  ['https://www.top-barbershop.com/', 'https://top-barbershop.com/'],
  ['http://www.top-barbershop.com/place/portos/', 'https://top-barbershop.com/place/portos/'],
  ['https://top-barbershop.com/place/portos', 'https://top-barbershop.com/place/portos/'],
  ['https://top-barbershop.com/index.php', 'https://top-barbershop.com/'],
  ['https://top-barbershop.com/PLACE/PORTOS/', null],
  ['https://top-barbershop.com/listings/page/1/', 'https://top-barbershop.com/listings/'],
  ['https://top-barbershop.com/location/russia/msk/page/1/', 'https://top-barbershop.com/location/russia/msk/'],
  ['https://top-barbershop.com/sitemap_index.xml', 'https://top-barbershop.com/sitemap.xml'],
  ['https://top-barbershop.com/feed/', null],
];
for (const [from, to] of mirrors) {
  const r = await get(from);
  const loc = r.loc ? new URL(r.loc, from).href : null;
  if (to) chk(`301 ${from} → ${to}`, r.status === 301 && loc === to, `${r.status} ${loc || ''}`);
  else chk(`ответ ${from}`, [200, 301, 404].includes(r.status), `${r.status} ${loc || ''}`);
}
const nf = await get(SITE + '/no-such-page-xyz/');
chk('404 отдаёт код 404', nf.status === 404, String(nf.status));
chk('404 оформлена (поиск, ссылки)', /Страница не найдена/.test(nf.body) && /action="\/search\/"/.test(nf.body));
const nfShop = await get(SITE + '/place/no-such-shop-xyz/');
chk('несуществующий барбершоп → 404', nfShop.status === 404, String(nfShop.status));
const rb = await get(SITE + '/robots.txt');
chk('robots.txt 200 и text/plain', rb.status === 200 && /text\/plain/.test(rb.ct || ''), `${rb.status} ${rb.ct}`);
chk('robots.txt: Sitemap указан', /Sitemap: https:\/\/top-barbershop\.com\/sitemap\.xml/.test(rb.body));
chk('robots.txt: не закрыт весь сайт', !/^Disallow: \/\s*$/m.test(rb.body));
chk('robots.txt: Clean-param для UTM/поиска', /Clean-param/i.test(rb.body), 'нет директивы Clean-param');
console.log('--- robots.txt ---\n' + rb.body.trim() + '\n---');
const fav = await get(SITE + '/favicon.svg'); chk('favicon.svg 200', fav.status === 200);
const favIco = await get(SITE + '/favicon.ico'); chk('favicon.ico (Яндекс любит .ico/PNG)', favIco.status === 200, String(favIco.status));
const sm = await get(SITE + '/sitemap.xml');
chk('sitemap.xml 200 xml', sm.status === 200 && /xml/.test(sm.ct || ''), `${sm.status} ${sm.ct}`);
const urls = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => decode(x[1]));
console.log('URL в sitemap:', urls.length);

// 2. Обход sitemap
const t0 = Date.now();
const pages = await pool(urls, 10, async (u) => {
  const r = await get(u);
  const p = r.status === 200 ? parse(r.body) : {};
  return { url: u, status: r.status, loc: r.loc, ms: r.ms, xrt: r.xrt, ...p, links: p.links || [] };
});
console.log(`обход: ${pages.length} стр. за ${Math.round((Date.now() - t0) / 1000)} с`);
const bad = pages.filter((p) => p.status !== 200);
chk('все URL sitemap отвечают 200', !bad.length, bad.slice(0, 10).map((p) => `${p.status} ${p.url}`).join(' | '));
const ok = pages.filter((p) => p.status === 200);
const nonCanon = ok.filter((p) => p.canonical !== p.url);
chk('canonical = собственный URL у всех страниц sitemap', !nonCanon.length, `${nonCanon.length}: ` + nonCanon.slice(0, 5).map((p) => `${p.url} → ${p.canonical}`).join(' | '));
const noidx = ok.filter((p) => /noindex/.test(p.robots) || /noindex/.test(p.xrt || ''));
chk('в sitemap нет noindex-страниц', !noidx.length, noidx.slice(0, 5).map((p) => p.url).join(' | '));
const dupGroup = (key) => { const m = new Map(); for (const p of ok) { const k = p[key]; if (!k) continue; (m.get(k) || m.set(k, []).get(k)).push(p.url); } return [...m].filter(([, v]) => v.length > 1); };
const dt = dupGroup('title'), dd = dupGroup('desc');
chk('нет дублей title', !dt.length, `${dt.length} групп, ${dt.reduce((a, [, v]) => a + v.length, 0)} стр.; напр.: ` + dt.slice(0, 4).map(([k, v]) => `«${k.slice(0, 60)}» ×${v.length} (${v.slice(0, 2).join(', ')})`).join(' | '));
chk('нет дублей description', !dd.length, `${dd.length} групп; напр.: ` + dd.slice(0, 3).map(([k, v]) => `«${k.slice(0, 50)}» ×${v.length} (${v.slice(0, 2).join(', ')})`).join(' | '));
const noT = ok.filter((p) => !p.title), noD = ok.filter((p) => !p.desc);
chk('у всех есть title', !noT.length, noT.slice(0, 5).map((p) => p.url).join(' '));
chk('у всех есть description', !noD.length, noD.slice(0, 5).map((p) => p.url).join(' '));
const longT = ok.filter((p) => p.title.length > 80), shortT = ok.filter((p) => p.title.length < 20);
chk('title ≤ 80 знаков', longT.length < ok.length * 0.05, `${longT.length} длиннее 80; напр.: ` + longT.slice(0, 3).map((p) => `(${p.title.length}) ${p.title}`).join(' | '));
chk('title не короче 20 знаков', !shortT.length, shortT.slice(0, 5).map((p) => `${p.title} ${p.url}`).join(' | '));
const longD = ok.filter((p) => p.desc.length > 200), shortD = ok.filter((p) => p.desc.length < 70);
chk('description 70–200 знаков', longD.length + shortD.length < ok.length * 0.05, `длинных ${longD.length}, коротких ${shortD.length}; напр.: ` + shortD.slice(0, 3).map((p) => `(${p.desc.length}) ${p.url}`).join(' | '));
const h1bad = ok.filter((p) => p.h1s.length !== 1);
chk('ровно один H1', !h1bad.length, h1bad.slice(0, 5).map((p) => `${p.h1s.length}× ${p.url}`).join(' | '));
const h1eqT = ok.filter((p) => p.h1s[0] && p.h1s[0] === p.title);
chk('H1 не дублирует title дословно', h1eqT.length < ok.length * 0.1, `${h1eqT.length} стр.`);
const ldBad = ok.filter((p) => p.ld.includes('INVALID'));
chk('JSON-LD валиден (JSON)', !ldBad.length, ldBad.slice(0, 5).map((p) => p.url).join(' '));
const noLd = ok.filter((p) => !p.ld.length);
chk('JSON-LD есть на всех страницах', !noLd.length, `${noLd.length}: ` + noLd.slice(0, 5).map((p) => p.url).join(' '));
const shops = ok.filter((p) => p.url.includes('/place/'));
const shopLd = shops.filter((p) => p.ld.some((x) => x && x['@type'] === 'HairSalon'));
chk('карточки: разметка HairSalon', shopLd.length === shops.length, `${shopLd.length}/${shops.length}`);
const noOg = ok.filter((p) => !p.og.title || !p.og.image);
chk('Open Graph title+image', !noOg.length, `${noOg.length}`);
const totalImgs = ok.reduce((a, p) => a + p.imgs, 0), noAlt = ok.reduce((a, p) => a + p.noAlt, 0), emptyAlt = ok.reduce((a, p) => a + p.emptyAlt, 0);
chk('у изображений есть alt', noAlt === 0, `без alt ${noAlt}, пустой alt ${emptyAlt} из ${totalImgs}`);
const thin = ok.filter((p) => p.words < 120 && !p.url.includes('/page/'));
chk('нет «тонких» страниц (<120 слов в контенте)', thin.length < ok.length * 0.05, `${thin.length}; напр.: ` + thin.slice(0, 6).map((p) => `${p.words} сл. ${p.url}`).join(' | '));
const hskip = ok.filter((p) => { let prev = 1; for (const l of p.hlev) { if (l > prev + 1) return true; prev = l; } return false; });
chk('заголовки без пропуска уровней', hskip.length < ok.length * 0.05, `${hskip.length}; напр.: ` + hskip.slice(0, 3).map((p) => p.url).join(' '));
const slow = ok.filter((p) => p.ms > 2000);
const avg = Math.round(ok.reduce((a, p) => a + p.ms, 0) / ok.length);
chk('время ответа', slow.length < ok.length * 0.05, `среднее ${avg} мс (из США), медленнее 2 с: ${slow.length}`);

// 3. Внутренние ссылки
const inSitemap = new Set(urls.map((u) => new URL(u).pathname));
const linkCount = new Map();
for (const p of ok) for (const l of new Set(p.links)) { const path = l.split('?')[0]; linkCount.set(path, (linkCount.get(path) || 0) + 1); }
const toCheck = [...linkCount.keys()].filter((l) => !inSitemap.has(l) && !/^\/(img|media|wp-content|_astro)\//.test(l));
const linkRes = await pool(toCheck, 10, async (l) => ({ l, r: await get(SITE + l, { method: 'GET' }) }));
const broken = linkRes.filter((x) => x.r.status >= 400 || x.r.status === 0);
const redir = linkRes.filter((x) => x.r.status >= 300 && x.r.status < 400);
chk('нет внутренних ссылок на 4xx', !broken.length, `${broken.length}: ` + broken.slice(0, 10).map((x) => `${x.r.status} ${x.l} (×${linkCount.get(x.l)})`).join(' | '));
chk('нет внутренних ссылок на редиректы', !redir.length, `${redir.length}: ` + redir.slice(0, 10).map((x) => `${x.r.status} ${x.l}→${x.r.loc} (×${linkCount.get(x.l)})`).join(' | '));
const linkedNotInSm = linkRes.filter((x) => x.r.status === 200 && !/noindex/.test(parse(x.r.body).robots) && !x.l.startsWith('/search') && !x.l.includes('/page/'));
chk('индексируемые страницы вне sitemap', linkedNotInSm.length === 0, `${linkedNotInSm.length}: ` + linkedNotInSm.slice(0, 10).map((x) => x.l).join(' '));
const orphan = urls.filter((u) => !linkCount.has(new URL(u).pathname) && new URL(u).pathname !== '/');
chk('нет страниц-сирот (на них есть внутренние ссылки)', orphan.length < urls.length * 0.02, `${orphan.length} из ${urls.length}; напр.: ` + orphan.slice(0, 8).map((u) => new URL(u).pathname).join(' '));

// 4. Пагинация
const pg2 = await get(SITE + '/location/russia/msk/page/2/');
const p2 = parse(pg2.body);
console.log('пагинация /msk/page/2/:', pg2.status, 'canonical', p2.canonical, '| title', p2.title);
chk('page/2: номер страницы в title', /страница 2/.test(p2.title));

// разбивка по типам
const types = {}; for (const p of ok) { const t = new URL(p.url).pathname.split('/')[1] || 'home'; types[t] = (types[t] || 0) + 1; }
console.log('типы страниц:', JSON.stringify(types));
const fails = report.checks.filter((c) => !c.ok).length;
console.log(`\nИТОГО проверок: ${report.checks.length}, проблем: ${fails}`);
import { writeFileSync } from 'node:fs';
writeFileSync('seo-pages.json', JSON.stringify(ok.map((p) => ({ url: p.url, title: p.title, desc: p.desc, h1: p.h1s[0], words: p.words, ms: p.ms })), null, 0));
writeFileSync('seo-checks.json', JSON.stringify({ checks: report.checks, dupTitles: dt, dupDesc: dd, broken: broken.map((x) => [x.l, x.r.status, linkCount.get(x.l)]), redirects: redir.map((x) => [x.l, x.r.loc, linkCount.get(x.l)]), thin: thin.map((p) => [p.url, p.words]), orphan }, null, 1));
