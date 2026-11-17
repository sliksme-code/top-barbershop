import type { APIRoute } from 'astro';
import { sql } from '../lib/db';
import { strip, clip } from '../lib/text';
const SITE = 'https://top-barbershop.com';
export const GET: APIRoute = async () => {
  const posts = await sql`select slug, title, excerpt, left(content, 2000) content, published_at from posts where status='published' order by published_at desc limit 30`;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const items = posts.map((p) => `<item><title>${esc(p.title)}</title><link>${SITE}/${p.slug}/</link><guid>${SITE}/${p.slug}/</guid><pubDate>${new Date(p.published_at).toUTCString()}</pubDate><description>${esc(clip(strip(p.excerpt || p.content), 300))}</description></item>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>TOP BARBERSHOP — Журнал</title><link>${SITE}/zhurnal/</link><description>Статьи о мужских стрижках и барбершопах</description><language>ru</language>${items}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
